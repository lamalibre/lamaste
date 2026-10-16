/**
 * When each machine agent last contacted the relay — the hosting-agent
 * state the panel shows next to a hosted plugin ("hosting agent offline
 * since … — last sync …").
 *
 * An agent's sync timer calls `GET /api/tunnels/agent-config` every 30 s;
 * that call records the agent here. The time is kept in memory and written
 * to `agent_presence` at most once per {@link PRESENCE_PERSIST_INTERVAL_MS}
 * per agent, so a restart of the panel loses at most that much — and the
 * `agents` table, which the registry rewrites whole, is never touched.
 */

import { getStateDb } from './state-db.js';

/** An agent's contact is written to state.db at most this often. */
export const PRESENCE_PERSIST_INTERVAL_MS = 60_000;

/** label → { seenAt, persistedAt } (epoch milliseconds); filled from the table once. */
const presence = new Map();
let loaded = false;
let clock = () => Date.now();

/** Replace the clock (tests); null restores `Date.now`. */
export function setPresenceClockForTests(fn) {
  clock = fn ?? (() => Date.now());
}

/** Forget what memory holds, as a restart of the panel would (tests). */
export function forgetPresenceMemoryForTests() {
  presence.clear();
  loaded = false;
}

function loadOnce(db) {
  if (loaded) return;
  for (const row of db.prepare('SELECT label, last_seen_at FROM agent_presence').all()) {
    const at = Date.parse(row.last_seen_at);
    if (Number.isFinite(at) && !presence.has(row.label)) {
      presence.set(row.label, { seenAt: at, persistedAt: at });
    }
  }
  loaded = true;
}

/**
 * Agent `label` contacted the relay now. Returns whether the contact was
 * written to state.db (false while the last write is under a minute old).
 *
 * @param {string} label
 * @returns {Promise<{ persisted: boolean }>}
 */
export async function recordAgentContact(label) {
  const db = await getStateDb();
  loadOnce(db);
  const now = clock();
  const entry = presence.get(label);
  if (
    entry &&
    entry.persistedAt !== null &&
    now >= entry.persistedAt &&
    now - entry.persistedAt < PRESENCE_PERSIST_INTERVAL_MS
  ) {
    entry.seenAt = Math.max(entry.seenAt, now);
    return { persisted: false };
  }
  db.prepare(
    `INSERT INTO agent_presence (label, last_seen_at) VALUES (?, ?)
     ON CONFLICT(label) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).run(label, new Date(now).toISOString());
  presence.set(label, { seenAt: now, persistedAt: now });
  return { persisted: true };
}

/**
 * When each agent last contacted the relay (ISO 8601), by label. Agents
 * that never did are absent.
 *
 * @returns {Promise<Map<string, string>>}
 */
export async function agentPresenceMap() {
  const db = await getStateDb();
  loadOnce(db);
  const out = new Map();
  for (const [label, entry] of presence) out.set(label, new Date(entry.seenAt).toISOString());
  return out;
}

/**
 * When agent `label` last contacted the relay (ISO 8601), or null.
 * @param {string} label
 */
export async function agentLastSeenAt(label) {
  return (await agentPresenceMap()).get(label) ?? null;
}

/**
 * Drop what is known of agent `label` — its certificate was revoked, and a
 * later enrollment reusing the label must not inherit its last contact.
 * @param {string} label
 */
export async function forgetAgentPresence(label) {
  const db = await getStateDb();
  loadOnce(db);
  db.prepare('DELETE FROM agent_presence WHERE label = ?').run(label);
  presence.delete(label);
}
