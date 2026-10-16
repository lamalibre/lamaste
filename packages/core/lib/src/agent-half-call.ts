/**
 * Lamaste's own calls to an agent half: one JSON request to
 * `http://127.0.0.1:<port>/admin/...` with a caller assertion naming Lamaste
 * itself (`{ type: 'lamaste' }`), answered with whatever status the agent
 * half gives. The relay makes these calls through the plugin's internal
 * tunnel (its loopback end) — settings reads and writes, the health probe,
 * and the lifecycle hook calls (`agent-hook-call.ts`, built on the same
 * exchange). The forwarder reserves the settings and hook paths, so no
 * forwarded caller reaches them.
 *
 * Both directions are authenticated, because whatever takes the loopback
 * port while the tunnel or the agent half is down receives the call:
 *
 * - the assertion binds the SHA-256 of the exact body it is sent with
 *   (`bodySha256`), so it cannot be replayed with another body;
 * - the answer must carry `X-Lamalibre-Responder` over the assertion's
 *   nonce, the status and the SHA-256 of the exact answer body, keyed with
 *   the secret the call was signed with (`caller-assertion.ts`). An answer
 *   without it — from a squatter, or from an agent half built against a
 *   core older than this check — is a failure (`unauthenticated`), never
 *   an answer.
 *
 * Only paths under `/admin/` are called: the user surface (`/app/*`) is
 * never Lamaste's to reach with its own identity. A request body may carry
 * a secret (a settings update — sealed, but still nobody's to log), so no
 * error here ever contains it.
 */

import http from 'node:http';

import {
  CALLER_ASSERTION_HEADER,
  RESPONDER_HEADER,
  assertHostingSecret,
  bodySha256Hex,
  generateCallerAssertionNonce,
  signCallerAssertion,
  verifyResponder,
} from './caller-assertion.js';

const AGENT_HALF_CALL_METHODS = ['GET', 'PUT', 'POST', 'DELETE'] as const;

export type AgentHalfCallMethod = (typeof AGENT_HALF_CALL_METHODS)[number];

/**
 * The agent half's health route (`createHealthHandler` in
 * `@lamalibre/lamaste/agent`), which the relay's health monitor probes.
 */
export const AGENT_HALF_HEALTH_PATH = '/admin/health';

