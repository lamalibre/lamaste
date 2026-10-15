/**
 * Agent jobs — the panel's way to have an agent do something on its own
 * machine and report back. The panel cannot reach an agent (agents connect
 * out, behind NAT); an agent's sync timer fetches `agent-config` every 30 s,
 * which lists the agent's pending jobs, runs them, and posts each result to
 * `POST /api/agents/me/jobs/:id/result`.
 *
 * The kinds (core `agent-jobs.ts` has the result contract both ends check):
 *
 * - `hook` — call the agent half's `POST /admin/hooks/<stage>` on the
 *   agent's loopback, for the lifecycle stages that run while the internal
 *   tunnel is not there (the agent's `install:pre-tunnel` before it is
 *   granted, `uninstall:post-teardown` after it is removed). The agent
 *   signs that call with the installation secret it already holds.
 * - `app-install` (`spec`: the pinned agent half), `app-activate`
 *   (`version`) and `app-remove` (`purge`) — install, switch or remove the
 *   agent half through the agent's root helper `lamaste-apphost`. The agent
 *   fetches the package itself and installs it only when its tarball
 *   matches the pinned integrity.
 *
 * A job carries no secret. It has a deadline (its timeout plus delivery
 * slack); an unfinished job past it expires. Waiting is event-driven within
 * this process, with the database as the record.
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  AGENT_APP_JOB_TIMEOUTS,
  AgentAppJobResultSchema,
  AgentHalfSpecSchema,
  AgentHalfVersionSchema,
  AgentHookJobResultSchema,
} from '@lamalibre/lamaste';
import { getStateDb } from './state-db.js';

/** Two sync intervals and a margin: how long delivery may take on top of the hook's own timeout. */
export const AGENT_JOB_DELIVERY_SLACK_MS = 90_000;

/** Largest result an agent may post. */
export const AGENT_JOB_RESULT_MAX_BYTES = 64 * 1024;

/** The app job kinds and how long the agent has for each (the helper's work, not delivery). */
export const AGENT_APP_JOB_KINDS = Object.freeze({
  'app-install': AGENT_APP_JOB_TIMEOUTS.install,
  'app-activate': AGENT_APP_JOB_TIMEOUTS.activate,
  'app-remove': AGENT_APP_JOB_TIMEOUTS.remove,
});

const events = new EventEmitter();
events.setMaxListeners(0);

function rowToJob(row) {
  return {
    id: row.id,
    agentLabel: row.agent_label,
    route: row.plugin,
    kind: row.kind,
    stage: row.stage,
    input: row.input ? JSON.parse(row.input) : null,
    payload: row.payload ? JSON.parse(row.payload) : null,
    timeoutMs: row.timeout_ms,
    status: row.status,
    result: row.result ? JSON.parse(row.result) : null,
    createdAt: row.created_at,
    deadlineAt: row.deadline_at,
    completedAt: row.completed_at,
  };
}

/**
 * Insert a pending job: `stage` and `input` for a hook job, `payload` for an
 * app job (null otherwise). Its deadline leaves delivery
 * {@link AGENT_JOB_DELIVERY_SLACK_MS} on top of `timeoutMs`.
 *
 * @returns {Promise<string>} the job id
 */
async function insertJob({ agentLabel, plugin, kind, stage, input, payload, timeoutMs }) {
  const db = await getStateDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_jobs (id, agent_label, plugin, kind, stage, input, payload, timeout_ms, status, created_at, deadline_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    id,
    agentLabel,
    plugin,
    kind,
    stage,
    input,
    payload,
    timeoutMs,
    new Date(now).toISOString(),
    new Date(now + timeoutMs + AGENT_JOB_DELIVERY_SLACK_MS).toISOString(),
  );
  return id;
}

/**
 * A `hook` job: call the agent half's `stage` hook on the agent's loopback.
 *
 * @param {{ agentLabel: string, plugin: string, stage: string, input: object, timeoutMs: number }} job
 * @returns {Promise<string>} the job id
 */
export async function createAgentJob({ agentLabel, plugin, stage, input, timeoutMs }) {
  return insertJob({
    agentLabel,
    plugin,
    kind: 'hook',
    stage,
    input: JSON.stringify(input),
    payload: null,
    timeoutMs,
  });
}

/**
 * The parameters of an app job, validated: `app-install` carries the pinned
 * agent half (`spec`), `app-activate` the version to point `current` at,
 * `app-remove` whether the data and the service account go too.
 */
function appJobPayload(kind, params) {
  switch (kind) {
    case 'app-install':
      return { spec: AgentHalfSpecSchema.parse(params.spec) };
    case 'app-activate':
      return { version: AgentHalfVersionSchema.parse(params.version) };
    case 'app-remove':
      if (typeof params.purge !== 'boolean') throw new TypeError('app-remove needs purge');
      return { purge: params.purge };
    default:
      throw new TypeError(`Unknown app job kind "${kind}"`);
  }
}

/**
 * An app job: install (`spec`), activate (`version`) or remove (`purge`)
 * the plugin's agent half through the agent's root helper.
 *
 * @param {{ agentLabel: string, plugin: string, kind: 'app-install' | 'app-activate' | 'app-remove', spec?: object, version?: string, purge?: boolean }} job
 * @returns {Promise<string>} the job id
 */
