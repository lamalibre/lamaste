/**
 * Long-running plugin operations — hosting, unhosting, update, uninstall of
 * a hosted plugin. Their pipelines wait on agents (a sync every 30 s) and on
 * plugin hooks, so they run in the background: the API answers 202 with the
 * operation, and the panel and CLI follow its steps.
 *
 * One operation runs per plugin at a time; a second is refused (409) —
 * hosting and uninstalling the same plugin can no longer interleave. Steps
 * and outcome are kept in state.db (metadata only). An operation still
 * `running` when the panel starts was interrupted by a restart and is
 * marked so.
 *
 * What an operation creates that is shown exactly once — the secret of a
 * confidential OIDC client an update added — is never written to state.db:
 * it is held in memory for {@link REVEAL_TTL_MS} and handed out by the first
 * read of the finished operation ({@link takeOperationReveal}).
 */

import crypto from 'node:crypto';
import { derivePluginRoute } from '@lamalibre/lamaste';
import { cancelAgentJobs } from './agent-jobs.js';
import { httpError } from './app-error.js';
import { getStateDb } from './state-db.js';

/** Kept per plugin; older finished operations are pruned. */
const OPERATIONS_KEPT_PER_PLUGIN = 20;

/** How long a once-shown secret waits to be read before it is dropped. */
export const REVEAL_TTL_MS = 60 * 60_000;

/** plugin → { id, kind, done } */
const running = new Map();

/** operation id → { oidcClients: [{ id, secret }], expiresAt } — memory only. */
const reveals = new Map();

function pruneReveals(now = Date.now()) {
  for (const [id, entry] of reveals) if (entry.expiresAt <= now) reveals.delete(id);
}

/**
 * What finished operation `id` has to show once — `{ oidcClients }`, the
 * secrets of the confidential OIDC clients it created — and forget it; null
 * when there is nothing (or it was shown already, or waited too long).
 *
 * @param {string} id
 * @returns {{ oidcClients: Array<{ id: string, secret: string }> } | null}
 */
export function takeOperationReveal(id) {
  pruneReveals();
  const entry = reveals.get(id);
  if (!entry) return null;
  reveals.delete(id);
  return { oidcClients: entry.oidcClients };
}

function rowToOperation(row) {
  if (!row) return null;
  const params = JSON.parse(row.params || '{}');
  return {
    id: row.id,
    plugin: row.plugin,
    kind: row.kind,
    actor: row.actor,
    status: row.status,
    steps: JSON.parse(row.steps || '[]'),
    error: row.error,
    warnings: params.warnings ?? [],
    params: params.public ?? {},
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** A step failed in a way the pipeline handles (not a bug). */
export class StageFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'StageFailure';
  }
}

/**
 * What a pipeline uses to record its progress. Steps are written to the
 * database as they start and end, so a reader sees a running operation move.
 */
export class OperationContext {
  #id;
  #db;
  #publicParams;
  #actor;
  steps = [];
  warnings = [];

  constructor(id, db, publicParams, actor) {
    this.#id = id;
    this.#db = db;
    this.#publicParams = publicParams;
    this.#actor = actor;
  }

  get id() {
    return this.#id;
  }

  /** Who started the operation (`admin`, `auto-approve`, …), for audit entries. */
  get actor() {
    return this.#actor;
  }

  #persist() {
    this.#db
      .prepare('UPDATE plugin_operations SET steps = ?, params = ? WHERE id = ?')
      .run(
        JSON.stringify(this.steps),
        JSON.stringify({ public: this.#publicParams, warnings: this.warnings }),
        this.#id,
      );
  }

  /** Run `fn` as a named step; its failure is recorded and rethrown. */
  async step(name, fn) {
    const step = { name, status: 'running', startedAt: new Date().toISOString() };
    this.steps.push(step);
    this.#persist();
    try {
      const result = await fn();
      step.status = 'done';
      step.finishedAt = new Date().toISOString();
      this.#persist();
      return result;
    } catch (err) {
      step.status = 'failed';
      step.finishedAt = new Date().toISOString();
      step.error = String(err?.message ?? err).slice(0, 500);
      this.#persist();
      throw err;
    }
  }

  /** Record a step that did not run, and why. */
  skip(name, reason) {
    const at = new Date().toISOString();
    this.steps.push({ name, status: 'skipped', startedAt: at, finishedAt: at, detail: reason });
    this.#persist();
  }

  /** Something went wrong that does not fail the operation (an uninstall stage, a rollback step). */
  warn(message) {
    this.warnings.push(String(message).slice(0, 500));
    this.#persist();
  }

  /**
   * Secrets of confidential OIDC clients this operation created, for the
   * admin to see once ({@link takeOperationReveal}) — never stored.
   *
   * @param {Array<{ id: string, secret: string }>} oidcClients
   */
  revealOidcClientSecrets(oidcClients) {
    if (oidcClients.length === 0) return;
    pruneReveals();
    reveals.set(this.#id, {
      oidcClients: oidcClients.map(({ id, secret }) => ({ id, secret })),
      expiresAt: Date.now() + REVEAL_TTL_MS,
    });
  }
}

