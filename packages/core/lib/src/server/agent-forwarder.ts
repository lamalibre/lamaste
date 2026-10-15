/**
 * The agent forwarder — the panel's own handling of `/api/<route>/*` for an
 * agent-hosted plugin whose agent half is hosted on an agent.
 *
 * The plugin host never imports such a plugin. Instead every request under
 * its route is forwarded to `http://127.0.0.1:<port>/admin/<rest>` — the
 * relay end of the plugin's internal tunnel — with a caller assertion
 * (`caller-assertion.ts`) naming who the panel admitted. Only `/admin/*` of
 * the agent half is reachable this way; its `/app/*` (the user surface) is
 * not, because the forwarder prefixes `/admin` to whatever it is given.
 *
 * Streaming both ways over Node's own HTTP client (no dependency): bodies
 * are piped, never buffered, so uploads, downloads and server-sent events
 * pass through as they arrive. What the forwarder enforces:
 *
 * - the plugin's body limit (the internal tunnel's `maxBodySizeMb`): a
 *   larger `Content-Length` is refused with 413 before anything is sent,
 *   and a chunked body that grows past it is cut off;
 * - a headers timeout (default 30 s) — 504 when the agent half has not
 *   answered by then; and an idle timeout on the response body, except for
 *   `text/event-stream`, which may stay quiet as long as the application
 *   keeps the connection;
 * - a clean 502 when nothing listens on the port (the tunnel is down) or the
 *   connection drops before the response headers.
 *
 * What never reaches the agent half: the caller's cookies and
 * `Authorization` header (the panel's own session must not leak to an
 * application), the client-certificate headers nginx set, anything the
 * client sent under `X-Lamalibre-*` or `Remote-*`, and hop-by-hop headers.
 * What never reaches the client: `Set-Cookie` from the application (the
 * assertion is the authentication; a cookie on the panel's origin would be
 * the application's, not the panel's). Nothing of a body is ever logged —
 * one metadata line per request: plugin, caller, method, path (no query),
 * status, duration.
 */

import http from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { CALLER_ASSERTION_HEADER, signCallerAssertion } from '../caller-assertion.js';
import type { CallerIdentity } from '../caller-assertion.js';
import { RESERVED_API_PREFIXES } from '../constants.js';

/** The path prefix on the agent half every forwarded request goes under. */
export const AGENT_HALF_ADMIN_PREFIX = '/admin';

export const AGENT_FORWARD_DEFAULTS = Object.freeze({
  /** Waiting for the agent half's response headers. */
  headersTimeoutMs: 30_000,
  /** Silence on a response body (not server-sent events). */
  bodyIdleTimeoutMs: 300_000,
  /** Connecting to the relay-loopback port. */
  connectTimeoutMs: 5_000,
});

/** Where one plugin's requests go, resolved per request. */
export interface AgentForwardTarget {
  readonly plugin: string;
  readonly port: number;
  /** The installation secret the forwarder signs with. */
  readonly secret: string;
  readonly maxBodyBytes: number;
}

/** Why a route cannot be forwarded right now. */
export type AgentForwardRefusal =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'not_hosted' };

export type AgentForwardResolution = AgentForwardTarget | AgentForwardRefusal;

export interface AgentForwarderLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface AgentForwarderOptions {
  /**
   * Resolve the route of a request to a target, or say why not. Called on
   * every request so a hosting created or rotated a moment ago takes effect
   * at once.
   */
  resolveTarget(route: string): Promise<AgentForwardResolution>;
  /**
   * Who the panel admits for this plugin's routes — after the panel's own
   * authentication. Return `null` to refuse (403). Never called for a route
   * that does not resolve to a target.
   */
  authorize(request: FastifyRequest, plugin: string): Promise<CallerIdentity | null>;
  /**
   * Called before a target request is forwarded; a non-null reply status
   * is sent instead (the onboarding guard: 503 before the relay is set up).
   */
  guard?: ((request: FastifyRequest) => { status: number; body: unknown } | null) | undefined;
  readonly headersTimeoutMs?: number | undefined;
  readonly bodyIdleTimeoutMs?: number | undefined;
  readonly connectTimeoutMs?: number | undefined;
  /** Where the agent half is reached. Default 127.0.0.1 — the relay loopback. */
  readonly host?: string | undefined;
  readonly logger?: AgentForwarderLogger | undefined;
}

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Headers never copied in either direction (RFC 9110 §7.6.1 and friends). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Request headers that carry the caller's credentials or nginx's verdicts. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'cookie',
  'authorization',
  'expect',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
]);

