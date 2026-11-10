/**
 * Native clients — one per application host (native-apps-design.md D2).
 *
 * An administrator registers a native client for a user-surface host: a
 * plugin-owned site, or a tunnel bound to plugin routes. Lamaste renders it
 * into Authelia as a public OIDC client (core `renderNativeClient`: PKCE
 * `S256`, authorization code + refresh token, the host's audience and its
 * claimed redirect URIs, the domain's two-factor policy) and tells
 * Gatekeeper which client belongs to which host (`native-apps.json`, the
 * projection its bearer check reads). The token broker
 * (`routes/native-oauth.js`) and the grants (`lib/native-grants.js`) do the
 * rest.
 *
 * The client's host is named by kind and id; its hostname and domain are
 * read from `sites.json` / `tunnels.json` on every use, never stored twice.
 * A client is **served** — rendered into Authelia, listed to Gatekeeper,
 * answered by the broker — while it is enabled, its host entry exists and
 * its host lies under an active domain. A host entry that is gone (its
 * tunnel or site deleted) takes the client with it
 * ({@link reconcileNativeClientHosts}).
 *
 * Authelia's OIDC section and Gatekeeper's projection are written by one
 * writer, under the domain rendering lock (`lib/plugin-oidc.js`
 * `syncOidcClients`, which asks {@link planNativeClients} for the native
 * clients and {@link writeNativeAppsProjection} for the projection).
 */

import path from 'node:path';

import {
  NativeClientCreateSchema,
  NativeClientUpdateSchema,
  atomicWriteJSONIfChanged,
  domainOfHost,
  nativeAudience,
  nativeClientId,
  nativeClientLifetimesValid,
  nativeRedirectUris,
  userSurfaceHosts,
} from '@lamalibre/lamaste';

import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { activeDomainNames } from './domains.js';
import { deleteNativeGrantsOfClient, revokeNativeGrants } from './native-grants.js';
import { getStateDb } from './state-db.js';
import { readSites, readTunnels } from './state.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** Gatekeeper's projection of the native clients (0600). */
export const NATIVE_APPS_PROJECTION_FILE = 'native-apps.json';

/** Whether an error is SQLite's UNIQUE constraint. */
const isUniqueViolation = (err) => /UNIQUE constraint failed/.test(err?.message ?? '');

/**
 * A client row as the API and the renderers read it (the host not yet
 * resolved).
 */
function clientOf(row) {
  return {
    clientId: row.client_id,
    hostKind: row.host_kind,
    hostId: row.host_id,
    name: row.name,
    redirectPaths: JSON.parse(row.redirect_paths_json),
    accessTokenMinutes: row.access_token_minutes,
    idleDays: row.idle_days,
    absoluteDays: row.absolute_days,
    associations: JSON.parse(row.associations_json),
    enabled: row.enabled === 1,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
  };
}

/** Every native client, unresolved. */
async function clientRows() {
  const db = await getStateDb();
  return db.prepare('SELECT * FROM native_clients ORDER BY client_id').all().map(clientOf);
}

/**
 * The state files a host is resolved against, read once.
 *
 * @returns {Promise<{ tunnels: object[], sites: object[], domains: string[] }>}
 */
export async function readHostState() {
  const [tunnels, sites, domains] = await Promise.all([
    readTunnels(),
    readSites(),
    activeDomainNames(),
  ]);
  return { tunnels, sites, domains };
}

/** The entry of a client's host in `sites.json` / `tunnels.json`, or null. */
function hostEntryOf(client, state) {
  const list = client.hostKind === 'site' ? state.sites : state.tunnels;
  return (Array.isArray(list) ? list : []).find((e) => e && e.id === client.hostId) ?? null;
}

/**
 * The client with its host resolved: `fqdn` and `domain` (null when the
 * host entry is gone or lies under no active domain), the user-surface
 * host it is (`host`: core `UserSurfaceHost`, null when the entry binds no
 * route), and whether it is `served` — enabled, its host present, under an
 * active domain.
 */