export interface AgentHalfCallOptions {
  /** The plugin's route; the assertion names it. */
  readonly plugin: string;
  /** The relay-loopback port of the internal tunnel (or the agent half's own port, on the agent). */
  readonly port: number;
  /** The installation secret the assertion is signed with — and the answer verified with. */
  readonly secret: string;
  readonly method: AgentHalfCallMethod;
  /** Under `/admin/`; anything else is refused (thrown). */
  readonly path: string;
  /**
   * Sent JSON-encoded as `application/json`; no body when undefined. A
   * function is called with the assertion's nonce — chosen before anything
   * is signed — and its result is the body: how a settings update seals
   * its secrets to the one request that carries them.
   */
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
  /** The answer did not carry a valid `X-Lamalibre-Responder`: not the agent half's. */
  | 'unauthenticated'
  | 'other';

export type AgentHalfCallResult =
  /** Any HTTP status; `body` is the parsed JSON, or null when empty or not JSON. */
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | { readonly ok: false; readonly code: AgentHalfCallFailure; readonly error: string };

/** One request to the agent half, its answer unparsed. */
interface AgentHalfRequest {
  readonly port: number;
  readonly host: string;
  readonly method: AgentHalfCallMethod;
  readonly path: string;
  /** The signed `X-Lamalibre-Caller` header for exactly this method, path and body. */
  readonly assertion: string;
  readonly body: Buffer | null;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

type AgentHalfRawResult =
  | {
      readonly ok: true;
      readonly status: number | undefined;
      readonly raw: Buffer;
      /** The answer's `X-Lamalibre-Responder`, as Node reports it. */
      readonly responder: unknown;
    }
  | { readonly ok: false; readonly code: AgentHalfCallFailure; readonly error: string };

/** Send one request to the agent half and collect its answer. */
function requestAgentHalf(request: AgentHalfRequest): Promise<AgentHalfRawResult> {
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
          finish({
            ok: true,
            status: res.statusCode,
            raw: Buffer.concat(chunks),
            responder: res.headers[RESPONDER_HEADER],
          }),
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

/** One authenticated exchange with the agent half (see {@link exchangeWithAgentHalf}). */
export interface AgentHalfExchange {
  readonly plugin: string;
  readonly port: number;
  readonly host: string;
  readonly secret: string;
  readonly method: AgentHalfCallMethod;
  readonly path: string;
  /** Chosen before the body was built (a sealed secret is bound to it). */
  readonly nonce: string;
  readonly body: Buffer | null;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export type AgentHalfExchangeResult =
  | { readonly ok: true; readonly status: number; readonly raw: Buffer }
  | { readonly ok: false; readonly code: AgentHalfCallFailure; readonly error: string };

/**
 * Sign, send, and authenticate the answer: the assertion carries the nonce
 * and the body's hash, and the answer counts only with a responder
 * signature over that nonce, its status and its exact body, keyed with the
 * secret the request was signed with. Not part of the package's public
 * surface: {@link callAgentHalf} and `callAgentHalfHook` are the callers.
 * Throws for a malformed secret or nonce (a mistake in Lamaste).
 */
export async function exchangeWithAgentHalf(
  exchange: AgentHalfExchange,
): Promise<AgentHalfExchangeResult> {
  const assertion = signCallerAssertion(
    {
      plugin: exchange.plugin,
      caller: { type: 'lamaste' },
      method: exchange.method,
      path: exchange.path,
      nonce: exchange.nonce,
      ...(exchange.body ? { bodySha256: bodySha256Hex(exchange.body) } : {}),
    },
    exchange.secret,
  );
  const result = await requestAgentHalf({
    port: exchange.port,
    host: exchange.host,
    method: exchange.method,
    path: exchange.path,
    assertion,
    body: exchange.body,
    timeoutMs: exchange.timeoutMs,
    maxResponseBytes: exchange.maxResponseBytes,
  });
  if (!result.ok) return result;
  const status = result.status ?? 0;
  if (result.responder === undefined) {
    return {
      ok: false,
      code: 'unauthenticated',
      error:
        `The agent half did not authenticate its answer (status ${status} without an ` +
        'X-Lamalibre-Responder header: not the agent half, or one built against an older ' +
        '@lamalibre/lamaste that must be rebuilt)',
    };
  }
  const authentic = verifyResponder(result.responder, {
    secret: exchange.secret,
    nonce: exchange.nonce,
    status,
    body: result.raw,
  });
  if (!authentic) {
    return {
      ok: false,
      code: 'unauthenticated',
      error:
        `The agent half did not authenticate its answer (status ${status} with an ` +
        'X-Lamalibre-Responder header that does not verify for this request, status and body)',
    };
  }
  return { ok: true, status, raw: result.raw };
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
 * caller's to decide — once the answer has authenticated itself; or with a
 * failure (`refused`, `timeout`, `invalid` for a body over
 * `maxResponseBytes`, `unauthenticated` for an answer without a valid
 * responder signature, `other`). Throws, before anything is sent, for a
 * path outside `/admin/`, a method it does not make or a malformed
 * installation secret — mistakes in Lamaste, not answers of the agent
 * half — and when a body function throws.
 */
export function callAgentHalf(opts: AgentHalfCallOptions): Promise<AgentHalfCallResult> {
  if (!isAdminPath(opts.path)) {
    throw new Error('An agent half call goes to a path under /admin/ only');
  }
  if (!(AGENT_HALF_CALL_METHODS as readonly string[]).includes(opts.method)) {
    throw new Error('An agent half call is GET, PUT, POST or DELETE');
  }
  assertHostingSecret(opts.secret);
  // The nonce first: a body function seals to it, the assertion carries it,
  // and the answer's responder signature is checked against it.
  const nonce = generateCallerAssertionNonce();
  const value: unknown =
    typeof opts.body === 'function' ? (opts.body as (nonce: string) => unknown)(nonce) : opts.body;
  const body = value === undefined ? null : Buffer.from(JSON.stringify(value) ?? 'null', 'utf-8');
  return exchangeWithAgentHalf({
    plugin: opts.plugin,
    port: opts.port,
    host: opts.host ?? '127.0.0.1',
    secret: opts.secret,
    method: opts.method,
    path: opts.path,
    nonce,
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
    return { ok: true, status: result.status, body: parsed };
  });
}
