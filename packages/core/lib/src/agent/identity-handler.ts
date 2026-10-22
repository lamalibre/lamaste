/**
 * The agent half's identity routes — where the panel's identity feed
 * arrives (`identity.ts`):
 *
 *     POST /admin/identity/notify   { protocol, directoryId, seq }
 *       → 200 { protocol, directoryId, cursor }
 *     POST /admin/identity/changes  { protocol, directoryId, from, to, reset,
 *                                     reconcile, pass, final, changes: sealed }
 *       → 200 { protocol, directoryId, cursor, mismatches? }
 *       → 409 { error: 'cursor_mismatch', protocol, directoryId, cursor }
 *
 * Only Lamaste calls them (caller `lamaste`, through the tunnel), with an
 * assertion that signs the exact body — so the body must be passed as
 * received — and every answer to a verified call carries the responder
 * header over its exact bytes (`admin-handlers.ts`). The forwarder reserves
 * `/admin/identity*`, so no admin or agent reaches them through the panel,
 * and the caller verifier refuses a user caller anywhere but `/app`.
 *
 * A batch's `changes` arrive sealed to the request (`identity-seal.ts`):
 * opened with the verified request's `openIdentityChanges` — the key comes
 * from the installation secret, bound to the assertion's nonce and to the
 * batch envelope — so the tunnel's loopback ends carry no member in clear.
 *
 * Nothing about a member is ever logged or echoed — not a username, not a
 * name, not an address: log lines carry the directory, the cursor and
 * counts.
 */

import {
  AGENT_HALF_IDENTITY_CHANGES_PATH,
  AGENT_HALF_IDENTITY_NOTIFY_PATH,
  IDENTITY_BATCH_MAX_BYTES,
  IDENTITY_CURSOR_MISMATCH,
  IDENTITY_PROTOCOL_VERSION,
  parseIdentityChangesRequest,
  parseIdentityChangesWire,
  parseIdentityNotifyRequest,
} from '../identity.js';
import { BODY_NOT_AS_RECEIVED, adminAnswer, rawBodyOf } from './admin-handlers.js';
import type { AgentHookRequest, AgentHookResponse } from './admin-handlers.js';
import type { CallerAssertionVerifier } from './app-plugins.js';
import { IdentityCursorConflictError } from './identity-projection.js';
import type { IdentityProjection } from './identity-projection.js';

export interface IdentityHandlerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface IdentityHandlersOptions {
  /** The agent half's verifier (`createCallerAssertionVerifier`). */
  readonly verifier: CallerAssertionVerifier;
  /**
   * Where the feed lands: `createIdentityProjection` — or a plugin's own
   * person model with the same two operations, which throws
   * `IdentityCursorConflictError` for a batch that does not continue from
   * its cursor.
   */
  readonly projection: Pick<IdentityProjection, 'state' | 'applyBatch'>;
  /** Metadata only: never a member's attributes. */
  readonly logger?: IdentityHandlerLogger | undefined;
}

