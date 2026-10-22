/**
 * Plugin audiences — who each agent-hosted plugin's users are, as its agent
 * half is told (`identity.ts` in the core library: `AudienceChange`).
 *
 * For every installed plugin that declares `identity`, the audience is the
 * directory's users who hold at least one of its roles: the union of the
 * roles of their direct entitlements and of the Lamaste groups they are in
 * (`lib/entitlements.js` — only plugin grants with roles count), restricted
 * to the roles the installed version declares. A member is carried in full
 * (`upsert`: id, username, the declared attributes the directory has, the
 * roles, `active` or `disabled`, the record's version); a user who leaves is
 * a `remove` — `unentitled` (lost every role) or `deleted` (removed from the
 * directory), each with the last known declared attributes, or `erased`
 * (scrubbed: nothing but the id). Users who were never members have no row.
 *
 * The audience is materialised in `plugin_audience` (state.db): one row per
 * plugin and user, the change as the feed delivers it (without `seq`),
 * written only when it differs from the stored one — its version goes up by
 * one and the triggers stamp the next store-wide `seq`. A removal carries
 * what the plugin last received about the user (less any attribute it no
 * longer declares): what the directory learns about someone who left is no
 * longer the plugin's.
 *
 * Recomputed after every change of users, of the directory and of
 * entitlements made through the panel (the Gatekeeper proxy included), on
 * plugin install, update and approval, every minute (Gatekeeper's own CLI
 * edits), and at start. Recomputes are serialised and coalesce. When
 * Gatekeeper cannot be read the stored audience stays as it is, and the next
 * recompute tries again. A plugin whose rows changed is synced to its agent
 * half (`lib/identity-sync.js`).
 */

import {
  AudienceChangeSchema,
  AudienceMemberSchema,
  IDENTITY_ATTRIBUTES,
  isLamasteUsername,
} from '@lamalibre/lamaste';
import { listDirectoryUsers, pendingPrincipalCleanups } from './directory.js';
import { declaredRoleIds, grantRoles } from './entitlements.js';
import { listGatekeeperGroups, listPluginGrants } from './gatekeeper-client.js';
import { readPlugins } from './plugins.js';
import { getStateDb } from './state-db.js';

// ---------------------------------------------------------------------------
// Reading the stored audience
// ---------------------------------------------------------------------------

