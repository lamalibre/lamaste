/**
 * The relay's base domains and who is a member of each — the multi-domain
 * relay (packages/core/docs/multi-domain-relay-design.md).
 *
 * One domain is the primary: the panel's (`panel.json` `domain`, `panel.`,
 * `tunnel.`, agent panels). Others are added (`pending`), then activated —
 * `auth.<domain>` issued and its vhost written, its session cookie rendered
 * into Authelia — and serve tunnels, sites and plugins of their own. Domains
 * never overlap (core `assertDomainAddable`).
 *
 * **Membership** (`domain_members`, state.db 0016) is explicit, by user id:
 * a person reaches a domain only as its member. It is rendered — active
 * users of active domains only — into Authelia's session cookies,
 * `access_control` and OIDC authorization policies (core
 * `updateDomainAccess`) and into Gatekeeper's projection
 * (`domains.json`), both by {@link syncDomainAccess}: after every
 * membership, user, domain and site change, and every minute (the identity
 * tick). A disabled user keeps their memberships and is rendered nowhere;
 * a deleted user loses them (lib/directory.js). While the relay has one
 * domain every new user becomes its member (decision 1); with two or more,
 * a new user is given the domains they are created with.
 *
 * Audit entries name domains and user ids, never a username.
 */

import dns from 'node:dns/promises';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  DOMAINS_PROJECTION_FILE,
  PromiseChainMutex,
  assertDomainAddable,
  atomicWriteJSON,
  domainOfHost,
  isLamasteUsername,
} from '@lamalibre/lamaste';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { updateDomainAccess } from './authelia.js';
import { getConfig } from './config.js';
import { getStateDb } from './state-db.js';
import { readSites, readTunnels } from './state.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** One change of the domains or their members at a time. */
const domainsMutex = new PromiseChainMutex();
/** One rendering at a time: two would race on Authelia's file and the projection. */
const renderMutex = new PromiseChainMutex();

/**
 * @typedef {object} Domain
 * @property {string} name
 * @property {boolean} primary
 * @property {'pending' | 'active'} status
 * @property {string} createdAt
 * @property {string | null} activatedAt
 */