export function resolveNativeClient(client, state) {
  const entry = hostEntryOf(client, state);
  const fqdn =
    entry && typeof entry.fqdn === 'string' && entry.fqdn.length > 0
      ? entry.fqdn.toLowerCase()
      : null;
  const domain = fqdn ? domainOfHost(fqdn, state.domains) : null;
  const host =
    userSurfaceHosts(state.tunnels, state.sites).find(
      (h) => h.kind === client.hostKind && h.id === client.hostId,
    ) ?? null;
  const reason = !client.enabled
    ? 'disabled'
    : !entry
      ? 'host_missing'
      : !domain || domain === fqdn
        ? 'domain_inactive'
        : null;
  return {
    ...client,
    fqdn,
    domain,
    host,
    served: reason === null,
    ...(reason === null ? {} : { reason }),
  };
}

/** The API's view of a resolved client. */
function viewOf(resolved) {
  const { host, ...rest } = resolved;
  delete rest.version;
  return {
    ...rest,
    audience: resolved.fqdn ? nativeAudience(resolved.fqdn) : null,
    redirectUris: resolved.fqdn ? nativeRedirectUris(resolved.fqdn, resolved.redirectPaths) : [],
    accessMode: host?.accessMode ?? null,
    routes: host ? [...host.routes] : [],
    servedRoutes: host ? [...host.served] : [],
  };
}

/** Every native client, resolved against the state files as they are now. */
export async function listNativeClients() {
  const state = await readHostState();
  return (await clientRows()).map((c) => viewOf(resolveNativeClient(c, state)));
}

/** One native client, resolved — or a 404. */
export async function getNativeClient(clientId) {
  const state = await readHostState();
  return viewOf(resolveNativeClient(await clientRowOr404(clientId), state));
}

/**
 * One native client resolved, for the broker and the grants: the record
 * with its host, or null when there is none.
 *
 * @param {string} clientId
 * @param {{ tunnels: object[], sites: object[], domains: string[] }} [state]
 */
export async function findResolvedNativeClient(clientId, state) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM native_clients WHERE client_id = ?').get(clientId);
  if (!row) return null;
  return resolveNativeClient(clientOf(row), state ?? (await readHostState()));
}

async function clientRowOr404(clientId) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM native_clients WHERE client_id = ?').get(clientId);
  if (!row) throw httpError('No native client with this id', 404, { code: 'not_found' });
  return clientOf(row);
}

/**
 * What Authelia is told of the served native clients of `domains` (the
 * active domains a rendering read): core `AutheliaNativeClient`s. Call it
 * under the domain rendering lock (`lib/plugin-oidc.js`).
 *
 * @param {ReadonlyArray<{ name: string }>} domains
 * @returns {Promise<import('@lamalibre/lamaste/server').AutheliaNativeClient[]>}
 */
export async function planNativeClients(domains) {
  const names = domains.map((d) => d.name);
  const [tunnels, sites] = await Promise.all([readTunnels(), readSites()]);
  const state = { tunnels, sites, domains: names };
  return (await clientRows())
    .map((c) => resolveNativeClient(c, state))
    .filter((c) => c.served)
    .map((c) => ({
      clientId: c.clientId,
      name: c.name,
      fqdn: c.fqdn,
      domain: c.domain,
      redirectPaths: c.redirectPaths,
      accessTokenMinutes: c.accessTokenMinutes,
      idleDays: c.idleDays,
    }));
}

/**
 * Write Gatekeeper's projection of the native clients (`native-apps.json`,
 * v1, 0600; only when it changed): which client belongs to which host —
 * what its bearer check admits a token of. Only served clients are listed;
 * one that is not refuses every bearer. Call it under the domain rendering
 * lock with the clients {@link planNativeClients} returned.
 *
 * @param {ReadonlyArray<{ clientId: string, fqdn: string, domain: string }>} served
 */
export async function writeNativeAppsProjection(served) {
  await atomicWriteJSONIfChanged(
    path.join(STATE_DIR, NATIVE_APPS_PROJECTION_FILE),
    {
      v: 1,
      clients: served.map(({ clientId, fqdn, domain }) => ({
        clientId,
        fqdn,
        domain,
        enabled: true,
      })),
    },
    { mode: 0o600 },
  );
}