/** Response headers the panel keeps to itself. */
const STRIPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);

function isStrippedRequestHeader(name: string): boolean {
  return (
    HOP_BY_HOP.has(name) ||
    STRIPPED_REQUEST_HEADERS.has(name) ||
    name.startsWith('x-lamalibre-') ||
    name.startsWith('x-ssl-client-') ||
    name.startsWith('remote-')
  );
}

/**
 * The request headers forwarded to the agent half. Pure; exported for
 * tests. `Content-Length` is passed only when the body will be sent as is.
 */
export function forwardedRequestHeaders(
  incoming: IncomingHttpHeaders,
  port: number,
  host = '127.0.0.1',
): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || isStrippedRequestHeader(name)) continue;
    out[name] = value;
  }
  out['host'] = `${host}:${port}`;
  return out;
}

/** The response headers passed back to the client. Pure; exported for tests. */
export function forwardedResponseHeaders(incoming: IncomingHttpHeaders): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(name) || STRIPPED_RESPONSE_HEADERS.has(name)) {
      continue;
    }
    out[name] = value;
  }
  return out;
}

/**
 * Map the request URL (`/api/<route>[/<rest>][?query]`) to the path on the
 * agent half (`/admin[/<rest>][?query]`). Returns null when the URL does
 * not start with the route, or when `rest` tries to climb out of `/admin`
 * (a decoded segment of `..`). Pure; exported for tests.
 */
export function agentHalfPath(rawUrl: string, apiPrefix: string, route: string): string | null {
  const prefix = `${apiPrefix}/${route}`;
  if (rawUrl !== prefix && !rawUrl.startsWith(`${prefix}/`) && !rawUrl.startsWith(`${prefix}?`)) {
    return null;
  }
  const rest = rawUrl.slice(prefix.length);
  const query = rest.indexOf('?');
  const pathPart = query === -1 ? rest : rest.slice(0, query);
  for (const segment of pathPart.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '..' || decoded === '.' || decoded.includes('\\')) return null;
  }
  return `${AGENT_HALF_ADMIN_PREFIX}${rest}`;
}

function isEventStream(headers: IncomingHttpHeaders): boolean {
  const type = headers['content-type'];
  return typeof type === 'string' && type.toLowerCase().startsWith('text/event-stream');
}

function errorBody(error: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error, ...extra });
}

/** A body that stops at `limit` bytes; the stream errors past it. */
class BodyLimit extends Transform {
  #seen = 0;
  readonly limit: number;
  exceeded = false;

  constructor(limit: number) {
    super();
    this.limit = limit;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.#seen += chunk.length;
    if (this.#seen > this.limit) {
      this.exceeded = true;
      callback(new Error('Request body exceeds the plugin tunnel body limit'));
      return;
    }
    callback(null, chunk);
  }
}

interface ForwardOutcome {
  readonly status: number;
  readonly error?: string | undefined;
}

/**
 * Forward one request to `target` and stream the response back. Takes over
 * the reply (`reply.hijack()`) so nothing between the agent half and the
 * client buffers or rewrites the body. Resolves once the response has been
 * sent, or the failure answered.
 */