/** @returns {Domain} */
function rowToDomain(row) {
  return {
    name: row.name,
    primary: row.is_primary === 1,
    status: row.status,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Every domain: the primary first, then by name.
 *
 * @returns {Promise<Domain[]>}
 */
export async function listDomains() {
  const db = await getStateDb();
  return db.prepare('SELECT * FROM domains ORDER BY is_primary DESC, name').all().map(rowToDomain);
}

/** One domain by name, or null. */
export async function getDomain(name) {
  const db = await getStateDb();
  const row = db.prepare('SELECT * FROM domains WHERE name = ?').get(name);
  return row ? rowToDomain(row) : null;
}

/** The active domains (the primary first). */
export async function activeDomains() {
  return (await listDomains()).filter((d) => d.status === 'active');
}

/** The names of the active domains — what hostnames are checked against. */
export async function activeDomainNames() {
  return (await activeDomains()).map((d) => d.name);
}

/**
 * The primary domain's name: its record, or — before the first start that
 * made it ({@link ensurePrimaryDomain}) — `panel.json`'s `domain`. Null
 * before onboarding set one.
 */
export async function primaryDomainName() {
  const db = await getStateDb();
  const row = db.prepare('SELECT name FROM domains WHERE is_primary = 1').get();
  if (row) return row.name;
  try {
    return getConfig().domain ?? null;
  } catch {
    return null;
  }
}

/**
 * The domain a plugin belongs to: its own (`plugins.domain`), else the
 * primary.
 *
 * @param {{ domain?: string | null } | null | undefined} plugin
 */
export async function pluginDomainName(plugin) {
  return plugin?.domain ?? (await primaryDomainName());
}

/** The domains `userId` is a member of, by name. */
export async function domainsOfUser(userId) {
  const db = await getStateDb();
  return db
    .prepare('SELECT domain FROM domain_members WHERE user_id = ? ORDER BY domain')
    .all(userId)
    .map((row) => row.domain);
}

/**
 * The active domain `requested` names — the primary when it names none — or
 * a 400 the route answers with: a tunnel, a site, a web surface or a plugin
 * is put only on a domain that serves.
 *
 * @param {string | undefined | null} requested
 * @returns {Promise<string>}
 */
export async function resolveActiveDomain(requested) {
  const domains = await activeDomains();
  if (requested === undefined || requested === null) {
    const primary = domains.find((d) => d.primary)?.name ?? (await primaryDomainName());
    if (!primary) throw httpError('The panel has no domain yet', 400, { code: 'no_domain' });
    return primary;
  }
  const wanted = String(requested).toLowerCase();
  if (!domains.some((d) => d.name === wanted)) {
    throw httpError(`'${wanted}' is not an active domain of this relay`, 400, {
      code: 'unknown_domain',
    });
  }
  return wanted;
}

/**
 * Every member of `name` the directory still holds (removed users have no
 * membership): id, username, status and when they were added.
 *
 * @param {string} name
 */
export async function listDomainMembers(name) {
  const db = await getStateDb();
  return db
    .prepare(
      `SELECT dm.user_id, u.username, u.status, dm.added_at, dm.added_by
       FROM domain_members dm JOIN directory_users u ON u.user_id = dm.user_id
       WHERE dm.domain = ? ORDER BY u.username`,
    )
    .all(name)
    .map((row) => ({
      userId: row.user_id,
      username: row.username,
      status: row.status,
      addedAt: row.added_at,
      addedBy: row.added_by,
    }));
}

/**
 * Each user's domains, by user id.
 *
 * @returns {Promise<Map<string, string[]>>}
 */
export async function domainsByUser() {
  const db = await getStateDb();
  const map = new Map();
  for (const row of db
    .prepare('SELECT user_id, domain FROM domain_members ORDER BY domain')
    .all()) {
    const list = map.get(row.user_id) ?? [];
    list.push(row.domain);
    map.set(row.user_id, list);
  }
  return map;
}

/**
 * The usernames of the active members of `name` — active users only, as
 * every rendering names them.
 *
 * @param {string} name
 * @returns {Promise<Set<string>>}
 */
export async function activeMemberUsernames(name) {
  const db = await getStateDb();
  return new Set(
    db
      .prepare(
        `SELECT u.username FROM domain_members dm JOIN directory_users u ON u.user_id = dm.user_id
         WHERE dm.domain = ? AND u.status = 'active' AND u.username IS NOT NULL`,
      )
      .all(name)
      .map((row) => row.username),
  );
}

// ---------------------------------------------------------------------------
// Memberships inside the directory's transactions
// ---------------------------------------------------------------------------

/**
 * The domains a user created now is given: `requested` (each an existing
 * domain; pending ones too, so an activation goes live with its members),
 * or — when none are requested and the relay has exactly one domain — that
 * one. With two or more domains and none requested: none (a user adopted
 * from users.yml waits for an administrator). Throws a 400 on an unknown
 * domain.
 *
 * @param {readonly string[] | undefined} requested
 * @returns {Promise<string[]>}
 */
export async function domainsForNewUser(requested) {
  const domains = await listDomains();
  if (requested === undefined) {
    return domains.length === 1 ? [domains[0].name] : [];
  }
  const names = new Set(domains.map((d) => d.name));
  const wanted = [...new Set(requested.map((d) => String(d).toLowerCase()))];
  const unknown = wanted.find((d) => !names.has(d));
  if (unknown !== undefined) {
    throw httpError(`'${unknown}' is not a domain of this relay`, 400, {
      code: 'unknown_domain',
    });
  }
  return wanted;
}

/**
 * Whether a user created now needs domains named: the relay has more than
 * one domain (with one, they become its member).
 */
export async function newUsersNeedDomains() {
  return (await listDomains()).length > 1;
}

/**
 * Make `userId` a member of `domains`, inside the caller's transaction:
 * the rows that are new, and the audit entries for them (to record once the
 * transaction committed).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} userId
 * @param {readonly string[]} domains
 * @param {{ actor: string, now: string }} opts
 * @returns {Array<{ action: string, details: object }>}
 */
export function insertMembershipsSync(db, userId, domains, { actor, now }) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO domain_members (domain, user_id, added_at, added_by)
     SELECT name, ?, ?, ? FROM domains WHERE name = ?`,
  );
  const events = [];
  for (const domain of domains) {
    if (insert.run(userId, now, actor, domain).changes > 0) {
      events.push({ action: 'directory.membership.added', details: { domain, userId } });
    }
  }
  return events;
}

/**
 * End every membership of `userId`, inside the caller's transaction; returns
 * the audit entries (`reason`, e.g. `deleted`).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} userId
 * @param {string} reason
 * @returns {Array<{ action: string, details: object }>}
 */
export function deleteMembershipsSync(db, userId, reason) {
  const domains = db
    .prepare('SELECT domain FROM domain_members WHERE user_id = ?')
    .all(userId)
    .map((row) => row.domain);
  db.prepare('DELETE FROM domain_members WHERE user_id = ?').run(userId);
  return domains.map((domain) => ({
    action: 'directory.membership.removed',
    details: { domain, userId, reason },
  }));
}

// ---------------------------------------------------------------------------
// The primary domain
// ---------------------------------------------------------------------------

/**
 * Make the primary domain's record from `panel.json`'s `domain` when there
 * is none yet — at the first start after onboarding, or of a version from
 * before the multi-domain relay — with every user the directory holds as its
 * member (`added_by: 'migration'`): a relay with one domain lets in whom it
 * let in before. Idempotent. Returns the primary's name, or null without a
 * domain.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function ensurePrimaryDomain({ logger } = {}) {
  return domainsMutex.run(async () => {
    const db = await getStateDb();
    const existing = db.prepare('SELECT name FROM domains WHERE is_primary = 1').get();
    if (existing) return existing.name;
    let domain;
    try {
      domain = getConfig().domain;
    } catch {
      domain = null;
    }
    if (!domain) return null;
    const now = new Date().toISOString();
    let members = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO domains (name, is_primary, status, created_at, activated_at)
         VALUES (?, 1, 'active', ?, ?)`,
      ).run(domain, now, now);
      members = db
        .prepare(
          `INSERT INTO domain_members (domain, user_id, added_at, added_by)
           SELECT ?, user_id, ?, 'migration' FROM directory_users WHERE status <> 'removed'`,
        )
        .run(domain, now).changes;
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    await recordAuditBestEffort(
      { actor: 'lamaste', action: 'domain.added', details: { domain, primary: true, members } },
      logger,
    );
    logger?.info({ domain, members }, 'Primary domain recorded');
    return domain;
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function projectionPath() {
  return path.join(STATE_DIR, DOMAINS_PROJECTION_FILE);
}

/** The protected-site rules Authelia renders, from `sites.json`. */
function protectedSiteRules(sites) {
  return sites
    .filter((s) => s && typeof s.fqdn === 'string')
    .map((s) => ({
      fqdn: s.fqdn,
      autheliaProtected: s.autheliaProtected === true,
      allowedUsers: Array.isArray(s.allowedUsers) ? s.allowedUsers : [],
      ...(s.restrictAccess === true ? { restrictAccess: true } : {}),
    }));
}

/** Logged once per count, so a steady number of unrenderable members is not repeated every minute. */
let loggedIneligible = 0;

/**
 * The active domains with the usernames of their active members — what
 * Authelia and Gatekeeper are told (lib/plugin-oidc.js renders the OIDC
 * provider's policies from it too). A username users.yml holds that is not
 * a Lamaste username is never rendered (counted, never named).
 *
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<Array<{ name: string, members: string[] }>>}
 */
export async function domainsWithMembers(logger) {
  const db = await getStateDb();
  const domains = await activeDomains();
  const rows = db
    .prepare(
      `SELECT dm.domain, u.username FROM domain_members dm
       JOIN directory_users u ON u.user_id = dm.user_id
       JOIN domains d ON d.name = dm.domain
       WHERE d.status = 'active' AND u.status = 'active' AND u.username IS NOT NULL
       ORDER BY u.username`,
    )
    .all();
  let ineligible = 0;
  const byDomain = new Map(domains.map((d) => [d.name, []]));
  for (const row of rows) {
    if (!isLamasteUsername(row.username)) {
      ineligible += 1;
      continue;
    }
    byDomain.get(row.domain)?.push(row.username);
  }
  if (ineligible !== loggedIneligible) {
    loggedIneligible = ineligible;
    if (ineligible > 0) {
      logger?.warn({ ineligible }, 'Members whose username Authelia cannot be told are left out');
    }
  }
  return domains.map((d) => ({ name: d.name, members: byDomain.get(d.name) ?? [] }));
}

/** Write Gatekeeper's projection when it differs from the file. */
async function writeProjection(projection) {
  const text = JSON.stringify(projection);
  try {
    if (JSON.stringify(JSON.parse(await readFile(projectionPath(), 'utf-8'))) === text) return;
  } catch {
    // Missing or unreadable: written below.
  }
  await atomicWriteJSON(projectionPath(), projection, { mode: 0o600 });
}

/**
 * Render the domains and their members: Gatekeeper's projection first, then
 * Authelia's session cookies, `access_control` and OIDC authorization
 * policies (`sites`: the protected sites, `sites.json` unless given — a
 * site change passes the sites it is saving). Authelia restarts only when
 * its configuration changed. Nothing before onboarding made a domain.
 * Throws when Authelia's configuration cannot be written (the projection
 * is written already, so Gatekeeper refuses what Authelia may still let in).
 *
 * @param {{ logger?: import('pino').Logger, sites?: readonly object[] }} [opts]
 * @returns {Promise<{ changed: boolean, domains: number }>}
 */
export function syncDomainAccess({ logger, sites } = {}) {
  return renderMutex.run(async () => {
    const domains = await domainsWithMembers(logger);
    if (domains.length === 0) return { changed: false, domains: 0 };
    await writeProjection({ v: 1, domains });
    const { changed } = await updateDomainAccess({
      domains,
      sites: protectedSiteRules(sites ?? (await readSites())),
    });
    if (changed) logger?.info({ domains: domains.length }, 'Authelia domain access updated');
    return { changed, domains: domains.length };
  });
}

/**
 * After a change of who may reach a domain: render it, drop Gatekeeper's
 * cached session verdicts and recompute the plugins' audiences (a plugin's
 * audience is its domain's members). Returns the warnings.
 */
async function settleMembership(logger) {
  const warnings = [];
  try {
    await syncDomainAccess({ logger });
  } catch (err) {
    logger?.error({ err: err.message }, 'Rendering domain access failed');
    warnings.push({
      step: 'authelia',
      message: `Authelia was not updated (${err.message}); the panel renders it again within a minute`,
    });
  }
  const { bustGatekeeperSessions } = await import('./gatekeeper-client.js');
  const busted = await bustGatekeeperSessions();
  if (!busted.ok) {
    warnings.push({
      step: 'gatekeeper',
      message: `Gatekeeper did not drop its cached sessions (${busted.error}); they expire within 30 seconds`,
    });
  }
  const { recomputeAudiences } = await import('./audience.js');
  await recomputeAudiences({ logger });
  return warnings;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** The directory row of `userId`, or a 404 / 409 the route answers with. */
function memberCandidate(db, userId) {
  const row = db
    .prepare('SELECT user_id, status FROM directory_users WHERE user_id = ?')
    .get(userId);
  if (!row) throw httpError('User not found', 404, { code: 'user_not_found' });
  if (row.status === 'removed') {
    throw httpError('The user is deleted', 409, { code: 'user_removed' });
  }
  return row;
}

function domainOr404(db, name) {
  const row = db.prepare('SELECT * FROM domains WHERE name = ?').get(name);
  if (!row) throw httpError('Domain not found', 404, { code: 'domain_not_found' });
  return rowToDomain(row);
}

/**
 * Make user `userId` a member of domain `name`. Idempotent (`added: false`
 * when they were one). Then renders, busts Gatekeeper's sessions and
 * recomputes the audiences.
 *
 * @param {string} name
 * @param {string} userId
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function addDomainMember(name, userId, { actor, logger }) {
  const added = await domainsMutex.run(async () => {
    const db = await getStateDb();
    domainOr404(db, name);
    memberCandidate(db, userId);
    const events = insertMembershipsSync(db, userId, [name], {
      actor,
      now: new Date().toISOString(),
    });
    for (const event of events) await recordAuditBestEffort({ actor, ...event }, logger);
    return events.length > 0;
  });
  const warnings = added ? await settleMembership(logger) : [];
  return { added, ...(warnings.length > 0 ? { warnings } : {}) };
}

/**
 * End user `userId`'s membership of domain `name` (`removed: false` when
 * there was none). Then renders, busts Gatekeeper's sessions, recomputes the
 * audiences, and — when `name` is the registry's domain — revokes the
 * user's registry tokens.
 *
 * @param {string} name
 * @param {string} userId
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeDomainMember(name, userId, { actor, logger }) {
  const removed = await domainsMutex.run(async () => {
    const db = await getStateDb();
    domainOr404(db, name);
    const row = db
      .prepare(
        'SELECT u.username FROM domain_members dm JOIN directory_users u USING (user_id) WHERE dm.domain = ? AND dm.user_id = ?',
      )
      .get(name, userId);
    if (!row) return null;
    db.prepare('DELETE FROM domain_members WHERE domain = ? AND user_id = ?').run(name, userId);
    await recordAuditBestEffort(
      {
        actor,
        action: 'directory.membership.removed',
        details: { domain: name, userId, reason: 'removed' },
      },
      logger,
    );
    return { username: row.username };
  });
  if (!removed) return { removed: false };
  const warnings = await settleMembership(logger);
  if (removed.username) {
    warnings.push(...(await revokeRegistryTokensFor(name, removed.username, userId, logger)));
  }
  return { removed: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

/**
 * Revoke a user's registry tokens when `domain` is the registry's — the
 * domain its sign-in (`feria login`) admits members of. Returns warnings.
 */
async function revokeRegistryTokensFor(domain, username, userId, logger) {
  try {
    const { registryDomain, revokeUserRegistryTokens } = await import('./registry-credential.js');
    if ((await registryDomain()) !== domain) return [];
    await revokeUserRegistryTokens(username, { deleted: true }, logger, { userId });
    return [];
  } catch (err) {
    logger?.warn({ userId, err: err.message }, 'Registry tokens were not revoked');
    return [{ step: 'registry', message: `Registry tokens were not revoked: ${err.message}` }];
  }
}

// ---------------------------------------------------------------------------
// Domain lifecycle
// ---------------------------------------------------------------------------

/**
 * Add domain `name` (`pending`): validated, refused when it overlaps
 * another (400 `invalid_domain` / 409 `domain_overlap`).
 *
 * @param {string} name
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<Domain>}
 */
export async function addDomain(name, { actor, logger }) {
  return domainsMutex.run(async () => {
    const db = await getStateDb();
    const existing = db
      .prepare('SELECT name FROM domains')
      .all()
      .map((r) => r.name);
    try {
      assertDomainAddable(name, existing);
    } catch (err) {
      throw err.code === 'DOMAIN_OVERLAP'
        ? httpError(err.message, 409, { code: 'domain_overlap' })
        : httpError(err.message, 400, { code: 'invalid_domain' });
    }
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO domains (name, is_primary, status, created_at) VALUES (?, 0, 'pending', ?)",
    ).run(name, now);
    await recordAuditBestEffort(
      { actor, action: 'domain.added', details: { domain: name, primary: false } },
      logger,
    );
    return rowToDomain(db.prepare('SELECT * FROM domains WHERE name = ?').get(name));
  });
}

async function resolveA(hostname) {
  try {
    return await dns.resolve4(hostname);
  } catch {
    return [];
  }
}

/**
 * Check the DNS a domain needs: `auth.<domain>` must resolve to the relay.
 * Reports whether a wildcard record is in place too (a probe name), which
 * every tunnel and site hostname then resolves through.
 *
 * @param {string} name
 */
export async function verifyDomainDns(name) {
  const db = await getStateDb();
  domainOr404(db, name);
  const expectedIp = getConfig().ip;
  const authName = `auth.${name}`;
  const [auth, wildcard] = await Promise.all([
    resolveA(authName),
    resolveA(`test-lamaste-check.${name}`),
  ]);
  return {
    ok: auth.includes(expectedIp),
    expectedIp,
    records: [{ name: authName, resolvedIps: auth, ok: auth.includes(expectedIp) }],
    wildcard: wildcard.includes(expectedIp),
  };
}

/** What activation needs from nginx and certbot (the real ones unless a test gives others). */
async function activationDeps() {
  const nginx = await import('./nginx.js');
  const certbot = await import('./certbot.js');
  return {
    issueCert: certbot.issueCert,
    writeAuthVhost: nginx.writeAuthVhost,
    removeAuthVhost: nginx.removeAuthVhost,
  };
}

let activationOverride = null;

/** Replace nginx and certbot for activation and removal (tests). */
export function setDomainActivationForTests(deps) {
  activationOverride = deps;
}

/**
 * Activate domain `name`: issue `auth.<domain>`'s certificate, write and
 * link its auth vhost, mark it active and render — its session cookie, its
 * members' rules and Gatekeeper's projection. One operation: when a step
 * fails the vhost goes and the domain stays pending. Idempotent on an
 * active domain.
 *
 * @param {string} name
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<Domain>}
 */
export async function activateDomain(name, { actor, logger }) {
  const activated = await domainsMutex.run(async () => {
    const db = await getStateDb();
    const domain = domainOr404(db, name);
    if (domain.status === 'active') return null;
    const { email } = getConfig();
    if (!email) throw httpError('The panel has no email for certificates', 400);
    const deps = activationOverride ?? (await activationDeps());
    const fqdn = `auth.${name}`;
    try {
      await deps.issueCert(fqdn, email);
    } catch (err) {
      throw httpError(`The certificate of ${fqdn} could not be issued: ${err.message}`, 502, {
        code: 'cert_failed',
      });
    }
    try {
      await deps.writeAuthVhost(name, { primary: false });
    } catch (err) {
      throw httpError(`nginx refused the vhost of ${fqdn}: ${err.message}`, 502, {
        code: 'nginx_failed',
      });
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE domains SET status = 'active', activated_at = ? WHERE name = ?").run(
      now,
      name,
    );
    try {
      await syncDomainAccess({ logger });
    } catch (err) {
      db.prepare("UPDATE domains SET status = 'pending', activated_at = NULL WHERE name = ?").run(
        name,
      );
      await deps.removeAuthVhost(name).catch(() => {});
      // Back to what it was before: the other domains as they were.
      await syncDomainAccess({ logger }).catch(() => {});
      throw httpError(`Authelia was not updated: ${err.message}`, 502, { code: 'authelia_failed' });
    }
    await recordAuditBestEffort(
      { actor, action: 'domain.activated', details: { domain: name } },
      logger,
    );
    return rowToDomain(db.prepare('SELECT * FROM domains WHERE name = ?').get(name));
  });
  if (activated === null) return getDomain(name);
  const { bustGatekeeperSessions } = await import('./gatekeeper-client.js');
  await bustGatekeeperSessions();
  return activated;
}

/**
 * What uses domain `name`: tunnels and sites (a hostname or an alias under
 * it), plugins that belong to it, the registry credential's issuer.
 *
 * @param {string} name
 */
export async function domainUsage(name) {
  const under = (host) => typeof host === 'string' && domainOfHost(host, [name]) !== null;
  const tunnels = (await readTunnels()).filter((t) => under(t.fqdn)).map((t) => t.fqdn);
  const sites = (await readSites())
    .filter((s) => under(s.fqdn) || (s.aliases ?? []).some(under))
    .map((s) => s.fqdn);
  const db = await getStateDb();
  const plugins = db
    .prepare('SELECT name FROM plugins WHERE domain = ? ORDER BY name')
    .all(name)
    .map((r) => r.name);
  const { registryDomain } = await import('./registry-credential.js');
  const registry = (await registryDomain().catch(() => null)) === name;
  return { tunnels, sites, plugins, registry };
}

/**
 * Remove domain `name`: refused for the primary (400 `primary_domain`) and
 * while anything uses it (409 `domain_in_use` with `usedBy`). Its
 * memberships end (audited, reason `domain-removed`), its auth vhost goes,
 * and the rest is rendered without it.
 *
 * @param {string} name
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeDomain(name, { actor, logger }) {
  const removed = await domainsMutex.run(async () => {
    const db = await getStateDb();
    const domain = domainOr404(db, name);
    if (domain.primary) {
      throw httpError('The primary domain cannot be removed', 400, { code: 'primary_domain' });
    }
    const usedBy = await domainUsage(name);
    if (
      usedBy.tunnels.length + usedBy.sites.length + usedBy.plugins.length > 0 ||
      usedBy.registry
    ) {
      throw httpError(`Domain '${name}' is in use`, 409, { code: 'domain_in_use', usedBy });
    }
    const members = db
      .prepare('SELECT user_id FROM domain_members WHERE domain = ?')
      .all(name)
      .map((r) => r.user_id);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM domain_members WHERE domain = ?').run(name);
      db.prepare('DELETE FROM domains WHERE name = ?').run(name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    for (const userId of members) {
      await recordAuditBestEffort(
        {
          actor,
          action: 'directory.membership.removed',
          details: { domain: name, userId, reason: 'domain-removed' },
        },
        logger,
      );
    }
    if (domain.status === 'active') {
      const deps = activationOverride ?? (await activationDeps());
      await deps.removeAuthVhost(name).catch((err) => {
        logger?.warn(
          { domain: name, err: err.message },
          'The auth vhost of a removed domain stayed',
        );
      });
    }
    await recordAuditBestEffort(
      { actor, action: 'domain.removed', details: { domain: name, members: members.length } },
      logger,
    );
    return true;
  });
  const warnings = removed ? await settleMembership(logger) : [];
  return { removed: true, ...(warnings.length > 0 ? { warnings } : {}) };
}
