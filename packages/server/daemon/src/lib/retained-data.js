/**
 * Data an agent half leaves on an agent. Removing an agent half without
 * purge (an unhost, an uninstall, a rolled-back install) keeps its data
 * directory and service account on the agent, both named after the route;
 * the relay keeps a record of it so an administrator can purge it later —
 * after the plugin is gone, too — and so another agent package is never
 * installed over it.
 *
 * One record per agent and route (`retained_agent_data`, migration 0010),
 * the way the data exists on the agent. A record goes when the data is
 * purged, or when the same agent package is installed there again and
 * takes the data back.
 */

import { APPHOST_PATHS, appServiceUser } from '@lamalibre/lamaste';
import { getStateDb } from './state-db.js';

/**
 * A record as the API shows it: what the table keeps, and what a purge
 * deletes on the agent — the data directory and the account, both derived
 * from the route — so a panel or CLI confirmation can name them.
 */
function rowToRecord(row) {
  return {
    agentLabel: row.agent_label,
    route: row.route,
    plugin: row.plugin,
    package: row.package,
    since: row.since,
    operation: row.operation,
    dataDir: APPHOST_PATHS.dataDir(row.route),
    serviceUser: appServiceUser(row.route),
  };
}

/**
 * Record that agent `agentLabel` keeps the data of route `route`, owned by
 * agent package `pkg` of plugin `plugin`. A record that exists already keeps
 * its `since` — the data has been there since then.
 *
 * With it goes how far the agent half's identity projection — part of that
 * data — had applied the plugin's feed, as the half last answered (the
 * plugin's feed state, read now, before the hosting's is forgotten): the
 * erasures of the plugin's ledger after that cursor are pending on this
 * agent (`pendingErasures` in `lib/identity-sync.js`). When the relay knows
 * no position, a record that exists keeps the one it had — the projection
 * did not move without a feed.
 *
 * @param {{ agentLabel: string, route: string, plugin: string, package: string, operation?: string | null }} record
 */
export async function recordRetainedData({ agentLabel, route, plugin, package: pkg, operation }) {
  const db = await getStateDb();
  const feed = db
    .prepare('SELECT directory_id, cursor FROM plugin_identity_sync WHERE plugin = ?')
    .get(plugin);
  const known = feed && feed.directory_id !== null && feed.cursor !== null;
  db.prepare(
    `INSERT INTO retained_agent_data
       (agent_label, route, plugin, package, since, operation, identity_directory_id, identity_cursor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_label, route) DO UPDATE SET
       plugin = excluded.plugin,
       package = excluded.package,
       operation = excluded.operation,
       identity_directory_id = CASE WHEN excluded.identity_cursor IS NULL
         THEN identity_directory_id ELSE excluded.identity_directory_id END,
       identity_cursor = COALESCE(excluded.identity_cursor, identity_cursor)`,
  ).run(
    agentLabel,
    route,
    plugin,
    pkg,
    new Date().toISOString(),
    operation ?? null,
    known ? feed.directory_id : null,
    known ? Number(feed.cursor) : null,
  );
}

/**
 * Where the identity projection in each record's data stands, for plugin
 * `plugin`: `[{ agentLabel, directoryId, cursor }]` (both null when unknown).
 *
 * @param {string} plugin
 */
export async function retainedIdentityPositions(plugin) {
  const db = await getStateDb();
  return db
    .prepare(
      `SELECT agent_label, identity_directory_id, identity_cursor FROM retained_agent_data
       WHERE plugin = ? ORDER BY since, agent_label`,
    )
    .all(plugin)
    .map((row) => ({
      agentLabel: row.agent_label,
      directoryId: row.identity_directory_id,
      cursor: row.identity_cursor === null ? null : Number(row.identity_cursor),
    }));
}

/** Drop the record of the data agent `agentLabel` keeps for route `route` (purged, or taken back). */
export async function forgetRetainedData(agentLabel, route) {
  const db = await getStateDb();
  return Number(
    db
      .prepare('DELETE FROM retained_agent_data WHERE agent_label = ? AND route = ?')
      .run(agentLabel, route).changes,
  );
}

/** The record for agent `agentLabel` and route `route`, or null. */
export async function findRetainedData(agentLabel, route) {
  const db = await getStateDb();
  const row = db
    .prepare('SELECT * FROM retained_agent_data WHERE agent_label = ? AND route = ?')
    .get(agentLabel, route);
  return row ? rowToRecord(row) : null;
}

/**
 * Records, oldest first — all of them, those of plugin `plugin` (by the name
 * it had; it may be uninstalled), or those on agent `agentLabel`.
 *
 * @param {{ plugin?: string, agentLabel?: string }} [filter]
 */
export async function listRetainedData({ plugin, agentLabel } = {}) {
  const db = await getStateDb();
  const where = [];
  const args = [];
  if (plugin) {
    where.push('plugin = ?');
    args.push(plugin);
  }
  if (agentLabel) {
    where.push('agent_label = ?');
    args.push(agentLabel);
  }
  return db
    .prepare(
      `SELECT * FROM retained_agent_data${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
       ORDER BY since, agent_label, route`,
    )
    .all(...args)
    .map(rowToRecord);
}