function parseChange(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @typedef {object} AudienceRow
 * @property {string} userId
 * @property {object} change the AudienceChange without `seq`
 * @property {number} version
 * @property {number} seq
 * @property {string} updatedAt
 */

function rowToAudience(row) {
  return {
    userId: row.user_id,
    change: parseChange(row.change),
    version: row.version,
    seq: row.seq,
    updatedAt: row.updated_at,
  };
}

/**
 * The plugin's audience rows in `seq` order — members and tombstones.
 *
 * @param {string} plugin
 * @returns {Promise<AudienceRow[]>}
 */
export async function listAudience(plugin) {
  const db = await getStateDb();
  return db
    .prepare('SELECT * FROM plugin_audience WHERE plugin = ? ORDER BY seq')
    .all(plugin)
    .map(rowToAudience);
}

/**
 * The plugin's rows stamped after `cursor`, in `seq` order — what a half at
 * that cursor has not applied.
 *
 * @param {string} plugin
 * @param {number} cursor
 * @returns {Promise<AudienceRow[]>}
 */
export async function audienceRowsAfter(plugin, cursor) {
  const db = await getStateDb();
  return db
    .prepare('SELECT * FROM plugin_audience WHERE plugin = ? AND seq > ? ORDER BY seq')
    .all(plugin, cursor)
    .map(rowToAudience);
}

/**
 * The plugin's head: the highest `seq` of its rows, 0 when it has none.
 *
 * @param {string} plugin
 */
export async function audienceHead(plugin) {
  const db = await getStateDb();
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM plugin_audience WHERE plugin = ?')
    .get(plugin);
  return Number(row.head);
}

/**
 * One user's row in the plugin's audience, or null.
 *
 * @param {string} plugin
 * @param {string} userId
 * @returns {Promise<AudienceRow | null>}
 */
export async function readAudienceRow(plugin, userId) {
  const db = await getStateDb();
  const row = db
    .prepare('SELECT * FROM plugin_audience WHERE plugin = ? AND user_id = ?')
    .get(plugin, userId);
  return row ? rowToAudience(row) : null;
}

/**
 * How many of the plugin's rows are active members, disabled members,
 * removed (deleted or unentitled) and erased; and its head.
 *
 * @param {string} plugin
 */
export async function audienceSummary(plugin) {
  const rows = await listAudience(plugin);
  const summary = { active: 0, disabled: 0, removed: 0, erased: 0, head: 0 };
  for (const row of rows) {
    summary.head = Math.max(summary.head, row.seq);
    const change = row.change;
    if (change?.kind === 'upsert') {
      if (change.member?.status === 'disabled') summary.disabled += 1;
      else summary.active += 1;
    } else if (change?.reason === 'erased') summary.erased += 1;
    else summary.removed += 1;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Computing a plugin's audience
// ---------------------------------------------------------------------------

/**
 * The roles each username holds on the plugin: the union over its direct
 * entitlements and those of the Lamaste groups it is in, restricted to the
 * declared roles, sorted. Grants without roles never count.
 *
 * @param {Array<{ principalType: 'user' | 'group', principalId: string, context: Record<string, unknown> }>} grants
 * @param {Map<string, { members: string[] }>} groups by name
 * @param {Set<string>} declared role ids
 * @returns {Map<string, string[]>}
 */
function rolesByUsername(grants, groups, declared) {
  const held = new Map();
  const add = (username, roles) => {
    let set = held.get(username);
    if (!set) {
      set = new Set();
      held.set(username, set);
    }
    for (const role of roles) if (declared.has(role)) set.add(role);
  };
  for (const grant of grants) {
    const roles = grantRoles(grant);
    if (!roles) continue;
    if (grant.principalType === 'user') add(grant.principalId, roles);
    else for (const member of groups.get(grant.principalId)?.members ?? []) add(member, roles);
  }
  const out = new Map();
  for (const [username, set] of held) if (set.size > 0) out.set(username, [...set].sort());
  return out;
}

/**
 * The declared attributes the directory has for `user` (its fields carry
 * the attributes' names) that pass the feed's checks — an attribute the
 * directory lacks, or that does not pass (a display name with control
 * characters, say), is left out.
 */
function declaredAttributes(user, attributes) {
  const out = {};
  for (const attribute of IDENTITY_ATTRIBUTES) {
    if (!attributes.includes(attribute)) continue;
    const value = user[attribute];
    if (
      typeof value === 'string' &&
      AudienceMemberSchema.shape[attribute].safeParse(value).success
    ) {
      out[attribute] = value;
    }
  }
  return out;
}

/** The change of a member; `version` is filled in when it is written. */
function upsertChange(user, roles, attributes) {
  return {
    kind: 'upsert',
    member: {
      userId: user.userId,
      username: user.username,
      ...declaredAttributes(user, attributes),
      roles,
      status: user.status,
      version: 0,
    },
  };
}

/**
 * What the plugin last received about a user, restricted to the attributes
 * it declares now: the member it was sent, or the `last` of the removal it
 * was sent. Null when that was an erasure.
 */
function lastDelivered(change, attributes) {
  const source = change.kind === 'upsert' ? change.member : change.last;
  if (!source || typeof source.username !== 'string') return null;
  const last = { username: source.username };
  for (const attribute of IDENTITY_ATTRIBUTES) {
    if (attributes.includes(attribute) && typeof source[attribute] === 'string') {
      last[attribute] = source[attribute];
    }
  }
  return last;
}

/** A change as compared: a member's version is the row's, not part of what changed. */
function comparable(change) {
  if (change?.kind !== 'upsert') return JSON.stringify(change);
  return JSON.stringify({ kind: 'upsert', member: { ...change.member, version: 0 } });
}

/**
 * What the plugin's audience should hold for each user: a member's full
 * state, or the reason a former member left with what the plugin last
 * received about them — a user who left is no longer the plugin's to hear
 * about, so later changes in the directory never reach it, and attributes
 * it stopped declaring are dropped. Nothing is said about users who were
 * never members. A username whose earlier holder's Gatekeeper principal is
 * still to be cleared (`pending`) holds no role: what Gatekeeper has under
 * it may be theirs.
 *
 * @param {object} identity the plugin's normalized identity block
 * @param {import('./directory.js').DirectoryUser[]} users
 * @param {Map<string, string[]>} roles by username
 * @param {Map<string, AudienceRow>} stored by user id
 * @param {Set<string>} [pending] usernames with a pending principal cleanup
 * @returns {{ desired: Map<string, object>, ineligible: number }}
 */
function desiredAudience(identity, users, roles, stored, pending = new Set()) {
  const attributes = identity.attributes ?? [];
  const desired = new Map();
  let ineligible = 0;
  for (const user of users) {
    const existing = stored.get(user.userId)?.change ?? null;
    /** A former member leaves (or stays gone) for `reason`. */
    const leave = (reason) => {
      const last = lastDelivered(existing, attributes);
      if (last) desired.set(user.userId, { kind: 'remove', userId: user.userId, reason, last });
    };
    if (user.erasedAt !== null) {
      // An erased user is the id alone.
      if (existing) {
        desired.set(user.userId, { kind: 'remove', userId: user.userId, reason: 'erased' });
      }
      continue;
    }
    if (user.status === 'removed') {
      if (existing) leave('deleted');
      continue;
    }
    const held = pending.has(user.username) ? undefined : roles.get(user.username);
    if (held && held.length > 0) {
      // A username the feed cannot carry is never a member (users.yml
      // edited outside Lamaste may hold one); counted, never named.
      if (isLamasteUsername(user.username)) {
        desired.set(user.userId, upsertChange(user, held, attributes));
      } else ineligible += 1;
      continue;
    }
    if (existing) leave('unentitled');
  }
  return { desired, ineligible };
}

/**
 * Write the rows of `desired` that differ from `stored`, in one transaction:
 * version + 1 (1 for a new row), a member's version set to it, each change
 * checked against core's `AudienceChangeSchema` first (one that fails is not
 * written, and logged by user id). Returns how many rows were written.
 */
function writeAudience(db, plugin, desired, stored, logger) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO plugin_audience (plugin, user_id, change, version, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const update = db.prepare(
    'UPDATE plugin_audience SET change = ?, version = ?, updated_at = ? WHERE plugin = ? AND user_id = ?',
  );
  let written = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [userId, change] of desired) {
      const existing = stored.get(userId) ?? null;
      if (existing && comparable(existing.change) === comparable(change)) continue;
      const version = existing ? existing.version + 1 : 1;
      const next =
        change.kind === 'upsert'
          ? { kind: 'upsert', member: { ...change.member, version } }
          : change;
      if (!AudienceChangeSchema.safeParse({ seq: 1, ...next }).success) {
        logger?.error({ plugin, userId }, 'An audience change is not the contract — not written');
        continue;
      }
      const text = JSON.stringify(next);
      if (existing) update.run(text, version, now, plugin, userId);
      else insert.run(plugin, userId, text, version, now);
      written += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return written;
}

/** Ineligible users last logged per plugin, so a steady count is logged once. */
const loggedIneligible = new Map();

/**
 * One recompute of every audience. Never throws: a plugin whose grants
 * cannot be read keeps its stored audience (logged, without names).
 *
 * @returns {Promise<{ plugins: Array<{ plugin: string, written: number }>, error?: string }>}
 */
async function recomputeOnce(logger) {
  const out = { plugins: [] };
  try {
    const db = await getStateDb();
    const plugins = (await readPlugins()).plugins.filter((p) => p.identity && p.route);
    const declaring = new Set(plugins.map((p) => p.name));

    // A plugin that no longer declares identity (or is gone) takes no feed:
    // its audience and sync state go.
    const leftovers = db
      .prepare(
        'SELECT DISTINCT plugin FROM plugin_audience UNION SELECT plugin FROM plugin_identity_sync',
      )
      .all()
      .map((row) => row.plugin)
      .filter((name) => !declaring.has(name));
    for (const name of leftovers) {
      db.prepare('DELETE FROM plugin_audience WHERE plugin = ?').run(name);
      db.prepare('DELETE FROM plugin_identity_sync WHERE plugin = ?').run(name);
      logger?.info({ plugin: name }, 'Dropped the audience of a plugin that declares no identity');
    }
    if (plugins.length === 0) return out;

    const groupsResult = await listGatekeeperGroups();
    if (!groupsResult.ok) {
      logger?.warn(
        { reason: groupsResult.reason, status: groupsResult.statusCode },
        'Gatekeeper groups could not be read — plugin audiences kept as they are',
      );
      return { ...out, error: groupsResult.error };
    }
    const groups = new Map(groupsResult.groups.map((g) => [g.name, g]));
    const users = await listDirectoryUsers();
    const pending = await pendingPrincipalCleanups();

    for (const plugin of plugins) {
      const grants = await listPluginGrants(plugin.route);
      if (!grants.ok) {
        logger?.warn(
          { plugin: plugin.name, reason: grants.reason, status: grants.statusCode },
          'Gatekeeper grants could not be read — the plugin audience is kept as it is',
        );
        continue;
      }
      const declared = declaredRoleIds(plugin.identity);
      const stored = new Map((await listAudience(plugin.name)).map((row) => [row.userId, row]));
      const { desired, ineligible } = desiredAudience(
        plugin.identity,
        users,
        rolesByUsername(grants.grants, groups, declared),
        stored,
        pending,
      );
      if ((loggedIneligible.get(plugin.name) ?? 0) !== ineligible) {
        loggedIneligible.set(plugin.name, ineligible);
        if (ineligible > 0) {
          logger?.warn(
            { plugin: plugin.name, ineligible },
            'Entitled users whose username the identity feed cannot carry are left out of the audience',
          );
        }
      }
      const written = writeAudience(db, plugin.name, desired, stored, logger);
      out.plugins.push({ plugin: plugin.name, written });
      if (written > 0) {
        logger?.info({ plugin: plugin.name, written }, 'Plugin audience changed');
      }
    }
  } catch (err) {
    logger?.error({ err: err.message }, 'Recomputing the plugin audiences failed');
    return { ...out, error: err.message };
  }

  const changed = out.plugins.filter((p) => p.written > 0).map((p) => p.plugin);
  if (changed.length > 0) {
    try {
      const { syncPluginIdentity } = await import('./identity-sync.js');
      for (const name of changed) void syncPluginIdentity(name, { logger });
    } catch (err) {
      logger?.error({ err: err.message }, 'Could not start the identity sync of changed audiences');
    }
  }
  return out;
}

/** The end of the last recompute started (settled, never rejected). */
let tail = Promise.resolve();
/** A recompute waiting for the running one to end: every request made meanwhile joins it. */
let queued = null;
/** The logger of the latest request — background recomputes log through it. */
let lastLogger = null;

/**
 * Resolves once no recompute runs or waits — tests, and whatever needs the
 * audiences settled.
 */
export async function audiencesIdle() {
  for (;;) {
    const current = tail;
    await current;
    if (current === tail && queued === null) return;
  }
}

/**
 * Recompute every plugin's audience and write what changed. Serialised:
 * a request made while one runs waits for the next run — which starts
 * after it, so it sees every change made before the request — and every
 * request made meanwhile shares that run. Never rejects; plugins whose rows
 * changed are synced to their agent halves.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<{ plugins: Array<{ plugin: string, written: number }>, error?: string }>}
 */
export function recomputeAudiences({ logger } = {}) {
  if (logger) lastLogger = logger;
  if (queued) return queued;
  const run = tail.then(() => {
    queued = null;
    return recomputeOnce(lastLogger);
  });
  queued = run;
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