const ROUTES: ReadonlySet<string> = new Set([
  AGENT_HALF_IDENTITY_NOTIFY_PATH,
  AGENT_HALF_IDENTITY_CHANGES_PATH,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a failure is called in a log line: its class, never its message. */
function errorKind(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Answer `POST /admin/identity/notify` and `POST /admin/identity/changes`
 * in an agent half. 404 for any other path, 405 for another method, 400
 * for a body passed parsed, 413 over `IDENTITY_BATCH_MAX_BYTES` — all
 * before verification, unsigned; 401 for an assertion that does not verify
 * or does not sign the body. Then, signed: 403 for any caller but Lamaste,
 * 400 for a body that is not JSON, of another protocol
 * (`{ error, protocol: 1 }`), not the contract, or with changes that do not
 * open for this request; a notification answers
 * what the projection holds, a batch is applied — 409 `cursor_mismatch`
 * when it does not continue from the cursor, 500 when the projection
 * failed (rolled back). Framework-agnostic, like `createSettingsHandler`:
 * pass the request, send `status`, `headers` and `bodyText`.
 */
export function createIdentityHandlers(opts: IdentityHandlersOptions): {
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
} {
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      if (!ROUTES.has(pathOnly)) return adminAnswer(404, { error: 'Not found' });
      const method = request.method.toUpperCase();
      if (method !== 'POST') return adminAnswer(405, { error: 'Identity calls are POST' });
      const raw = rawBodyOf(request.body);
      if (!raw) return adminAnswer(400, { error: BODY_NOT_AS_RECEIVED });
      if (raw.length > IDENTITY_BATCH_MAX_BYTES) {
        return adminAnswer(413, { error: 'The identity call is too large' });
      }
      const verified = await opts.verifier.verify(request.headers, method, request.url, {
        body: raw,
        requireBodyHash: true,
      });
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      if (verified.payload.caller.type !== 'lamaste') {
        return adminAnswer(403, { error: 'Only Lamaste sends the identity feed' }, verified);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf-8'));
      } catch {
        return adminAnswer(400, { error: 'The identity call is not JSON' }, verified);
      }
      if (isRecord(parsed) && parsed['protocol'] !== IDENTITY_PROTOCOL_VERSION) {
        return adminAnswer(
          400,
          { error: 'Unsupported identity protocol', protocol: IDENTITY_PROTOCOL_VERSION },
          verified,
        );
      }

      if (pathOnly === AGENT_HALF_IDENTITY_NOTIFY_PATH) {
        if (!parseIdentityNotifyRequest(parsed)) {
          return adminAnswer(400, { error: 'Malformed identity notification' }, verified);
        }
        try {
          const state = opts.projection.state();
          return adminAnswer(
            200,
            {
              protocol: IDENTITY_PROTOCOL_VERSION,
              directoryId: state.directoryId,
              cursor: state.cursor,
            },
            verified,
          );
        } catch (err: unknown) {
          opts.logger?.warn({ error: errorKind(err) }, 'Reading the identity cursor failed');
          return adminAnswer(500, { error: 'The identity projection failed' }, verified);
        }
      }

      // The changes travel sealed to this request (`identity-seal.ts`): open
      // them with the secret that verified it, bound to its nonce and to the
      // envelope, then check the batch as a whole.
      const wire = parseIdentityChangesWire(parsed);
      if (!wire) return adminAnswer(400, { error: 'Malformed identity batch' }, verified);
      let changes: unknown;
      try {
        changes = verified.openIdentityChanges(wire.sealed, wire.envelope);
      } catch {
        opts.logger?.warn(
          { directoryId: wire.envelope.directoryId, from: wire.envelope.from },
          'The changes of an identity batch could not be opened',
        );
        return adminAnswer(400, { error: 'The identity changes could not be opened' }, verified);
      }
      const batch = parseIdentityChangesRequest({
        protocol: wire.protocol,
        ...wire.envelope,
        changes,
      });
      if (!batch) return adminAnswer(400, { error: 'Malformed identity batch' }, verified);
      try {
        const answer = opts.projection.applyBatch(batch);
        opts.logger?.info(
          {
            directoryId: batch.directoryId,
            from: batch.from,
            to: batch.to,
            changes: batch.changes.length,
            reset: batch.reset,
            reconcile: batch.reconcile,
            final: batch.final,
            ...(answer.mismatches !== undefined ? { mismatches: answer.mismatches } : {}),
          },
          'Applied an identity batch',
        );
        return adminAnswer(200, { ...answer }, verified);
      } catch (err: unknown) {
        if (err instanceof IdentityCursorConflictError) {
          opts.logger?.warn(
            { directoryId: batch.directoryId, from: batch.from, cursor: err.cursor },
            'An identity batch did not continue from the cursor',
          );
          return adminAnswer(
            409,
            {
              error: IDENTITY_CURSOR_MISMATCH,
              protocol: IDENTITY_PROTOCOL_VERSION,
              directoryId: err.directoryId,
              cursor: err.cursor,
            },
            verified,
          );
        }
        opts.logger?.warn(
          { directoryId: batch.directoryId, from: batch.from, error: errorKind(err) },
          'Applying an identity batch failed',
        );
        return adminAnswer(500, { error: 'The identity projection failed' }, verified);
      }
    },
  };
}
