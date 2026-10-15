/**
 * Calling one relay hook: the runner round trip, validation of the
 * decision, the effects it asks for, and the runner restart a timeout calls
 * for. Every pipeline (install, uninstall, request, tunnel state) calls
 * relay hooks through {@link runRelayHook}.
 *
 * What is logged is metadata: plugin, stage, outcome, duration. A failing
 * request-stage hook's message is never logged — it is plugin text and may
 * quote the request or response it saw.
 */

import { SHARED_HOOK_EFFECTS } from '@lamalibre/lamaste/hooks';
import {
  callRelayHook,
  decisionEffects,
  hookRunnerSocketPath,
  validateHookDecision,
} from '@lamalibre/lamaste/server';
import { performHookEffects } from './hook-effects.js';
import { hookSocketDir, restartRelayHookRunner } from './plugin-hooks.js';

function isRequestStage(stage) {
  return stage === 'request:pre-forward' || stage === 'request:post-forward';
}

/**
 * @param {{
 *   plugin: string,
 *   stage: import('@lamalibre/lamaste/hooks').HookStage,
 *   call: import('@lamalibre/lamaste/hooks').HookCallTarget,
 *   input: Record<string, unknown>,
 *   body?: { bytes: Buffer, contentType: string | null } | null,
 *   timeoutMs: number,
 *   effects: ReadonlyArray<string>,
 *   logger?: import('pino').Logger,
 * }} params
 *   `effects` — the effect types the plugin declared (for its own hooks;
 *   a shared hook uses Lamaste's list).
 * @returns {Promise<
 *   | { ok: true, decision: object, body: Buffer | null, bodyIsText: boolean, durationMs: number }
 *   | { ok: false, kind: string, message: string, durationMs: number }
 * >}
 */
export async function runRelayHook({
  plugin,
  stage,
  call,
  input,
  body,
  timeoutMs,
  effects,
  logger,
}) {
  const outcome = await callRelayHook(hookRunnerSocketPath(hookSocketDir(), plugin), {
    plugin,
    stage,
    call,
    input,
    body: body ?? null,
    timeoutMs,
  });
  const requestStage = isRequestStage(stage);
  if (!outcome.ok) {
    if (outcome.kind === 'timeout') void restartRelayHookRunner(plugin, logger);
    logger?.warn(
      {
        plugin,
        stage,
        hook: call.kind === 'shared' ? call.name : 'plugin',
        kind: outcome.kind,
        durationMs: outcome.durationMs,
        ...(requestStage ? {} : { error: outcome.message }),
      },
      'Relay hook failed',
    );
    return {
      ok: false,
      kind: outcome.kind,
      message: requestStage ? '' : outcome.message,
      durationMs: outcome.durationMs,
    };
  }
  const validated = validateHookDecision(stage, outcome.decision);
  if (!validated.ok) {
    logger?.warn(
      { plugin, stage, error: validated.error },
      'Relay hook returned an invalid decision',
    );
    return { ok: false, kind: 'invalid', message: validated.error, durationMs: outcome.durationMs };
  }
  const allowed = new Set(call.kind === 'shared' ? SHARED_HOOK_EFFECTS[call.name] : effects);
  await performHookEffects(plugin, stage, decisionEffects(validated.decision), allowed, logger);
  return {
    ok: true,
    decision: validated.decision,
    body: outcome.body,
    bodyIsText: outcome.bodyIsText,
    durationMs: outcome.durationMs,
  };
}