/** Render Authelia and Gatekeeper's projection again (best effort; warnings). */
async function syncProviders(logger) {
  try {
    const { syncOidcClients } = await import('./plugin-oidc.js');
    await syncOidcClients(logger);
    return [];
  } catch (err) {
    logger?.warn({ err: err.message }, 'Native clients were not rendered into Authelia');
    return [
      {
        step: 'authelia',
        message: `Authelia's OIDC clients were not rendered (${err.message}); the panel renders them again within a minute`,
      },
    ];
  }
}

const withWarnings = (warnings) => (warnings.length > 0 ? { warnings } : {});

/**
 * Register a native client (admin). Refused: 400 `invalid_request` (the
 * schema), 400 `not_an_application_host` (the host is no user-surface host
 * under an active domain), 409 `client_exists`, 409 `host_has_client`.
 *
 * @param {unknown} input
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function createNativeClient(input, { actor, logger }) {
  const parsed = NativeClientCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw httpError(parsed.error.issues[0]?.message ?? 'Invalid native client', 400, {
      code: 'invalid_request',
    });
  }
  const spec = parsed.data;
  const clientId = nativeClientId(spec.slug);
  const state = await readHostState();
  const candidate = resolveNativeClient(
    {
      clientId,
      hostKind: spec.hostKind,
      hostId: spec.hostId,
      enabled: true,
      redirectPaths: spec.redirectPaths,
    },
    state,
  );
  if (!candidate.served || !candidate.host) {
    throw httpError(
      'The host is not an application host under an active domain: a plugin-owned site, or a tunnel bound to plugin routes',
      400,
      { code: 'not_an_application_host' },
    );
  }
  const db = await getStateDb();
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO native_clients (client_id, host_kind, host_id, name, redirect_paths_json,
         access_token_minutes, idle_days, absolute_days, associations_json, enabled,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      clientId,
      spec.hostKind,
      spec.hostId,
      spec.name,
      JSON.stringify(spec.redirectPaths),
      spec.accessTokenMinutes,
      spec.idleDays,
      spec.absoluteDays,
      JSON.stringify(spec.associations),
      spec.enabled ? 1 : 0,
      now,
      now,
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const taken = db.prepare('SELECT 1 FROM native_clients WHERE client_id = ?').get(clientId);
    throw taken
      ? httpError('A native client with this id exists', 409, { code: 'client_exists' })
      : httpError('This host has a native client already', 409, { code: 'host_has_client' });
  }
  await recordAuditBestEffort(
    {
      actor,
      action: 'native-app.created',
      details: { clientId, hostKind: spec.hostKind, hostId: spec.hostId },
    },
    logger,
  );
  const warnings = await syncProviders(logger);
  return { client: await getNativeClient(clientId), ...withWarnings(warnings) };
}

/**
 * Change a native client (admin): any setting but its id and host. 400
 * `invalid_request`, 404, 409 `conflict` when it changed meanwhile.
 * Disabling it revokes every grant (`client_disabled`).
 *
 * @param {string} clientId
 * @param {unknown} input
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function updateNativeClient(clientId, input, { actor, logger }) {
  const parsed = NativeClientUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw httpError(parsed.error.issues[0]?.message ?? 'Invalid change', 400, {
      code: 'invalid_request',
    });
  }
  const change = parsed.data;
  const current = await clientRowOr404(clientId);
  const next = { ...current, ...change };
  if (!nativeClientLifetimesValid(next)) {
    throw httpError('idleDays must not exceed absoluteDays', 400, { code: 'invalid_request' });
  }
  const db = await getStateDb();
  const result = db
    .prepare(
      `UPDATE native_clients SET name = ?, redirect_paths_json = ?, access_token_minutes = ?,
         idle_days = ?, absolute_days = ?, associations_json = ?, enabled = ?,
         updated_at = ?, version = version + 1
       WHERE client_id = ? AND version = ?`,
    )
    .run(
      next.name,
      JSON.stringify(next.redirectPaths),
      next.accessTokenMinutes,
      next.idleDays,
      next.absoluteDays,
      JSON.stringify(next.associations),
      next.enabled ? 1 : 0,
      Date.now(),
      clientId,
      current.version,
    );
  if (result.changes === 0) {
    throw httpError('The native client changed meanwhile; read it again', 409, {
      code: 'conflict',
    });
  }
  let revoked = 0;
  if (current.enabled && !next.enabled) {
    revoked = (await revokeNativeGrants({ clientId }, 'client_disabled', { actor, logger })).length;
  }
  const action =
    current.enabled === next.enabled
      ? 'native-app.updated'
      : next.enabled
        ? 'native-app.enabled'
        : 'native-app.disabled';
  await recordAuditBestEffort(
    {
      actor,
      action,
      details: { clientId, fields: Object.keys(change), ...(revoked > 0 ? { revoked } : {}) },
    },
    logger,
  );
  const warnings = await syncProviders(logger);
  return { client: await getNativeClient(clientId), ...withWarnings(warnings) };
}

/**
 * Delete a native client (admin): its grants revoked (`client_deleted`) and
 * dropped, the client removed from Authelia and Gatekeeper's projection.
 *
 * @param {string} clientId
 * @param {{ actor: string, logger?: import('pino').Logger, reason?: 'client_deleted' | 'host_deleted' }} opts
 */
