/**
 * Calls and events between app plugins (4.13, slice 8) — the relay's grants
 * and what they make effective. Design: `plugin-development/design/
 * agent-hosted-app-plugins.md`, *Slice 8 as planned*.
 *
 * **Applied shelves.** The only grants of peer calls and events are the
 * scope graphs of shelves applied to this relay: `PUT
 * /api/peers/shelves/:shelfId` with the shelf manifest's own `scopes` block
 * (`{ "<scope>": { provider, consumers } }`) replaces that shelf's edges.
 * Shelf's page applies a shelf from the administrator's browser; the CLI
 * does the same from a file. Lamaste needs no Shelf code — a shelf id is a
 * name.
 *
 * Applying refuses what cannot be right whatever happens next: a scope
 * whose namespace is not its provider, a consumer that is its provider, an
 * installed consumer that does not consume the scope or an installed
 * provider that does not provide it (`409 not_declared`), majors that
 * cannot meet (`409 major_mismatch`), and a cycle among **required** edges
 * in the union of every applied shelf (`409 cycle`) — required edges decide
 * readiness and order; optional cycles (platform plugins that consume each
 * other) are the target application's normal shape. An edge naming a
 * plugin not installed yet is kept and shown pending.
 *
 * **Grant sequence.** Each (consumer, scope) pair granted by any applied
 * shelf carries the store-wide sequence number it got when it first became
 * granted (`peer_grants`): kept while any shelf grants it, a new one after
 * a gap. It is the first part of the subscription epoch, so a consumer
 * whose grant was renewed starts at the provider's head instead of
 * receiving what was published while it had none.
 *
 * **Effective edges** — what the gateway, the channel manager and the event
 * pulls read — are the applied edges whose consumer's and provider's
 * installed, *approved* versions declare them (consume/provide, the
 * consumer's major among the provider's). Computed in memory from the
 * registry and the applied shelves; recomputed after anything that changes
 * either ({@link invalidatePeers}: an apply, an install, an update or its
 * revert, an uninstall, an approval) and at least every
 * {@link SNAPSHOT_MAX_AGE_MS}. A call reads the snapshot, never the database.
 *
 * The peers store is a leaf: its lock is taken around state.db and plain
 * reads only, never around another lock or a call to an agent half.
 */

import {
  PromiseChainMutex,
  isPeerRoute,
  isPeerScope,
  peerScopeProvider,
  peerSubscriptionEpoch,
  peersBreaks,
  peersDiff,
} from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { getStateDb } from './state-db.js';
import { readPlugins } from './plugins.js';
import { installedVersionApproved, PEERS_BREAKS, PEERS_CHANGED } from './plugin-hooks.js';

/** A shelf id: Shelf's `SHELF_ID_RE` (a DNS label, 1–32 characters). */
export const PEER_SHELF_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** At most this many scopes in one applied shelf. */
export const PEER_SHELF_MAX_SCOPES = 512;
/** At most this many consumers of one scope in one applied shelf. */
export const PEER_SHELF_MAX_CONSUMERS = 64;
/** At most this many applied shelves. */
export const PEER_SHELVES_MAX = 64;

/** The snapshot is recomputed at least this often, whatever told it to. */
const SNAPSHOT_MAX_AGE_MS = 30_000;

const lock = new PromiseChainMutex();

// ---------------------------------------------------------------------------
// The snapshot of effective edges
// ---------------------------------------------------------------------------

/**
 * @typedef {object} EffectiveEdge
 * @property {string} consumer
 * @property {string} scope
 * @property {string} provider
 * @property {number} major the consumer's
 * @property {boolean} required
 * @property {object} provided the provider's approved declaration of the scope
 * @property {object} consumed the consumer's approved declaration of the scope
 * @property {number} grantedSeq
 * @property {string[]} events the subscribed types both versions share (sorted; may be empty)
 */

/**
 * @typedef {object} PeersSnapshot
 * @property {Map<string, Map<string, EffectiveEdge>>} byConsumer consumer → scope → edge
 * @property {Array<{ shelfId: string, appliedAt: string, appliedBy: string, edges: object[] }>} shelves
 * @property {Array<{ name: string, route: string, approved: boolean, provides: object, consumes: object }>} plugins
 */

let snapshot = null;
let snapshotAt = 0;
let generation = 0;
const listeners = new Set();

