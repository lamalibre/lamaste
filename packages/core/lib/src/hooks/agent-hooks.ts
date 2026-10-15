/**
 * The agent side of the hook contract: the body Lamaste posts to the agent
 * half's `POST /admin/hooks/<stage>` and the decision the agent half
 * answers. Both ends validate with these — the relay what the agent half
 * answered, the agent half (through `@lamalibre/lamaste/agent`) what it was
 * asked.
 */

import { isAgentHookStage } from './constants.js';
import type { AgentHookCall, AgentHookDecision, JsonValue } from './types.js';

/** Largest decision an agent half may answer with. */
export const AGENT_HOOK_DECISION_MAX_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate an agent hook's decision; null when it is not one. */
export function parseAgentHookDecision(value: unknown): AgentHookDecision | null {
  if (!isRecord(value)) return null;
  if (value['ok'] === true) {
    if (Object.keys(value).some((k) => k !== 'ok' && k !== 'output')) return null;
    return 'output' in value ? { ok: true, output: value['output'] as JsonValue } : { ok: true };
  }
  if (value['ok'] === false && typeof value['reason'] === 'string' && value['reason'].length > 0) {
    return { ok: false, reason: value['reason'].slice(0, 500) };
  }
  return null;
}

/** Validate the body of a hook call the agent half received; null when it is not one. */
export function parseAgentHookCall(value: unknown, stageInPath: string): AgentHookCall | null {
  if (!isRecord(value) || !isAgentHookStage(value['stage']) || value['stage'] !== stageInPath) {
    return null;
  }
  if (!isRecord(value['input'])) return null;
  return value as unknown as AgentHookCall;
}
