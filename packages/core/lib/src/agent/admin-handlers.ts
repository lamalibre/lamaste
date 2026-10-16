/**
 * The agent half's admin answers — what every handler core gives an agent
 * half has in common (`createAgentHookHandler`, `createSettingsHandler`,
 * {@link createHealthHandler}), and the helper an agent half's own
 * `/admin/*` routes use.
 *
 * Every answer to a request whose caller assertion verified carries
 * `X-Lamalibre-Responder` (`caller-assertion.ts`), because the relay
 * believes nothing that comes back through a tunnel without it: whatever
 * takes a loopback port while the tunnel or the agent half is down must be
 * able to serve nothing. Two forms, chosen by who called:
 *
 * - **Lamaste's own calls** (caller `lamaste`: settings, hooks, health) are
 *   buffered by the relay, so the signature covers the exact answer body —
 *   which is why core's handlers return the body serialized (`bodyText`)
 *   and the agent half must send exactly those bytes;
 * - **forwarded calls** (caller `admin` or `agent`, through the panel's
 *   forwarder) stream, so the signature covers the nonce and the status
 *   only (the `-` form, {@link responderHeaderFor}). **Every** `/admin/*`
 *   response an agent half serves to a forwarded caller must carry it — the
 *   forwarder answers 502 for one that does not.
 *
 * Answers given before or instead of a verification (a 401 for a bad
 * assertion, a 404 or 405 for a path or method no handler answers, a 400
 * for a body passed parsed) carry no responder header: there is no
 * verified request to bind it to, and the relay treats them as not the
 * agent half's.
 */

import type { VerifiedCallerAssertion } from '../caller-assertion.js';
import { RESPONDER_HEADER } from '../caller-assertion.js';
import { AGENT_HALF_HEALTH_PATH } from '../agent-half-call.js';
import type { CallerAssertionVerifier } from './app-plugins.js';

export interface AgentHookRequest {
  readonly method: string;
  /** The request path with its query string, as the caller assertion signs it. */
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  /**
   * The body exactly as received — a Buffer (or Uint8Array) or a string;
   * undefined or null for none. Where Lamaste signs the body (hook calls,
   * `PUT /admin/settings`) an object a framework already parsed is refused
   * with 400 "The body must be passed as received": the signed hash covers
   * the bytes, which a parsed object no longer has. With Fastify, register a
   * `parseAs: 'buffer'` content-type parser for these routes; with
   * node:http, collect the chunks.
   */
  readonly body: unknown;
}

export interface AgentHookResponse {
  readonly status: number;
  /**
   * The answer, parsed — for inspection. Send {@link bodyText}, not a
   * re-serialization of this.
   */
  readonly body: Record<string, unknown>;
  /** The exact bytes to send (JSON); the responder header covers them. */
  readonly bodyText: string;
  /**
   * The headers to send with it: `content-type`, and `x-lamalibre-responder`
   * when the request's assertion verified.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/** The message of a signed body that reached a handler already parsed. */
export const BODY_NOT_AS_RECEIVED = 'The body must be passed as received';

/**
 * A JSON answer. With `verified`, it carries the responder header in the
 * form the caller expects: over the exact `bodyText` for Lamaste's own
 * calls, the `-` form for a forwarded caller. Not part of the package's
 * public surface.
 */
export function adminAnswer(
  status: number,
  body: Record<string, unknown>,
  verified: VerifiedCallerAssertion | null = null,
): AgentHookResponse {
  const bodyText = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (verified) {
    headers[RESPONDER_HEADER] =
      verified.payload.caller.type === 'lamaste'
        ? verified.responder(status, bodyText)
        : verified.responder(status);
  }
  return { status, body, bodyText, headers };
}

/**
 * The body as received, as bytes: a Buffer or Uint8Array as it is, a
 * string as its UTF-8 bytes, none as empty; null when a framework already
 * parsed it. Not part of the package's public surface.
 */
export function rawBodyOf(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === 'string') return Buffer.from(body, 'utf-8');
  if (body === undefined || body === null) return Buffer.alloc(0);
  return null;
}

/**
 * The `X-Lamalibre-Responder` header for an answer an agent half's own
 * route gives a forwarded request (the `-` form: the request's nonce and
 * the answer's status), ready to merge into the response headers:
 *
 *     const verified = await verifier.verify(req.headers, req.method, req.url);
 *     if (!verified.ok) return send(401, ...); // no responder header
 *     res.writeHead(200, {
 *       'content-type': 'text/javascript',
 *       ...responderHeaderFor(verified, 200),
 *     });
 *
 * Every `/admin/*` response to a verified forwarded request must carry it;
 * the panel's forwarder refuses (502) any answer without a valid one, so a
 * squatter on the tunnel's port cannot serve a plugin's pages.
 */
export function responderHeaderFor(
  verified: VerifiedCallerAssertion,
  status: number,
): Record<string, string> {
  return { [RESPONDER_HEADER]: verified.responder(status) };
}

export interface HealthHandlerOptions {
  /** The agent half's verifier ({@link CallerAssertionVerifier}). */
  readonly verifier: CallerAssertionVerifier;
  /**
   * Whether the agent half is healthy; healthy when omitted. A check that
   * throws or rejects counts as unhealthy — its message is not passed on.
   */
  readonly check?: (() => boolean | Promise<boolean>) | undefined;
}

/**
 * Answer `GET /admin/health` in an agent half — what the relay's health
 * monitor probes, and what tells it the application from a squatter on the
 * tunnel's port: `200 { ok: true }` or `503 { ok: false }`, authenticated
 * with the responder header. Any verified caller may ask (an admin through
 * the forwarder too); 401 for a bad assertion, 404 for another path, 405
 * for another method. Framework-agnostic: pass the request, send
 * `status`, `headers` and `bodyText`.
 */
export function createHealthHandler(opts: HealthHandlerOptions): {
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
} {
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      if (pathOnly !== AGENT_HALF_HEALTH_PATH) return adminAnswer(404, { error: 'Not found' });
      const method = request.method.toUpperCase();
      if (method !== 'GET') return adminAnswer(405, { error: 'Health is read with GET' });
      const raw = rawBodyOf(request.body);
      const verified = await opts.verifier.verify(
        request.headers,
        method,
        request.url,
        raw ? { body: raw } : {},
      );
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      let healthy = true;
      if (opts.check) {
        try {
          healthy = (await opts.check()) === true;
        } catch {
          healthy = false;
        }
      }
      return healthy
        ? adminAnswer(200, { ok: true }, verified)
        : adminAnswer(503, { ok: false }, verified);
    },
  };
}