export async function createAppJob({ agentLabel, plugin, kind, ...params }) {
  const payload = appJobPayload(kind, params);
  return insertJob({
    agentLabel,
    plugin,
    kind,
    stage: null,
    input: null,
    payload: JSON.stringify(payload),
    timeoutMs: AGENT_APP_JOB_KINDS[kind],
  });
}

/** Finish the pending jobs `rows` as `status` (expired, cancelled) and wake their waiters. */
function finishPending(db, rows, status, now) {
  const finish = db.prepare(
    "UPDATE agent_jobs SET status = ?, completed_at = ? WHERE id = ? AND status = 'pending'",
  );
  for (const { id } of rows) {
    finish.run(status, now, id);
    events.emit(id);
  }
}

/** Expire jobs past their deadline. */
async function expireOverdue(db) {
  const now = new Date().toISOString();
  const overdue = db
    .prepare("SELECT id FROM agent_jobs WHERE status = 'pending' AND deadline_at <= ?")
    .all(now);
  finishPending(db, overdue, 'expired', now);
  // Finished jobs are kept a day for the record, then dropped.
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  db.prepare("DELETE FROM agent_jobs WHERE status != 'pending' AND created_at < ?").run(cutoff);
}

/**
 * The agent-config `agentJobs` of agent `label`: pending, not yet overdue.
 * A `hook` job carries `stage` and `input`; an app job its parameters
 * (`spec`, `version` or `purge`).
 */
export async function pendingAgentJobs(label) {
  const db = await getStateDb();
  await expireOverdue(db);
  return db
    .prepare(
      "SELECT * FROM agent_jobs WHERE agent_label = ? AND status = 'pending' ORDER BY created_at",
    )
    .all(label)
    .map((row) => {
      const job = rowToJob(row);
      const base = { id: job.id, route: job.route, kind: job.kind };
      const timing = { timeoutMs: job.timeoutMs, deadlineAt: job.deadlineAt };
      return job.kind === 'hook'
        ? { ...base, stage: job.stage, input: job.input, ...timing }
        : { ...base, ...timing, ...job.payload };
    });
}

/** One job by id, or null. */
export async function findAgentJob(id) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM agent_jobs WHERE id = ?').get(id);
  return row ? rowToJob(row) : null;
}

/**
 * The agent reports a job's result. Only the agent the job is for may, and
 * only once. The result must fit the job's kind (core `AgentJobResultSchema`):
 * a hook job's `{ ok: true, decision }`, an app job's
 * `{ ok: true, app: { version, unit } }`, or `{ ok: false, error }` (one
 * line). What is stored is the validated result.
 *
 * @returns {Promise<'recorded' | 'not_found' | 'not_pending' | 'invalid'>}
 */
export async function completeAgentJob(label, id, result) {
  const db = await getStateDb();
  const row = db
    .prepare('SELECT * FROM agent_jobs WHERE id = ? AND agent_label = ?')
    .get(id, label);
  if (!row) return 'not_found';
  if (row.status !== 'pending') return 'not_pending';
  const schema = row.kind === 'hook' ? AgentHookJobResultSchema : AgentAppJobResultSchema;
  const parsed = schema.safeParse(result);
  if (!parsed.success) return 'invalid';
  const changes = db
    .prepare(
      "UPDATE agent_jobs SET status = 'done', result = ?, completed_at = ? WHERE id = ? AND status = 'pending'",
    )
    .run(JSON.stringify(parsed.data), new Date().toISOString(), id).changes;
  if (Number(changes) === 0) return 'not_pending';
  events.emit(id);
  return 'recorded';
}

/**
 * Wait for a job to finish. Resolves the job's result — `{ ok: true, decision }`
 * (hook) or `{ ok: true, app }` (app job) — `{ ok: false, error }` (the
 * agent reported a failure), or `{ ok: false, error, expired: true }` when
 * the deadline passed (or the job was cancelled): the outcome is unknown.
 */
export async function waitForAgentJob(id) {
  const db = await getStateDb();
  for (;;) {
    const row = db.prepare('SELECT * FROM agent_jobs WHERE id = ?').get(id);
    if (!row) return { ok: false, error: 'The job no longer exists' };
    if (row.status === 'done') {
      const result = JSON.parse(row.result);
      return result && typeof result === 'object'
        ? result
        : { ok: false, error: 'Malformed result' };
    }
    if (row.status === 'expired' || row.status === 'cancelled') {
      return {
        ok: false,
        expired: true,
        error:
          row.status === 'expired'
            ? 'The agent did not report the job before its deadline (offline, or its sync is not running)'
            : 'The job was cancelled',
      };
    }
    const untilDeadline = Date.parse(row.deadline_at) - Date.now();
    if (untilDeadline <= 0) {
      await expireOverdue(db);
      continue;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(done, Math.min(untilDeadline + 10, 5_000));
      function done() {
        clearTimeout(timer);
        events.off(id, done);
        resolve();
      }
      events.once(id, done);
    });
  }
}

/** Cancel a plugin's pending jobs (its operation ended). */
export async function cancelAgentJobs(plugin) {
  const db = await getStateDb();
  const rows = db
    .prepare("SELECT id FROM agent_jobs WHERE plugin = ? AND status = 'pending'")
    .all(plugin);
  finishPending(db, rows, 'cancelled', new Date().toISOString());
}