/**
 * Called (in the background) after the effective edges may have changed:
 * the peer runtime attaches and drops channels then.
 *
 * @param {(logger?: object) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onPeersChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Forget the snapshot: the next read computes it again. Called after
 * anything that changes the applied shelves or a plugin's installed or
 * approved `peers` block; tells {@link onPeersChanged} listeners.
 */
export function invalidatePeers(logger) {
  generation += 1;
  snapshot = null;
  for (const listener of listeners) {
    try {
      listener(logger);
    } catch (err) {
      logger?.warn?.({ err: err?.message }, 'A peers listener failed');
    }
  }
}

/** The current snapshot of effective edges (computed when stale). */
export async function peersSnapshot() {
  if (snapshot && Date.now() - snapshotAt < SNAPSHOT_MAX_AGE_MS) return snapshot;
  const started = generation;
  const computed = await computeSnapshot();
  // Something changed while it was computed: use it once, keep nothing.
  if (started === generation) {
    snapshot = computed;
    snapshotAt = Date.now();
  }
  return computed;
}

/** Sorted intersection of two lists of event types. */
function sharedEvents(a, b) {
  const set = new Set(b ?? []);
  return [...new Set((a ?? []).filter((t) => set.has(t)))].sort();
}

/** Why an applied edge is not effective now, or null when it is. */
function pendingReason(edge, byRoute, approvedPeers) {
  const consumer = byRoute.get(edge.consumer);
  if (!consumer) return 'consumer_not_installed';
  const provider = byRoute.get(edge.provider);
  if (!provider) return 'provider_not_installed';
  const consumed = consumer.peers?.consumes?.[edge.scope];
  if (!consumed) return 'not_consumed';
  const provided = provider.peers?.provides?.[edge.scope];
  if (!provided) return 'not_provided';
  // A disabled plugin calls nobody and serves nobody: an administrator
  // disables a plugin to stop it.
  if (consumer.status !== 'enabled') return 'consumer_disabled';
  if (provider.status !== 'enabled') return 'provider_disabled';
  if (!approvedPeers.get(edge.consumer)) return 'consumer_not_approved';
  if (!approvedPeers.get(edge.provider)) return 'provider_not_approved';
  if (!provided.majors.includes(consumed.major)) return 'major_mismatch';
  return null;
}

async function computeSnapshot() {
  const db = await getStateDb();
  const shelfRows = db.prepare('SELECT * FROM peer_shelves ORDER BY shelf_id').all();
  const edgeRows = db.prepare('SELECT * FROM peer_edges ORDER BY shelf_id, scope, consumer').all();
  const grants = new Map(
    db
      .prepare('SELECT consumer, scope, granted_seq FROM peer_grants')
      .all()
      .map((row) => [`${row.consumer} ${row.scope}`, row.granted_seq]),
  );
  const { plugins } = await readPlugins();
  const byRoute = new Map(plugins.filter((p) => p.route).map((p) => [p.route, p]));
  const approvedPeers = new Map();
  for (const plugin of plugins) {
    if (!plugin.route || !plugin.peers) continue;
    // A version whose approval cannot be judged is not approved.
    const approved = await installedVersionApproved(plugin).catch(() => false);
    approvedPeers.set(plugin.route, approved);
  }

  const byConsumer = new Map();
  // Edges consumers rely on: effective ones, and those only waiting for
  // their provider to be enabled again — what removing or narrowing the
  // provider cuts, disabled or not.
  const reliance = [];
  const shelves = shelfRows.map((row) => ({
    shelfId: row.shelf_id,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    edges: [],
  }));
  const shelfById = new Map(shelves.map((s) => [s.shelfId, s]));
  for (const row of edgeRows) {
    const edge = { scope: row.scope, provider: row.provider, consumer: row.consumer };
    const reason = pendingReason(edge, byRoute, approvedPeers);
    const grantedSeq = grants.get(`${row.consumer} ${row.scope}`) ?? 0;
    shelfById.get(row.shelf_id)?.edges.push({
      ...edge,
      state: reason === null ? 'effective' : 'pending',
      ...(reason !== null ? { reason } : {}),
      grantedSeq,
    });
    if (reason !== null && reason !== 'provider_disabled') continue;
    {
      const consumed = byRoute.get(row.consumer).peers.consumes[row.scope];
      const provided = byRoute.get(row.provider).peers.provides[row.scope];
      reliance.push({
        consumer: row.consumer,
        scope: row.scope,
        provider: row.provider,
        major: consumed.major,
        required: consumed.required,
        events: sharedEvents(consumed.events, provided.events),
      });
    }
    if (reason !== null) continue;
    let scopes = byConsumer.get(row.consumer);
    if (!scopes) byConsumer.set(row.consumer, (scopes = new Map()));
    if (scopes.has(row.scope)) continue;
    const consumed = byRoute.get(row.consumer).peers.consumes[row.scope];
    const provided = byRoute.get(row.provider).peers.provides[row.scope];
    scopes.set(row.scope, {
      consumer: row.consumer,
      scope: row.scope,
      provider: row.provider,
      major: consumed.major,
      required: consumed.required,
      provided,
      consumed,
      grantedSeq,
      events: sharedEvents(consumed.events, provided.events),
    });
  }
  return {
    byConsumer,
    reliance,
    shelves,
    plugins: plugins
      .filter((p) => p.route && p.peers)
      .map((p) => ({
        name: p.name,
        route: p.route,
        approved: approvedPeers.get(p.route) === true,
        provides: p.peers.provides,
        consumes: p.peers.consumes,
      })),
  };
}

