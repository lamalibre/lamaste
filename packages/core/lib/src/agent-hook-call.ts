/**
 * Calling an agent hook: `POST /admin/hooks/<stage>` on the agent half, with
 * a caller assertion naming Lamaste itself (`{ type: 'lamaste' }`) and
 * binding the call's body. The relay makes this call through the internal
 * tunnel (its loopback end); the agent's sync makes it on the agent's own
 * loopback for the stages that run while there is no tunnel (agent jobs).
 * The forwarder never reaches `/admin/hooks`, so no forwarded caller can.
 *
 * The agent half answers `{ ok: true, output? }` or `{ ok: false, reason }`
 * (see `AgentHookDecision` in `@lamalibre/lamaste/hooks`), authenticated
 * with `X-Lamalibre-Responder` (`createAgentHookHandler` does both).
 * Anything else — an unauthenticated answer, a status other than 200, a
 * body that is not that shape, a timeout — is a failure of the stage. The
 * exchange itself is the one `callAgentHalf` makes (`agent-half-call.ts`).
 */

import { exchangeWithAgentHalf } from './agent-half-call.js';
import { generateCallerAssertionNonce } from './caller-assertion.js';
import {
  AGENT_HOOK_DECISION_MAX_BYTES,
  agentHalfHookPath,
  parseAgentHookDecision,
} from './hooks/index.js';
import type { AgentHookDecision, AgentHookStage } from './hooks/index.js';

export interface AgentHookCallOptions {
  readonly plugin: string;
  readonly port: number;
  readonly secret: string;
  readonly stage: AgentHookStage;
  readonly input: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly host?: string | undefined;
}

export type AgentHookCallFailure =
  /** Nothing listens on the port: the tunnel is down (relay) or the agent half is not running (agent). */
  | 'refused'
  | 'timeout'
  /** An answer that is not a decision (status, body, size). */
  | 'invalid'
  /** The answer did not carry a valid `X-Lamalibre-Responder`: not the agent half's. */
  | 'unauthenticated'
  | 'other';

export type AgentHookCallResult =
  | { readonly ok: true; readonly decision: AgentHookDecision }
  | { readonly ok: false; readonly code: AgentHookCallFailure; readonly error: string };

export async function callAgentHalfHook(opts: AgentHookCallOptions): Promise<AgentHookCallResult> {
  const path = agentHalfHookPath(opts.stage);
  const body = Buffer.from(JSON.stringify({ stage: opts.stage, input: opts.input }), 'utf-8');
  // A malformed secret throws here, which rejects the call — as it always has.
  const result = await exchangeWithAgentHalf({
    plugin: opts.plugin,
    port: opts.port,
    host: opts.host ?? '127.0.0.1',
    secret: opts.secret,
    method: 'POST',
    path,
    nonce: generateCallerAssertionNonce(),
    body,
    timeoutMs: opts.timeoutMs,
    maxResponseBytes: AGENT_HOOK_DECISION_MAX_BYTES,
  });
  if (!result.ok) return result;
  const invalid = (error: string): AgentHookCallResult => ({ ok: false, code: 'invalid', error });
  if (result.status !== 200) {
    return invalid(`The agent half answered ${result.status || 'nothing'}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.raw.toString('utf-8'));
  } catch {
    return invalid('The agent half answered with something other than JSON');
  }
  const decision = parseAgentHookDecision(parsed);
  return decision
    ? { ok: true, decision }
    : invalid('The agent half answered with an invalid decision');
}
