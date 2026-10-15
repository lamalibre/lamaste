// Lamaste's audit log — an append-only record in state.db of administrative
// decisions (hook approvals, auto-approve changes, hostings, plugin updates)
// and of what plugins' lifecycle hooks report through the `audit` effect.
//
// Entries hold metadata only. `details` is a flat-ish JSON object capped at
// AUDIT_DETAILS_MAX_BYTES; strings in it are truncated. Nothing here is ever
// a request or response body or a secret — callers pass identifiers, counts
// and reasons. The log is pruned by age and count, never edited.

import { getStateDb } from './state-db.js';

export const AUDIT_RETENTION_DAYS = 180;
export const AUDIT_MAX_ROWS = 50_000;
export const AUDIT_DETAILS_MAX_BYTES = 4096;
const AUDIT_STRING_MAX = 300;
const PRUNE_EVERY = 500;

const ACTION_RE = /^[a-z][a-z0-9.-]{0,99}$/;
const ACTOR_RE = /^[A-Za-z0-9:._@-]{1,200}$/;
const PLUGIN_RE = /^[a-z0-9-]{1,100}$/;

let insertsSincePrune = 0;

function sanitize(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    return value.length > AUDIT_STRING_MAX ? `${value.slice(0, AUDIT_STRING_MAX)}…` : value;
  }
  if (depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value).slice(0, 50)) {
      if (v !== undefined) out[String(key).slice(0, 64)] = sanitize(v, depth + 1);
    }
    return out;
  }
  return null;
}

/** Serialise `details`, dropping everything when it would exceed the cap. */
function encodeDetails(details) {
  const json = JSON.stringify(sanitize(details ?? {}) ?? {});
  if (Buffer.byteLength(json) <= AUDIT_DETAILS_MAX_BYTES) return json;
  return JSON.stringify({ truncated: true });
}

/**
 * Append one entry.
 *
 * @param {{ actor: string, action: string, plugin?: string | null, details?: object }} entry
 *   `actor` — `admin`, `agent:<label>`, `plugin:<route>` (a hook's effect),
 *   `lamaste` (the panel itself), `auto-approve`; `action` — dotted lower case
 *   (`hooks.approved`, `plugin.updated`, `hook.secret-scan.redacted`).
 */
export async function recordAudit({ actor, action, plugin = null, details = {} }) {
  if (!ACTOR_RE.test(actor)) throw new Error(`Invalid audit actor "${actor}"`);
  if (!ACTION_RE.test(action)) throw new Error(`Invalid audit action "${action}"`);
  if (plugin !== null && !PLUGIN_RE.test(plugin)) throw new Error('Invalid audit plugin');
  const db = await getStateDb();
  const at = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO audit_events (at, actor, action, plugin, details) VALUES (?, ?, ?, ?, ?)')
    .run(at, actor, action, plugin, encodeDetails(details));
  insertsSincePrune++;
  if (insertsSincePrune >= PRUNE_EVERY) {
    insertsSincePrune = 0;
    pruneAudit(db);
  }
  return { id: Number(result.lastInsertRowid), at };
}

/**
 * Append, logging instead of throwing — for paths where the audited action
 * already happened and a full disk must not turn it into an error.
 */
export async function recordAuditBestEffort(entry, logger) {
  try {
    return await recordAudit(entry);
  } catch (err) {
    logger?.error?.({ err: err.message, action: entry.action }, 'Failed to write audit entry');
    return null;
  }
}

function pruneAudit(db) {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
  db.prepare('DELETE FROM audit_events WHERE at < ?').run(cutoff);
  db.prepare(
    'DELETE FROM audit_events WHERE id <= (SELECT id FROM audit_events ORDER BY id DESC LIMIT 1 OFFSET ?)',
  ).run(AUDIT_MAX_ROWS);
}

function rowToEntry(row) {
  let details;
  try {
    details = JSON.parse(row.details);
  } catch {
    details = {};
  }
  return {
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    plugin: row.plugin,
    details,
  };
}

/**
 * Newest first. `before` pages backwards by id; `action` matches exactly or,
 * ending in `.`, as a prefix (`hooks.`).
 */
export async function listAudit({ plugin, action, before, limit = 50 } = {}) {
  const db = await getStateDb();
  const where = [];
  const args = [];
  if (plugin) {
    where.push('plugin = ?');
    args.push(plugin);
  }
  if (action) {
    if (action.endsWith('.')) {
      where.push('substr(action, 1, ?) = ?');
      args.push(action.length, action);
    } else {
      where.push('action = ?');
      args.push(action);
    }
  }
  if (before) {
    where.push('id < ?');
    args.push(before);
  }
  const sql = `SELECT id, at, actor, action, plugin, details FROM audit_events${
    where.length ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY id DESC LIMIT ?`;
  args.push(Math.min(Math.max(1, limit), 200));
  return db
    .prepare(sql)
    .all(...args)
    .map(rowToEntry);
}
