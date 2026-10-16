/**
 * Lamaste's own calls to an agent half: one JSON request to
 * `http://127.0.0.1:<port>/admin/...` with a caller assertion naming Lamaste
 * itself (`{ type: 'lamaste' }`), answered with whatever status the agent
 * half gives. The relay makes these calls through the plugin's internal
 * tunnel (its loopback end) — settings reads and writes, and the lifecycle
 * hook calls (`agent-hook-call.ts`, built on the same request). The
 * forwarder reserves those paths, so no forwarded caller reaches them.
 *
 * Only paths under `/admin/` are called: the user surface (`/app/*`) is
 * never Lamaste's to reach with its own identity. A request body may carry
 * a secret (a settings update), so no error here ever contains it.
 */

import http from 'node:http';

import { CALLER_ASSERTION_HEADER, signCallerAssertion } from './caller-assertion.js';

const AGENT_HALF_CALL_METHODS = ['GET', 'PUT', 'POST', 'DELETE'] as const;

export type AgentHalfCallMethod = (typeof AGENT_HALF_CALL_METHODS)[number];

export interface AgentHalfCallOptions {
  /** The plugin's route; the assertion names it. */
  readonly plugin: string;
  /** The relay-loopback port of the internal tunnel (or the agent half's own port, on the agent). */
  readonly port: number;
  /** The installation secret the assertion is signed with. */
  readonly secret: string;
  readonly method: AgentHalfCallMethod;
  /** Under `/admin/`; anything else is refused (thrown). */
  readonly path: string;
  /** Sent JSON-encoded as `application/json`; no body when undefined. */
  readonly body?: unknown;
  readonly timeoutMs: number;
  /** A response body larger than this is a failure (`invalid`). */
  readonly maxResponseBytes: number;
  readonly host?: string | undefined;
}

export type AgentHalfCallFailure =
  /** Nothing listens on the port: the tunnel is down (relay) or the agent half is not running (agent). */
  | 'refused'
  | 'timeout'
  /** A response body over `maxResponseBytes`. */
  | 'invalid'
  | 'other';

export type AgentHalfCallResult =
  /** Any HTTP status; `body` is the parsed JSON, or null when empty or not JSON. */
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly code: AgentHalfCallFailure; readonly error: string };

/** One request to the agent half, its answer unparsed. Shared with the hook call. */
export interface AgentHalfRequest {
  readonly port: number;
  readonly host: string;
  readonly method: AgentHalfCallMethod;
  readonly path: string;
  /** The signed `X-Lamalibre-Caller` header for exactly this method and path. */
  readonly assertion: string;
  readonly body: Buffer | null;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export type AgentHalfRawResult =
  | { readonly ok: true; readonly status: number | undefined; readonly raw: Buffer }
  | { readonly ok: false; readonly code: AgentHalfCallFailure; readonly error: string };

/**
 * Send one request to the agent half and collect its answer. Not part of
 * the package's public surface: {@link callAgentHalf} and
 * `callAgentHalfHook` are the callers.
 */
export function requestAgentHalf(request: AgentHalfRequest): Promise<AgentHalfRawResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: AgentHalfRawResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const headers: Record<string, string> = {
      [CALLER_ASSERTION_HEADER]: request.assertion,
      accept: 'application/json',
    };
    if (request.body) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(request.body.length);
    }
    const req = http.request(
      {
        host: request.host,
        port: request.port,
        method: request.method,
        path: request.path,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > request.maxResponseBytes) {
            req.destroy();
            finish({
              ok: false,
              code: 'invalid',
              error: 'The agent half answered with too large a body',
            });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish({ ok: true, status: res.statusCode, raw: Buffer.concat(chunks) }),
        );
        res.on('error', (err) => finish({ ok: false, code: 'other', error: err.message }));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, code: 'timeout', error: `No answer within ${request.timeoutMs} ms` });
    }, request.timeoutMs);
    req.on('error', (err: NodeJS.ErrnoException) =>
      finish(
        err.code === 'ECONNREFUSED'
          ? {
              ok: false,
              code: 'refused',
              error: 'Nothing answers on the port (connection refused)',
            }
          : { ok: false, code: 'other', error: err.message },
      ),
    );
    if (request.body) req.end(request.body);
    else req.end();
  });
}

/**
 * Whether `path` is a path under `/admin/` that stays there: no `.` or `..`
 * segment, spelled plainly or percent-encoded, that a router could resolve
 * out of `/admin`.
 */
function isAdminPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/admin/')) return false;
  const query = path.indexOf('?');
  const pathOnly = query === -1 ? path : path.slice(0, query);
  for (const segment of pathOnly.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (decoded === '.' || decoded === '..') return false;
  }
  return true;
}

/**
 * Call the agent half's admin surface as Lamaste. Resolves with the status
 * and the parsed body whatever the status is — what a status means is the
 * caller's to decide — or with a failure (`refused`, `timeout`, `invalid`
 * for a body over `maxResponseBytes`, `other`). Throws, before anything is
 * sent, for a path outside `/admin/`, a method it does not make or a
 * malformed installation secret: those are mistakes in Lamaste, not
 * answers of the agent half.
 */
export function callAgentHalf(opts: AgentHalfCallOptions): Promise<AgentHalfCallResult> {
  if (!isAdminPath(opts.path)) {
    throw new Error('An agent half call goes to a path under /admin/ only');
  }
  if (!(AGENT_HALF_CALL_METHODS as readonly string[]).includes(opts.method)) {
    throw new Error('An agent half call is GET, PUT, POST or DELETE');
  }
  const assertion = signCallerAssertion(
    { plugin: opts.plugin, caller: { type: 'lamaste' }, method: opts.method, path: opts.path },
    opts.secret,
  );
  const body =
    opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body) ?? 'null', 'utf-8');
  return requestAgentHalf({
    port: opts.port,
    host: opts.host ?? '127.0.0.1',
    method: opts.method,
    path: opts.path,
    assertion,
    body,
    timeoutMs: opts.timeoutMs,
    maxResponseBytes: opts.maxResponseBytes,
  }).then((result): AgentHalfCallResult => {
    if (!result.ok) return result;
    let parsed: unknown = null;
    if (result.raw.length > 0) {
      try {
        parsed = JSON.parse(result.raw.toString('utf-8'));
      } catch {
        parsed = null;
      }
    }
    return { ok: true, status: result.status ?? 0, body: parsed };
  });
}
