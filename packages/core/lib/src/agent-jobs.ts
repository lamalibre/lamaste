/**
 * Agent jobs — work the relay lists for an agent in `agent-config`
 * (`agentJobs`), which the agent's sync runs on its own machine and reports
 * to `POST /api/agents/me/jobs/:id/result`. The relay cannot reach an agent
 * (agents connect out, behind NAT), so this is how it has one act. The kinds:
 *
 * - `hook` — call the agent half's `POST /admin/hooks/<stage>` on the
 *   agent's loopback, for the stages that run while there is no tunnel;
 * - `app-install`, `app-activate`, `app-remove` — install, switch or remove
 *   the agent half through the agent's root helper `lamaste-apphost`.
 *
 * Both ends validate a result with {@link AgentJobResultSchema}: the agent
 * before it reports, the relay when it records. An error is one line of at
 * most {@link AGENT_JOB_ERROR_MAX_CHARS} characters and never carries a
 * secret.
 */

import { z } from 'zod';

import { AgentHalfVersionSchema } from './agent-half.js';
import { parseAgentHookDecision } from './hooks/index.js';

/** Timeouts of the app jobs (the relay lists them; the agent caps a job at its kind's). */
export const AGENT_APP_JOB_TIMEOUTS = Object.freeze({
  install: 600_000,
  activate: 120_000,
  remove: 300_000,
});

/** Longest error a job result may carry. */
export const AGENT_JOB_ERROR_MAX_CHARS = 500;

/** The agent half's unit after an app job: running, installed but stopped, or not there. */
export const APP_UNIT_STATES = ['active', 'inactive', 'absent'] as const;
export type AppUnitState = (typeof APP_UNIT_STATES)[number];

/**
 * A job's error as a result carries it: whitespace (line breaks included)
 * collapsed to single spaces, other control characters dropped, at most
 * {@link AGENT_JOB_ERROR_MAX_CHARS} characters. Removes no secret — the
 * message given must not hold one.
 */
export function agentJobError(message: string): string {
  const line = message
    .replace(/\s+/gu, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();
  if (line.length === 0) return 'The job failed';
  return line.length <= AGENT_JOB_ERROR_MAX_CHARS
    ? line
    : `${line.slice(0, AGENT_JOB_ERROR_MAX_CHARS - 1)}…`;
}

const AgentJobFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .string()
      .min(1)
      .max(AGENT_JOB_ERROR_MAX_CHARS)
      .refine((e) => !/\p{Cc}/u.test(e), 'error is one line without control characters'),
  })
  .strict();

const AgentHookDecisionSchema = z.unknown().transform((value, ctx) => {
  const decision = parseAgentHookDecision(value);
  if (!decision) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not an agent hook decision' });
    return z.NEVER;
  }
  return decision;
});

const AgentHookJobSuccessSchema = z
  .object({ ok: z.literal(true), decision: AgentHookDecisionSchema })
  .strict();

const AgentAppJobSuccessSchema = z
  .object({
    ok: z.literal(true),
    app: z
      .object({
        /** The version `current` points at; null when none is installed (after `app-remove`). */
        version: AgentHalfVersionSchema.nullable(),
        unit: z.enum(APP_UNIT_STATES),
      })
      .strict(),
  })
  .strict();

/** The result of a `hook` job: the agent half's decision, or why there is none. */
export const AgentHookJobResultSchema = z.union([AgentHookJobSuccessSchema, AgentJobFailureSchema]);

/** The result of an `app-*` job: the agent half's state afterwards, or why it failed. */
export const AgentAppJobResultSchema = z.union([AgentAppJobSuccessSchema, AgentJobFailureSchema]);

/** The result of any agent job (the relay checks it matches the job's kind). */
export const AgentJobResultSchema = z.union([
  AgentHookJobSuccessSchema,
  AgentAppJobSuccessSchema,
  AgentJobFailureSchema,
]);

export type AgentHookJobResult = z.infer<typeof AgentHookJobResultSchema>;
export type AgentAppJobResult = z.infer<typeof AgentAppJobResultSchema>;
export type AgentJobResult = z.infer<typeof AgentJobResultSchema>;