export async function deleteNativeClient(clientId, { actor, logger, reason = 'client_deleted' }) {
  await clientRowOr404(clientId);
  const revoked = await revokeNativeGrants({ clientId }, reason, { actor, logger });
  const db = await getStateDb();
  db.prepare('DELETE FROM native_clients WHERE client_id = ?').run(clientId);
  await deleteNativeGrantsOfClient(clientId);
  await recordAuditBestEffort(
    {
      actor,
      action: 'native-app.deleted',
      details: { clientId, reason, ...(revoked.length > 0 ? { revoked: revoked.length } : {}) },
    },
    logger,
  );
  const warnings = await syncProviders(logger);
  return { ok: true, ...withWarnings(warnings) };
}

/**
 * Delete every native client whose host entry is gone — its tunnel or site
 * deleted (`host_deleted`). Called after the panel deletes a host and from
 * the native tick, which catches any other path.
 *
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<string[]>} the deleted clients' ids
 */
export async function reconcileNativeClientHosts(logger) {
  const rows = await clientRows();
  if (rows.length === 0) return [];
  const state = await readHostState();
  const gone = rows.filter((c) => hostEntryOf(c, state) === null).map((c) => c.clientId);
  for (const clientId of gone) {
    try {
      await deleteNativeClient(clientId, { actor: 'lamaste', logger, reason: 'host_deleted' });
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
  }
  if (gone.length > 0) logger?.info({ clients: gone }, 'Native clients of deleted hosts removed');
  return gone;
}

/**
 * Move the native client of one host to another (a plugin's web surface
 * moved from its tunnel to its own site, same hostname): its grants stay,
 * its audience is the same. Nothing when the old host had none.
 *
 * @param {{ kind: 'site' | 'tunnel', id: string }} from
 * @param {{ kind: 'site' | 'tunnel', id: string }} to
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function moveNativeClientHost(from, to, { actor, logger }) {
  const db = await getStateDb();
  const row = db
    .prepare('SELECT client_id FROM native_clients WHERE host_kind = ? AND host_id = ?')
    .get(from.kind, from.id);
  if (!row) return { moved: false };
  db.prepare(
    `UPDATE native_clients SET host_kind = ?, host_id = ?, updated_at = ?, version = version + 1
     WHERE client_id = ?`,
  ).run(to.kind, to.id, Date.now(), row.client_id);
  await recordAuditBestEffort(
    {
      actor,
      action: 'native-app.host.moved',
      details: { clientId: row.client_id, from, to },
    },
    logger,
  );
  await syncProviders(logger);
  return { moved: true, clientId: row.client_id };
}