export async function forwardToAgentHalf(
  request: FastifyRequest,
  reply: FastifyReply,
  target: AgentForwardTarget,
  caller: CallerIdentity,
  targetPath: string,
  opts: Pick<
    AgentForwarderOptions,
    'headersTimeoutMs' | 'bodyIdleTimeoutMs' | 'connectTimeoutMs' | 'host'
  > = {},
): Promise<ForwardOutcome> {
  const headersTimeoutMs = opts.headersTimeoutMs ?? AGENT_FORWARD_DEFAULTS.headersTimeoutMs;
  const bodyIdleTimeoutMs = opts.bodyIdleTimeoutMs ?? AGENT_FORWARD_DEFAULTS.bodyIdleTimeoutMs;
  const connectTimeoutMs = opts.connectTimeoutMs ?? AGENT_FORWARD_DEFAULTS.connectTimeoutMs;
  const host = opts.host ?? '127.0.0.1';
  const method = request.method.toUpperCase();

  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) {
      return answer(reply, 400, errorBody('Invalid Content-Length'));
    }
    if (length > target.maxBodyBytes) {
      return answer(
        reply,
        413,
        errorBody('Request body exceeds the plugin tunnel body limit', {
          maxBodyBytes: target.maxBodyBytes,
        }),
      );
    }
  }

  const headers = forwardedRequestHeaders(request.headers, target.port, host);
  headers[CALLER_ASSERTION_HEADER] = signCallerAssertion(
    { plugin: target.plugin, caller, method, path: targetPath },
    target.secret,
  );
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (hasBody && declared !== undefined) headers['content-length'] = declared;

  reply.hijack();
  const res = reply.raw;

  return new Promise<ForwardOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: ForwardOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(headersTimer);
      if (idleTimer) clearTimeout(idleTimer);
      resolve(outcome);
    };
    const fail = (status: number, error: string, extra: Record<string, unknown> = {}): void => {
      if (settled) return;
      upstream.destroy();
      if (!res.headersSent) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(errorBody(error, extra));
      } else {
        res.destroy();
      }
      finish({ status, error });
    };

    const upstream = http.request({
      host,
      port: target.port,
      method,
      path: targetPath,
      headers,
      timeout: connectTimeoutMs,
    });
    let idleTimer: NodeJS.Timeout | null = null;
    const headersTimer = setTimeout(() => {
      fail(504, 'The hosting agent did not answer in time', { timeoutMs: headersTimeoutMs });
    }, headersTimeoutMs);

    upstream.once('timeout', () => {
      // Only the connect phase arms Node's socket timeout here; once the
      // request is written the headers timer owns the wait.
      if (!upstream.socket || upstream.socket.connecting) {
        fail(502, 'The hosting agent is unreachable', { reason: 'tunnel' });
      }
    });
    upstream.once('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      const refused = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET';
      if (!res.headersSent) {
        fail(502, refused ? 'The hosting agent is unreachable' : 'Forwarding failed', {
          reason: err.code === 'ECONNREFUSED' ? 'tunnel' : 'app',
        });
      } else {
        res.destroy();
        finish({ status: 502, error: err.code ?? err.message });
      }
    });

    // The client went away before the response was complete: stop the
    // upstream request too. Watched on the response, not the request — an
    // IncomingMessage emits 'close' as soon as its body has been read, which
    // for a piped request body is long before the reply exists.
    res.once('close', () => {
      if (!settled && !res.writableFinished) upstream.destroy();
    });

    upstream.once('response', (upstreamRes: IncomingMessage) => {
      clearTimeout(headersTimer);
      const status = upstreamRes.statusCode ?? 502;
      const responseHeaders = forwardedResponseHeaders(upstreamRes.headers);
      const eventStream = isEventStream(upstreamRes.headers);
      if (eventStream) {
        // nginx in front of the panel buffers responses; this header turns
        // that off for this response so events reach the browser as sent.
        responseHeaders['x-accel-buffering'] = 'no';
        responseHeaders['cache-control'] = 'no-cache';
      }
      res.writeHead(status, responseHeaders);
      if (eventStream) res.flushHeaders();

      const armIdle = (): void => {
        if (eventStream) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          upstreamRes.destroy(new Error('idle'));
          res.destroy();
          finish({ status, error: 'response body idle timeout' });
        }, bodyIdleTimeoutMs);
      };
      armIdle();
      upstreamRes.on('data', armIdle);

      pipeline(upstreamRes, res)
        .then(() => finish({ status }))
        .catch((err: Error) => {
          res.destroy();
          finish({ status, error: err.message });
        });
    });

    if (!hasBody) {
      upstream.end();
      return;
    }
    const limit = new BodyLimit(target.maxBodyBytes);
    pipeline(request.raw, limit, upstream).catch((err: Error) => {
      if (limit.exceeded) {
        fail(413, 'Request body exceeds the plugin tunnel body limit', {
          maxBodyBytes: target.maxBodyBytes,
        });
        return;
      }
      if (!settled && !res.headersSent) {
        fail(502, `Forwarding the request body failed: ${err.message}`);
      }
    });
  });
}