/**
 * Start an operation for `plugin` and return it at once; `run(op)` continues
 * in the background. `run` resolves with the final status (`succeeded` by
 * default, or `rolled-back`) or throws (`failed`, with the message).
 *
 * @returns {Promise<{ operation: object, done: Promise<object> }>}
 */
export async function startPluginOperation({ plugin, kind, actor, params = {}, logger, run }) {
  const current = running.get(plugin);
  if (current) {
    throw httpError(
      `Plugin "${plugin}" has an operation in progress (${current.kind}) — wait for it to finish`,
      409,
      { operationId: current.id },
    );
  }
  const db = await getStateDb();
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  // Reserve before the first await below, so two requests cannot both start.
  const entry = { id, kind, done: null };
  running.set(plugin, entry);
  try {
    db.prepare(
      `INSERT INTO plugin_operations (id, plugin, kind, actor, status, steps, params, started_at)
       VALUES (?, ?, ?, ?, 'running', '[]', ?, ?)`,
    ).run(id, plugin, kind, actor, JSON.stringify({ public: params, warnings: [] }), startedAt);
  } catch (err) {
    running.delete(plugin);
    throw err;
  }
  const op = new OperationContext(id, db, params, actor);

  const finish = (status, error) => {
    db.prepare(
      'UPDATE plugin_operations SET status = ?, error = ?, finished_at = ? WHERE id = ?',
    ).run(status, error ?? null, new Date().toISOString(), id);
    db.prepare(
      `DELETE FROM plugin_operations WHERE plugin = ? AND status != 'running' AND id NOT IN
         (SELECT id FROM plugin_operations WHERE plugin = ? ORDER BY started_at DESC LIMIT ?)`,
    ).run(plugin, plugin, OPERATIONS_KEPT_PER_PLUGIN);
  };

  entry.done = (async () => {
    try {
      const result = await run(op);
      finish(result?.status ?? 'succeeded', result?.error ?? null);
    } catch (err) {
      if (!(err instanceof StageFailure)) {
        logger?.error({ plugin, kind, err: err?.message }, 'Plugin operation failed');
      }
      finish('failed', String(err?.message ?? err).slice(0, 500));
    } finally {
      running.delete(plugin);
    }
    return getPluginOperation(plugin, id);
  })();

  return { operation: await getPluginOperation(plugin, id), done: entry.done };
}

export function isPluginOperationRunning(plugin) {
  return running.has(plugin);
}

/** One operation, or the latest of the plugin when `id` is omitted. */
export async function getPluginOperation(plugin, id) {
  const db = await getStateDb();
  const row = id
    ? db.prepare('SELECT * FROM plugin_operations WHERE plugin = ? AND id = ?').get(plugin, id)
    : db
        .prepare(
          'SELECT * FROM plugin_operations WHERE plugin = ? ORDER BY started_at DESC LIMIT 1',
        )
        .get(plugin);
  return rowToOperation(row);
}

export async function listPluginOperations(plugin, limit = 10) {
  const db = await getStateDb();
  return db
    .prepare('SELECT * FROM plugin_operations WHERE plugin = ? ORDER BY started_at DESC LIMIT ?')
    .all(plugin, Math.min(Math.max(1, limit), OPERATIONS_KEPT_PER_PLUGIN))
    .map(rowToOperation);
}

/**
 * At start-up: operations a restart cut short. Their plugins' pending agent
 * jobs are cancelled — nothing waits for them any more, and an agent must
 * not install or remove an agent half for a pipeline that is gone (removing
 * the hosting later removes whatever such a job may have left).
 */
export async function markInterruptedOperations(logger) {
  const db = await getStateDb();
  const rows = db
    .prepare("SELECT id, plugin, kind FROM plugin_operations WHERE status = 'running'")
    .all();
  for (const row of rows) {
    db.prepare(
      "UPDATE plugin_operations SET status = 'interrupted', error = ?, finished_at = ? WHERE id = ?",
    ).run('The panel restarted while the operation ran', new Date().toISOString(), row.id);
    await cancelAgentJobs(derivePluginRoute(row.plugin));
    logger?.warn(
      { plugin: row.plugin, kind: row.kind, id: row.id },
      'Plugin operation interrupted by a restart',
    );
  }
}

/** Wait for a running operation (tests and the CLI's in-process paths). */
export async function waitForPluginOperation(plugin) {
  const entry = running.get(plugin);
  return entry ? entry.done : getPluginOperation(plugin);
}
