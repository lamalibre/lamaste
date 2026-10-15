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

import { getStateDb } from './state-db.js';

function rowToRecord(row) {
  return {
    agentLabel: row.agent_label,
    route: row.route,
    plugin: row.plugin,
    package: row.package,
    since: row.since,
    operation: row.operation,
  };
}

/**
 * Record that agent `agentLabel` keeps the data of route `route`, owned by
 * agent package `pkg` of plugin `plugin`. A record that exists already keeps
 * its `since` — the data has been there since then.
 *
 * @param {{ agentLabel: string, route: string, plugin: string, package: string, operation?: string | null }} record
 */
export async function recordRetainedData({ agentLabel, route, plugin, package: pkg, operation }) {
  const db = await getStateDb();
  db.prepare(
    `INSERT INTO retained_agent_data (agent_label, route, plugin, package, since, operation)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_label, route) DO UPDATE SET
       plugin = excluded.plugin,
       package = excluded.package,
       operation = excluded.operation`,
  ).run(agentLabel, route, plugin, pkg, new Date().toISOString(), operation ?? null);
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