function answer(reply: FastifyReply, status: number, body: string): ForwardOutcome {
  reply.hijack();
  reply.raw.writeHead(status, { 'content-type': 'application/json' });
  reply.raw.end(body);
  return { status };
}

/**
 * Fastify plugin registering `/:route` and `/:route/*` (under the prefix it
 * is registered with — `/api` on the panel). Register it after every core
 * and plugin-host route: static routes win over the parameters, so only
 * what nothing else answers reaches the forwarder, and a route that
 * resolves to no hosted plugin is answered with the panel's own 404.
 */
export async function agentForwarderPlugin(
  fastify: FastifyInstance,
  opts: AgentForwarderOptions,
): Promise<void> {
  const logger = opts.logger ?? fastify.log;
  const reserved = new Set<string>(RESERVED_API_PREFIXES);
  const apiPrefix = fastify.prefix;

  // The body is handed to the forwarder as the raw stream, whatever its
  // content type: nothing here reads or parses it.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload);
  });

  const handler = async (
    request: FastifyRequest<{ Params: { route: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const { route } = request.params;
    if (!ROUTE_RE.test(route) || reserved.has(route)) {
      return reply.callNotFound();
    }
    const resolved = await opts.resolveTarget(route);
    if ('kind' in resolved) {
      if (resolved.kind === 'disabled') {
        return reply.code(503).send({ error: `Plugin "${route}" is disabled` });
      }
      if (resolved.kind === 'not_hosted') {
        return reply.code(503).send({
          error: `Plugin "${route}" is not hosted on an agent yet`,
          hint: `POST /api/plugins/${route}/hosting with the agent that runs it`,
        });
      }
      return reply.callNotFound();
    }
    const guarded = opts.guard?.(request) ?? null;
    if (guarded) {
      return reply.code(guarded.status).send(guarded.body);
    }
    const caller = await opts.authorize(request, resolved.plugin);
    if (!caller) {
      return reply.code(403).send({
        error: 'Insufficient scope for plugin route',
        details: { required: `admin OR agent with a "plugin:${route}:*" capability` },
      });
    }
    const targetPath = agentHalfPath(request.raw.url ?? '', apiPrefix, route);
    if (targetPath === null) {
      return reply.code(400).send({ error: 'Invalid plugin path' });
    }

    const startedAt = Date.now();
    const outcome = await forwardToAgentHalf(request, reply, resolved, caller, targetPath, opts);
    const pathOnly = targetPath.split('?')[0] ?? targetPath;
    const line = {
      plugin: resolved.plugin,
      caller: caller.type === 'admin' ? 'admin' : `agent:${caller.label}`,
      method: request.method,
      path: pathOnly,
      status: outcome.status,
      durationMs: Date.now() - startedAt,
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    if (outcome.error) logger.warn(line, 'Plugin request not completed');
    else logger.info(line, 'Forwarded plugin request');
  };

  fastify.all('/:route', handler);
  fastify.all('/:route/*', handler);
}