/** The effective edge `consumer` → `scope`, or null. */
export async function effectivePeerEdge(consumer, scope) {
  return (await peersSnapshot()).byConsumer.get(consumer)?.get(scope) ?? null;
}

/** Whether `route` has at least one effective outgoing edge (it may call, or be given delegations). */
export async function hasEffectiveOutgoingEdge(route) {
  return ((await peersSnapshot()).byConsumer.get(route)?.size ?? 0) > 0;
}

/** Every consumer with at least one effective edge. */
export async function effectiveConsumers() {
  return [...(await peersSnapshot()).byConsumer.keys()];
}

/** The effective edges into provider `route`. */
export async function effectiveEdgesInto(route) {
  const out = [];
  for (const scopes of (await peersSnapshot()).byConsumer.values()) {
    for (const edge of scopes.values()) if (edge.provider === route) out.push(edge);
  }
  return out;
}

/**
 * The effective subscription `consumer` ← `scope`: the provider, the types
 * both approved versions share and the edge grants, and their epoch — or
 * null when there is no edge or no shared type.
 *
 * @returns {Promise<{ provider: string, types: string[], epoch: string } | null>}
 */
export async function effectiveSubscription(consumer, scope) {
  const edge = await effectivePeerEdge(consumer, scope);
  if (!edge || edge.events.length === 0) return null;
  return {
    provider: edge.provider,
    types: edge.events,
    epoch: peerSubscriptionEpoch(edge.grantedSeq, edge.events),
  };
}

/**
 * The applied edges that name `route` — into it (`in`: it provides) and out
 * of it (`out`: it consumes) — whatever their state: what an installation
 * or update under that route inherits from the applied shelves, shown with
 * its approval.
 *
 * @param {string | null} route
 */
export async function appliedEdgesNaming(route) {
  const into = [];
  const out = [];
  if (!route) return { in: into, out };
  for (const shelf of (await peersSnapshot()).shelves) {
    for (const edge of shelf.edges) {
      const entry = {
        shelfId: shelf.shelfId,
        scope: edge.scope,
        provider: edge.provider,
        consumer: edge.consumer,
        state: edge.state,
        ...(edge.reason ? { reason: edge.reason } : {}),
      };
      if (edge.provider === route) into.push(entry);
      if (edge.consumer === route) out.push(entry);
    }
  }
  return { in: into, out };
}

// ---------------------------------------------------------------------------
// Event floors (what a consumer may resume its events from)
// ---------------------------------------------------------------------------

/**
 * The floor of `consumer`'s events of `scope` for this epoch and stream, or
 * null when the relay gave it no gap for them.
 */
export async function eventFloor(consumer, scope, epoch, streamId) {
  const db = await getStateDb();
  const row = db
    .prepare(
      'SELECT epoch, stream_id, floor FROM peer_event_floors WHERE consumer = ? AND scope = ?',
    )
    .get(consumer, scope);
  if (!row || row.epoch !== epoch || row.stream_id !== streamId) return null;
  return row.floor;
}

/**
 * Record the floor the relay is about to answer in a gap. For the same
 * epoch and stream a floor only rises; another epoch or stream replaces it.
 */
