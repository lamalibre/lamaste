/**
 * The agent half's sign-in events route — where the panel tells a plugin
 * that declares `identity.signInEvents` when one of its users signed in
 * with a native client (`sign-in-events.ts`, native-apps-design.md D7):
 *
 *     POST /admin/identity/sign-ins  { protocol: 1, from, to, events: sealed }
 *       → 200 { protocol: 1, acknowledged: <to> }
 *
 * Only Lamaste calls it (caller `lamaste`, through the tunnel), with an
 * assertion that signs the exact body; every answer to a verified call
 * carries the responder header over its exact bytes (`admin-handlers.ts`).
 * The forwarder reserves `/admin/identity*`, so no admin or agent reaches it
 * through the panel. The events arrive sealed to the request and are opened
 * with the verified request's `openSignInEvents`.
 *
 * Delivery is at least once: the plugin's `onEvents` must take an event it
 * already holds (the same `seq`) as that one. The batch is acknowledged
 * only once `onEvents` resolved; a failure answers 500 and the panel sends
 * the batch again later. Nothing about a user is logged — only seqs and
 * counts.
 */

import {
  AGENT_HALF_SIGN_IN_EVENTS_PATH,
  SIGN_IN_EVENTS_MAX_BYTES,
  SIGN_IN_EVENTS_PROTOCOL_VERSION,
  parseSignInEvents,
  parseSignInEventsWire,
} from '../sign-in-events.js';
import type { SignInEvent } from '../sign-in-events.js';
import { BODY_NOT_AS_RECEIVED, adminAnswer, rawBodyOf } from './admin-handlers.js';
import type { AgentHookRequest, AgentHookResponse } from './admin-handlers.js';
import type { CallerAssertionVerifier } from './app-plugins.js';

export interface SignInEventsHandlerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface SignInEventsHandlerOptions {
  /** The agent half's verifier (`createCallerAssertionVerifier`). */
  readonly verifier: CallerAssertionVerifier;
  /**
   * Take a batch of events (ascending `seq`). Resolve once they are kept;
   * throw to have the panel send them again. An event whose `seq` is
   * already held is the same event.
   */
  readonly onEvents: (events: readonly SignInEvent[]) => Promise<void> | void;
  /** Metadata only: never a user id. */
  readonly logger?: SignInEventsHandlerLogger | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a failure is called in a log line: its class, never its message. */
function errorKind(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Answer `POST /admin/identity/sign-ins` in an agent half. 404 for any
 * other path, 405 for another method, 400 for a body passed parsed, 413
 * over {@link SIGN_IN_EVENTS_MAX_BYTES} — before verification, unsigned;
 * 401 for an assertion that does not verify or does not sign the body.
 * Then, signed: 403 for any caller but Lamaste; 400 for a body that is not
 * JSON, of another protocol, not the contract, or with events that do not
 * open for this request; 500 when `onEvents` failed; 200
 * `{ protocol, acknowledged: to }`. Framework-agnostic, like
 * `createIdentityHandlers`: pass the request, send `status`, `headers`
 * and `bodyText`.
 */
export function createSignInEventsHandler(opts: SignInEventsHandlerOptions): {
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
} {
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      if (pathOnly !== AGENT_HALF_SIGN_IN_EVENTS_PATH) {
        return adminAnswer(404, { error: 'Not found' });
      }
      const method = request.method.toUpperCase();
      if (method !== 'POST') return adminAnswer(405, { error: 'Sign-in events are POST' });
      const raw = rawBodyOf(request.body);
      if (!raw) return adminAnswer(400, { error: BODY_NOT_AS_RECEIVED });
      if (raw.length > SIGN_IN_EVENTS_MAX_BYTES) {
        return adminAnswer(413, { error: 'The sign-in events call is too large' });
      }
      const verified = await opts.verifier.verify(request.headers, method, request.url, {
        body: raw,
        requireBodyHash: true,
      });
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      if (verified.payload.caller.type !== 'lamaste') {
        return adminAnswer(403, { error: 'Only Lamaste sends sign-in events' }, verified);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf-8'));
      } catch {
        return adminAnswer(400, { error: 'The sign-in events call is not JSON' }, verified);
      }
      if (isRecord(parsed) && parsed['protocol'] !== SIGN_IN_EVENTS_PROTOCOL_VERSION) {
        return adminAnswer(
          400,
          {
            error: 'Unsupported sign-in events protocol',
            protocol: SIGN_IN_EVENTS_PROTOCOL_VERSION,
          },
          verified,
        );
      }
      const wire = parseSignInEventsWire(parsed);
      if (!wire) return adminAnswer(400, { error: 'Malformed sign-in events' }, verified);
      const envelope = { from: wire.from, to: wire.to };
      let opened: unknown;
      try {
        opened = verified.openSignInEvents(wire.events, envelope);
      } catch {
        opts.logger?.warn(envelope, 'Sign-in events could not be opened');
        return adminAnswer(400, { error: 'The sign-in events could not be opened' }, verified);
      }
      const events = parseSignInEvents(opened, envelope);
      if (!events) return adminAnswer(400, { error: 'Malformed sign-in events' }, verified);
      try {
        await opts.onEvents(events);
      } catch (err: unknown) {
        opts.logger?.warn({ ...envelope, error: errorKind(err) }, 'Keeping sign-in events failed');
        return adminAnswer(500, { error: 'The sign-in events were not kept' }, verified);
      }
      opts.logger?.info({ ...envelope, events: events.length }, 'Received sign-in events');
      return adminAnswer(
        200,
        { protocol: SIGN_IN_EVENTS_PROTOCOL_VERSION, acknowledged: wire.to },
        verified,
      );
    },
  };
}