export async function recordEventFloor(consumer, scope, epoch, streamId, floor) {
  const db = await getStateDb();
  db.prepare(
    `INSERT INTO peer_event_floors (consumer, scope, epoch, stream_id, floor, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (consumer, scope) DO UPDATE SET
       floor = CASE
         WHEN peer_event_floors.epoch = excluded.epoch
          AND peer_event_floors.stream_id = excluded.stream_id
         THEN max(peer_event_floors.floor, excluded.floor)
         ELSE excluded.floor END,
       epoch = excluded.epoch,
       stream_id = excluded.stream_id,
       updated_at = excluded.updated_at`,
  ).run(consumer, scope, epoch, streamId, floor, new Date().toISOString());
}

/**
 * Forget the floors of subscriptions that are no longer effective: the next
 * grant starts with a gap anyway, at a new epoch. Returns how many went.
 */
export async function pruneEventFloors() {
  const db = await getStateDb();
  const { byConsumer } = await peersSnapshot();
  const rows = db.prepare('SELECT consumer, scope FROM peer_event_floors').all();
  const remove = db.prepare('DELETE FROM peer_event_floors WHERE consumer = ? AND scope = ?');
  let removed = 0;
  for (const row of rows) {
    const edge = byConsumer.get(row.consumer)?.get(row.scope);
    if (!edge || edge.events.length === 0) {
      remove.run(row.consumer, row.scope);
      removed += 1;
    }
  }
  return removed;
}

/**
 * The edges consumers rely on into provider `route`: the effective ones and
 * those pending only because the provider is disabled. Each (consumer,
 * scope) once.
 */
async function relianceInto(route) {
  const seen = new Set();
  const out = [];
  for (const edge of (await peersSnapshot()).reliance) {
    const key = `${edge.consumer} ${edge.scope}`;
    if (edge.provider !== route || seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

/**
 * Who relies on provider `route` (effective edges, or edges waiting only
 * for it to be enabled again): each consumer
 * once, required ones first — what uninstalling or unhosting it would cut.
 *
 * @returns {Promise<Array<{ consumer: string, scopes: string[], required: boolean }>>}
 */
export async function peerDependents(route) {
  const byConsumer = new Map();
  for (const edge of await relianceInto(route)) {
    const entry = byConsumer.get(edge.consumer) ?? {
      consumer: edge.consumer,
      scopes: [],
      required: false,
    };
    entry.scopes.push(edge.scope);
    entry.required ||= edge.required;
    byConsumer.set(edge.consumer, entry);
  }
  return [...byConsumer.values()]
    .map((e) => ({ ...e, scopes: e.scopes.sort() }))
    .sort(
      (a, b) => Number(b.required) - Number(a.required) || a.consumer.localeCompare(b.consumer),
    );
}

/**
 * Refuse (`409 peer_dependents`, the consumers named) removing provider
 * `plugin`'s hosting or the plugin itself while effective edges consume it
 * — unless `force`.
 *
 * @param {{ name: string, route: string | null }} plugin
 * @param {boolean} force
 */
export async function assertNoPeerDependents(plugin, breakPeers) {
  if (breakPeers || !plugin.route) return;
  const dependents = await peerDependents(plugin.route);
  if (dependents.length === 0) return;
  const named = dependents.map((d) => `${d.consumer}${d.required ? ' (required)' : ''}`).join(', ');
  throw httpError(
    `Plugin "${plugin.name}" provides scopes other plugins rely on: ${named} — their calls and events stop. Remove the edges from the applied shelves first, or confirm with breakPeers`,
    409,
    { code: 'peer_dependents', consumers: dependents },
  );
}

// ---------------------------------------------------------------------------
// Updates: what a staged version changes, and what it would break
// ---------------------------------------------------------------------------

/**
 * How a staged version changes the plugin's `peers` block, for the update's
 * preview: both blocks (normalized; null: that version declares none),
 * core's typed `peersDiff`, and `breaks` — the effective edges into the
 * plugin the update would end or narrow (core `peersBreaks`). Null when
 * neither version declares one.
 *
 * @param {{ route: string | null, peers?: object }} plugin the installed registry entry
 * @param {object | null} after the staged version's block, normalized
 */
export async function peersPreview(plugin, after) {
  const before = plugin.peers ?? null;
  const applied = await appliedEdgesNaming(plugin.route);
  if (!before && !after && applied.in.length === 0 && applied.out.length === 0) return null;
  const used = plugin.route
    ? (await relianceInto(plugin.route)).map((edge) => ({
        consumer: edge.consumer,
        scope: edge.scope,
        major: edge.major,
        events: edge.events,
      }))
    : [];
  return {
    before,
    after: after ?? null,
    diff: peersDiff(before, after),
    breaks: peersBreaks(before, after, used),
    appliedEdges: applied,
  };
}

/**
 * Why a staged version waits for an administrator because of its `peers`
 * block — never covered by auto-approve: it widens what the plugin reaches
 * or exposes (`peers.changed`), or ends an edge a granted consumer relies on
 * (`peers.breaks`). Narrowing alone only changes the digest.
 *
 * @param {Awaited<ReturnType<typeof peersPreview>>} preview
 * @returns {Array<{ code: string, reason: string }>}
 */
export function peersApprovalRequired(preview) {
  if (!preview) return [];
  const out = [];
  if (preview.diff.widened) {
    const { provides, consumes } = preview.diff;
    const parts = [];
    if (consumes.scopesAdded.length > 0) parts.push(`consumes ${consumes.scopesAdded.join(', ')}`);
    if (consumes.majorsChanged.length > 0) {
      parts.push(
        `speaks another major of ${consumes.majorsChanged.map((m) => `${m.scope} (${m.from} → ${m.to})`).join(', ')}`,
      );
    }
    if (consumes.subscriptionsAdded.length > 0) {
      parts.push(
        `subscribes to ${consumes.subscriptionsAdded.map((e) => `${e.scope} ${e.type}`).join(', ')}`,
      );
    }
    if (provides.scopesAdded.length > 0) parts.push(`provides ${provides.scopesAdded.join(', ')}`);
    if (provides.endpointsAdded.length > 0) {
      parts.push(`serves ${provides.endpointsAdded.length} more endpoint(s) to other plugins`);
    }
    if (provides.eventsAdded.length > 0) {
      parts.push(`publishes ${provides.eventsAdded.map((e) => `${e.scope} ${e.type}`).join(', ')}`);
    }
    out.push({
      code: PEERS_CHANGED,
      reason: `it widens what it exchanges with other plugins: it ${parts.join(' and ')}`,
    });
  }
  if (preview.breaks.length > 0) {
    const consumers = [...new Set(preview.breaks.map((b) => b.consumer))].sort();
    out.push({
      code: PEERS_BREAKS,
      reason: `it ends or narrows what ${consumers.join(', ')} rely on (${preview.breaks.map((b) => `${b.consumer} ${b.scope}: ${b.reason}`).join('; ')})`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Applying and removing shelves
// ---------------------------------------------------------------------------

/**
 * Check one shelf's `scopes` and turn them into edges. Throws 400 for a
 * shape no shelf can have, 409 for what the installed plugins refuse.
 *
 * @param {Record<string, { provider: string, consumers: string[] }>} scopes
 * @param {Map<string, object>} byRoute installed plugins by route
 * @returns {Array<{ scope: string, provider: string, consumer: string }>}
 */
function edgesOf(scopes, byRoute) {
  const entries = Object.entries(scopes ?? {});
  if (entries.length > PEER_SHELF_MAX_SCOPES) {
    throw httpError(`A shelf grants at most ${PEER_SHELF_MAX_SCOPES} scopes`, 400);
  }
  const edges = [];
  for (const [scope, entry] of entries) {
    if (!isPeerScope(scope)) throw httpError(`"${scope}" is not a scope`, 400);
    const provider = entry?.provider;
    if (!isPeerRoute(provider) || peerScopeProvider(scope) !== provider) {
      throw httpError(
        `The provider of "${scope}" is its namespace, "${peerScopeProvider(scope)}"`,
        400,
        {
          code: 'namespace',
        },
      );
    }
    const consumers = Array.isArray(entry.consumers) ? entry.consumers : [];
    if (consumers.length > PEER_SHELF_MAX_CONSUMERS) {
      throw httpError(`A scope has at most ${PEER_SHELF_MAX_CONSUMERS} consumers`, 400);
    }
    if (new Set(consumers).size !== consumers.length) {
      throw httpError(`A consumer of "${scope}" is named twice`, 400);
    }
    const providing = byRoute.get(provider);
    const provided = providing ? (providing.peers?.provides?.[scope] ?? null) : undefined;
    if (provided === null) {
      throw httpError(`Plugin "${provider}" does not provide "${scope}"`, 409, {
        code: 'not_declared',
        scope,
        plugin: provider,
      });
    }
    for (const consumer of consumers) {
      if (!isPeerRoute(consumer)) throw httpError(`"${consumer}" is not a plugin route`, 400);
      if (consumer === provider) {
        throw httpError(`Plugin "${provider}" does not consume its own scope "${scope}"`, 400);
      }
      const consuming = byRoute.get(consumer);
      const consumed = consuming ? (consuming.peers?.consumes?.[scope] ?? null) : undefined;
      if (consumed === null) {
        throw httpError(`Plugin "${consumer}" does not consume "${scope}"`, 409, {
          code: 'not_declared',
          scope,
          plugin: consumer,
        });
      }
      if (provided && consumed && !provided.majors.includes(consumed.major)) {
        throw httpError(
          `Plugin "${consumer}" speaks major ${consumed.major} of "${scope}"; "${provider}" serves ${provided.majors.join(', ')}`,
          409,
          { code: 'major_mismatch', scope, consumer },
        );
      }
      edges.push({ scope, provider, consumer });
    }
  }
  return edges;
}

/**
 * A cycle among required edges (consumer → provider, where the installed
 * consumer marks the scope required), as the plugin path with the first
 * plugin repeated at the end, or null.
 *
 * @param {Array<{ scope: string, provider: string, consumer: string }>} edges
 * @param {Map<string, object>} byRoute
 */
export function requiredCycle(edges, byRoute) {
  const next = new Map();
  for (const edge of edges) {
    if (byRoute.get(edge.consumer)?.peers?.consumes?.[edge.scope]?.required !== true) continue;
    const list = next.get(edge.consumer) ?? [];
    if (!list.includes(edge.provider)) list.push(edge.provider);
    next.set(edge.consumer, list);
  }
  const state = new Map(); // undefined: new, 1: on the stack, 2: done
  for (const root of [...next.keys()].sort()) {
    if (state.get(root)) continue;
    const stack = [{ node: root, i: 0 }];
    const path = [root];
    state.set(root, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const out = next.get(top.node) ?? [];
      if (top.i >= out.length) {
        state.set(top.node, 2);
        stack.pop();
        path.pop();
        continue;
      }
      const to = out[top.i++];
      if (state.get(to) === 1) return [...path.slice(path.indexOf(to)), to];
      if (!state.get(to)) {
        state.set(to, 1);
        stack.push({ node: to, i: 0 });
        path.push(to);
      }
    }
  }
  return null;
}

/**
 * The grant sequence follows the applied edges: a pair granted by any
 * shelf keeps its number, a new pair gets the next one, a pair no shelf
 * grants any more is forgotten. Inside the caller's transaction.
 */
function syncGrants(db) {
  const granted = new Set(
    db
      .prepare('SELECT DISTINCT consumer, scope FROM peer_edges')
      .all()
      .map((r) => `${r.consumer} ${r.scope}`),
  );
  const known = db.prepare('SELECT consumer, scope FROM peer_grants').all();
  const remove = db.prepare('DELETE FROM peer_grants WHERE consumer = ? AND scope = ?');
  for (const row of known) {
    const key = `${row.consumer} ${row.scope}`;
    if (!granted.delete(key)) remove.run(row.consumer, row.scope);
  }
  if (granted.size === 0) return;
  const bump = db.prepare('UPDATE peer_counter SET seq = seq + 1 WHERE id = 1 RETURNING seq');
  const insert = db.prepare(
    'INSERT INTO peer_grants (consumer, scope, granted_seq) VALUES (?, ?, ?)',
  );
  for (const key of [...granted].sort()) {
    const [consumer, scope] = key.split(' ');
    insert.run(consumer, scope, bump.get().seq);
  }
}

function assertShelfId(shelfId) {
  if (typeof shelfId !== 'string' || !PEER_SHELF_ID_RE.test(shelfId)) {
    throw httpError('A shelf id is a DNS label of 1–32 characters', 400);
  }
}

/**
 * Apply shelf `shelfId`'s scope graph to the relay: its edges replace the
 * ones it had. Returns the shelf as {@link peersView} shows it.
 *
 * @param {string} shelfId
 * @param {Record<string, { provider: string, consumers: string[] }>} scopes
 * @param {{ actor: string, logger?: object }} opts
 */
export async function applyPeerShelf(shelfId, scopes, { actor, logger }) {
  assertShelfId(shelfId);
  const counts = await lock.run(async () => {
    const { plugins } = await readPlugins();
    const byRoute = new Map(plugins.filter((p) => p.route).map((p) => [p.route, p]));
    const edges = edgesOf(scopes, byRoute);
    const db = await getStateDb();
    const exists = db.prepare('SELECT 1 FROM peer_shelves WHERE shelf_id = ?').get(shelfId);
    if (!exists) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM peer_shelves').get();
      if (n >= PEER_SHELVES_MAX) {
        throw httpError(`At most ${PEER_SHELVES_MAX} shelves can be applied to a relay`, 409, {
          code: 'too_many_shelves',
        });
      }
    }
    const others = db
      .prepare('SELECT scope, provider, consumer FROM peer_edges WHERE shelf_id <> ?')
      .all(shelfId);
    const cycle = requiredCycle([...others, ...edges], byRoute);
    if (cycle) {
      throw httpError(
        `Required edges would form a cycle: ${cycle.join(' → ')} — at least one of these consumes must not be required`,
        409,
        { code: 'cycle', cycle },
      );
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO peer_shelves (shelf_id, applied_at, applied_by) VALUES (?, ?, ?)
           ON CONFLICT (shelf_id) DO UPDATE SET applied_at = excluded.applied_at,
             applied_by = excluded.applied_by`,
      ).run(shelfId, new Date().toISOString(), actor);
      db.prepare('DELETE FROM peer_edges WHERE shelf_id = ?').run(shelfId);
      const insert = db.prepare(
        'INSERT INTO peer_edges (shelf_id, scope, provider, consumer) VALUES (?, ?, ?, ?)',
      );
      for (const edge of edges) insert.run(shelfId, edge.scope, edge.provider, edge.consumer);
      syncGrants(db);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { scopes: Object.keys(scopes ?? {}).length, edges: edges.length, replaced: !!exists };
  });
  await recordAuditBestEffort(
    { actor, action: 'peer.shelf.applied', details: { shelfId, ...counts } },
    logger,
  );
  invalidatePeers(logger);
  const view = await peersView();
  return view.shelves.find((s) => s.shelfId === shelfId) ?? null;
}

/**
 * Remove applied shelf `shelfId` and its edges (404 when it is not applied).
 *
 * @param {string} shelfId
 * @param {{ actor: string, logger?: object }} opts
 */
export async function removePeerShelf(shelfId, { actor, logger }) {
  assertShelfId(shelfId);
  const edges = await lock.run(async () => {
    const db = await getStateDb();
    if (!db.prepare('SELECT 1 FROM peer_shelves WHERE shelf_id = ?').get(shelfId)) {
      throw httpError(`Shelf "${shelfId}" is not applied to this relay`, 404);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const { changes } = db.prepare('DELETE FROM peer_edges WHERE shelf_id = ?').run(shelfId);
      db.prepare('DELETE FROM peer_shelves WHERE shelf_id = ?').run(shelfId);
      syncGrants(db);
      db.exec('COMMIT');
      return Number(changes);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
  await recordAuditBestEffort(
    { actor, action: 'peer.shelf.removed', details: { shelfId, edges } },
    logger,
  );
  invalidatePeers(logger);
  return { shelfId, edges };
}

/**
 * What the relay knows of calls and events between plugins: every applied
 * shelf with its edges and their state (`effective`, or `pending` with the
 * reason), each edge's `epoch` part (`grantedSeq`), and every installed
 * plugin's `peers` declaration with whether its version is approved.
 */
export async function peersView() {
  const snap = await peersSnapshot();
  return {
    shelves: snap.shelves,
    plugins: snap.plugins,
    edges: [...snap.byConsumer.values()].flatMap((scopes) =>
      [...scopes.values()].map((e) => ({
        consumer: e.consumer,
        scope: e.scope,
        provider: e.provider,
        major: e.major,
        required: e.required,
        events: e.events,
        ...(e.events.length > 0 ? { epoch: peerSubscriptionEpoch(e.grantedSeq, e.events) } : {}),
      })),
    ),
  };
}
