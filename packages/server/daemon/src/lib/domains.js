/**
 * The relay's base domains and who is a member of each — the multi-domain
 * relay (packages/core/docs/multi-domain-relay-design.md).
 *
 * One domain is the primary: the panel's (`panel.json` `domain`, `panel.`,
 * `tunnel.`, agent panels). Others are added (`pending`), then activated —
 * `auth.<domain>` issued and its vhost written, its session cookie rendered
 * into Authelia — and serve tunnels, sites and plugins of their own. Domains
 * never overlap and never share a registrable domain (core
 * `assertDomainRegistrable`).
 *
 * **Membership** (`domain_members`, state.db 0016) is explicit, by user id:
 * a person reaches a domain only as its member. A membership has a kind
 * (state.db 0017, packages/core/docs/external-members-design.md): a
 * `member` reaches what the domain gives its members, an `external` member
 * only what names them — a grant on a restricted host or an OIDC client, a
 * static site's listed users — and holds no Authelia group
 * ({@link assertNoGroupsForExternal}).
 *
 * Who is a member of what is rendered — active users of active domains
 * only — by {@link syncDomainAccess}: as groups Lamaste owns into
 * users.yml (lib/owned-groups.js; Authelia watches the file and applies
 * them at each user's next request, without a restart), into Gatekeeper's
 * projection (`domains.json`, with the kinds), and as the rules naming
 * those groups into Authelia's configuration (session cookies,
 * `access_control` — core `updateDomainAccess`), which change, and restart
 * Authelia, only with the set of domains and protected sites. It renders
 * after every membership, user, domain, site, tunnel and grant change, and
 * every minute (the identity tick). Everything that writes what members may
 * do — that rendering and the OIDC provider (lib/plugin-oidc.js) — runs
 * inside one lock ({@link withDomainRendering}) and reads the members there,
 * so a membership that ended is never written back from an older read. A
 * disabled user keeps their memberships and is rendered nowhere; a deleted
 * user loses them (lib/directory.js). While the relay has one domain every
 * new user becomes its member (decision 1); with two or more, a new user is
 * given the domains they are created with.
 *
 * Audit entries name domains and user ids, never a username.
 */

import path from 'node:path';
import { z } from 'zod';
import {
  DNS_WILDCARD_PROBE_LABEL,
  DOMAINS_PROJECTION_FILE,
  DomainNameSchema,
  MEMBERSHIP_KINDS,
  PromiseChainMutex,
  atomicWriteJSONIfChanged,
  domainOfHost,
  isAssignableGroupName,
  isLamasteOwnedGroup,
  isRelayHost,
  isIdentityUuid,
  isLamasteUsername,
} from '@lamalibre/lamaste';
import {
  assertDomainRegistrable,
  registryIssuerDomain,
  resolveHostA,
  withTunnelLock,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { readUsersRaw, updateDomainAccess, writeOwnedGroups } from './authelia.js';
import { getConfig } from './config.js';
import { desiredOwnedGroups } from './owned-groups.js';
import { getStateDb } from './state-db.js';
import { readSites, readTunnels, withSitesLock } from './state.js';
import { withUsersLock } from './users-lock.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** One change of the domains or their members at a time. */
const domainsMutex = new PromiseChainMutex();
/**
 * One writer of what members may do at a time — Authelia's domain access,
 * the projection, the OIDC provider — each reading the members under it.
 */
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

/** `fn(db)` in one `BEGIN IMMEDIATE` transaction, rolled back when it throws. */
function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** `panel.json`'s domain — the primary's name — or null before onboarding set one (or loaded it). */
function configDomain() {
  try {
    return getConfig().domain ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One domain's row, or null. */
function domainRow(db, name) {
  const row = db.prepare('SELECT * FROM domains WHERE name = ?').get(name);
  return row ? rowToDomain(row) : null;
}

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
  return domainRow(await getStateDb(), name);
}

/** Every domain's name, pending ones too — what the relay's own hostnames are kept free on. */
export async function domainNames() {
  return (await listDomains()).map((d) => d.name);
}

/**
 * A tunnel, site or alias that holds one of the relay's own hostnames of
 * `name` (`auth.`, `panel.`, `tunnel.`, `agent-*`): what was created there
 * before the domain was added — its hostname, or null. A domain is added
 * and activated only when none does: its sign-in vhost would share a
 * `server_name` with it.
 *
 * @param {string} name
 */
async function relayHostTaken(name) {
  const [tunnels, sites] = await Promise.all([readTunnels(), readSites()]);
  const hosts = [
    ...tunnels.flatMap((t) => (t.fqdn ? [t.fqdn] : [])),
    ...sites.flatMap((s) => [s.fqdn, ...(s.aliases ?? [])]),
  ];
  return hosts.find((host) => isRelayHost(host, [name])) ?? null;
}

/** Refuse (409 `relay_host_taken`) while something holds one of `name`'s relay hostnames. */
async function assertRelayHostsFree(name) {
  const taken = await relayHostTaken(name);
  if (taken !== null) {
    throw httpError(
      `'${taken}' is served by a tunnel or a site — the relay's own name on ${name}; remove it first`,
      409,
      { code: 'relay_host_taken' },
    );
  }
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
  return db.prepare('SELECT name FROM domains WHERE is_primary = 1').get()?.name ?? configDomain();
}

/**
 * The active domain hostname `fqdn` is under, or null when it is under none
 * of them.
 *
 * @param {string} fqdn
 */
export async function domainOfHostname(fqdn) {
  return domainOfHost(fqdn, await activeDomainNames());
}

/** The domain a plugin belongs to: its own (`plugins.domain`), else `primary`. Pure. */
export function pluginDomainOr(plugin, primary) {
  return plugin?.domain ?? primary;
}

/**
 * Plugins as the API shows them: `domain` the name of the domain each
 * belongs to (stored NULL means the primary — clients never interpret it).
 *
 * @template {{ domain?: string | null }} T
 * @param {T[]} plugins
 * @returns {Promise<T[]>}
 */
export async function withPluginDomains(plugins) {
  const primary = await primaryDomainName();
  return plugins.map((p) => ({ ...p, domain: pluginDomainOr(p, primary) }));
}

/**
 * The domain a plugin belongs to: its own, else the primary.
 *
 * @param {{ domain?: string | null } | null | undefined} plugin
 */
export async function pluginDomainName(plugin) {
  return pluginDomainOr(plugin, await primaryDomainName());
}

/**
 * The domain whose sign-in an invitation sends its user to: the first active
 * one it names, else the primary (an invitation from before the multi-domain
 * relay names none).
 */
export async function invitationSignInDomain(invitation) {
  // The first that serves: a pending domain has no sign-in page yet.
  const active = await activeDomainNames();
  return (
    invitationMemberships(invitation).find((m) => active.includes(m.name))?.name ??
    (await primaryDomainName())
  );
}

/**
 * The memberships an invitation names, `{ name, kind }` (an invitation
 * made before kinds names bare domains: members).
 *
 * @param {{ domains?: unknown } | null | undefined} invitation
 * @returns {Array<{ name: string, kind: 'member' | 'external' }>}
 */
export function invitationMemberships(invitation) {
  const named = Array.isArray(invitation?.domains) ? invitation.domains : [];
  return named.flatMap((d) => {
    if (typeof d === 'string') return [{ name: d, kind: 'member' }];
    if (d && typeof d.name === 'string' && (d.kind === 'member' || d.kind === 'external')) {
      return [{ name: d.name, kind: d.kind }];
    }
    return [];
  });
}

/**
 * The memberships an invitation still grants when it is accepted: those it
 * names on domains that exist now **and existed when it was created** — a
 * domain removed since and added again (possibly for someone else) is
 * another domain, and the invitation grants it nothing. Decided at
 * acceptance, so no removal has to chase invitations. Each keeps the kind
 * the invitation named.
 *
 * @param {{ domains?: unknown, createdAt?: string }} invitation
 * @returns {Promise<Array<{ name: string, kind: 'member' | 'external' }>>}
 */
export async function invitationDomainsNow(invitation) {
  const named = invitationMemberships(invitation);
  if (named.length === 0 || typeof invitation.createdAt !== 'string') return [];
  const db = await getStateDb();
  const stmt = db.prepare('SELECT 1 FROM domains WHERE name = ? AND created_at <= ?');
  return named.filter((m) => stmt.get(m.name, invitation.createdAt) !== undefined);
}

/**
 * The registry's domains for `config` (a stored registry credential, or
 * null): the issuer domain its tokens carry (`issuerDomain`, else the
 * primary) and the domain its own host is under — Feria's, whose members
 * `feria login` admits. Pure apart from the domain lists.
 *
 * @param {object | null} config
 * @returns {Promise<string[]>}
 */
export async function registryDomainsOf(config) {
  const primary = await primaryDomainName();
  if (!config) return primary ? [primary] : [];
  const names = await activeDomainNames();
  let host = null;
  try {
    host = domainOfHost(new URL(config.registryUrl).hostname, names);
  } catch {
    // An unparseable URL names no domain.
  }
  return [...new Set([registryIssuerDomain(config.auth, primary), host].filter(Boolean))];
}

/** The stored registry credential's domains ({@link registryDomainsOf}). */
export async function registryDomains() {
  const { readRegistryCredentialConfig } = await import('./registry-credential.js');
  return registryDomainsOf(await readRegistryCredentialConfig().catch(() => null));
}

/**
 * The active domain `requested` names — the primary when it names none — or
 * a 400 the route answers with: a tunnel, a site or a plugin is put only on
 * a domain that serves.
 *
 * @param {string | undefined | null} requested
 * @returns {Promise<string>}
 */
export async function resolveActiveDomain(requested) {
  if (requested === undefined || requested === null) {
    const primary = await primaryDomainName();
    if (!primary) throw httpError('The panel has no domain yet', 400, { code: 'no_domain' });
    return primary;
  }
  const wanted = String(requested).toLowerCase();
  if (!(await activeDomainNames()).includes(wanted)) {
    throw httpError(`'${wanted}' is not an active domain of this relay`, 400, {
      code: 'unknown_domain',
    });
  }
  return wanted;
}

/**
 * Run `fn` while `name` (when given) is an active domain and cannot be
 * removed: under the domains lock, which a domain's removal holds for its
 * usage check. The same 400 `unknown_domain` as {@link resolveActiveDomain}
 * when it is no longer active — for writes that name a domain outside the
 * tunnel and sites locks (the registry credential). Workflows under those
 * locks call {@link resolveActiveDomain} there instead.
 *
 * @template T
 * @param {string | undefined | null} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withActiveDomain(name, fn) {
  return domainsMutex.run(async () => {
    if (name) await resolveActiveDomain(name);
    return fn();
  });
}

/**
 * Every member of `name` the directory still holds (removed users have no
 * membership): id, username, status, the membership's kind and when it was
 * added.
 *
 * @param {string} name
 */
export async function listDomainMembers(name) {
  const db = await getStateDb();
  return db
    .prepare(
      `SELECT dm.user_id, u.username, u.status, dm.kind, dm.added_at, dm.added_by
       FROM domain_members dm JOIN directory_users u ON u.user_id = dm.user_id
       WHERE dm.domain = ? ORDER BY u.username`,
    )
    .all(name)
    .map((row) => ({
      userId: row.user_id,
      username: row.username,
      status: row.status,
      kind: row.kind,
      addedAt: row.added_at,
      addedBy: row.added_by,
    }));
}

/**
 * Each user's memberships, by user id: `{ name, kind }`, by domain name.
 *
 * @returns {Promise<Map<string, Array<{ name: string, kind: 'member' | 'external' }>>>}
 */
export async function domainsByUser() {
  const db = await getStateDb();
  const map = new Map();
  for (const { user_id: userId, domain, kind } of db
    .prepare('SELECT user_id, domain, kind FROM domain_members ORDER BY domain')
    .all()) {
    map.set(userId, [...(map.get(userId) ?? []), { name: domain, kind }]);
  }
  return map;
}

/**
 * Each domain's members, by domain: their user ids.
 *
 * @returns {Promise<Map<string, Set<string>>>}
 */
export async function membersByDomain() {
  const db = await getStateDb();
  const map = new Map();
  for (const { domain, user_id: userId } of db
    .prepare('SELECT domain, user_id FROM domain_members')
    .all()) {
    if (!map.has(domain)) map.set(domain, new Set());
    map.get(domain).add(userId);
  }
  return map;
}

/**
 * The memberships of `userId`: `{ name, kind }`, by domain name.
 *
 * @returns {Promise<Array<{ name: string, kind: 'member' | 'external' }>>}
 */
export async function domainsOfUser(userId) {
  const db = await getStateDb();
  return db
    .prepare('SELECT domain, kind FROM domain_members WHERE user_id = ? ORDER BY domain')
    .all(userId)
    .map((row) => ({ name: row.domain, kind: row.kind }));
}

/**
 * The domains, the primary first, with how many members and external
 * members each has and what uses it (as {@link domainUsage}) — read once
 * for all of them.
 */
export async function domainsOverview() {
  const db = await getStateDb();
  const domains = await listDomains();
  const counts = new Map(
    db
      .prepare(
        `SELECT domain, SUM(kind = 'member') AS members, SUM(kind = 'external') AS externals
         FROM domain_members GROUP BY domain`,
      )
      .all()
      .map((row) => [row.domain, row]),
  );
  const usage = await usageByDomain(domains.map((d) => d.name));
  return domains.map((d) => ({
    ...d,
    members: counts.get(d.name)?.members ?? 0,
    externalMembers: counts.get(d.name)?.externals ?? 0,
    usedBy: usage.get(d.name),
  }));
}

// ---------------------------------------------------------------------------
// Memberships inside the directory's transactions
// ---------------------------------------------------------------------------

/**
 * Whether new users must be given their domains: the relay has two or more
 * (pending ones count). With one, every new user becomes its member.
 *
 * @param {ReadonlyArray<unknown>} domains
 */
export function newUsersNeedDomains(domains) {
  return domains.length > 1;
}

/**
 * One membership as the API takes it: a domain name — a `member` — or
 * `{ name, kind }`.
 */
export const MembershipInputSchema = z.union([
  DomainNameSchema,
  z.object({ name: DomainNameSchema, kind: z.enum(MEMBERSHIP_KINDS) }).strict(),
]);

/**
 * Memberships as the API took them, each domain once, names in lower case:
 * a bare name is a `member`. Throws a 400 `conflicting_membership` when one
 * domain is named with two kinds.
 *
 * @param {ReadonlyArray<string | { name: string, kind: 'member' | 'external' }>} input
 * @returns {Array<{ name: string, kind: 'member' | 'external' }>}
 */
export function normalizeMemberships(input) {
  const byName = new Map();
  for (const entry of input) {
    const { name, kind } =
      typeof entry === 'string' ? { name: entry, kind: 'member' } : { kind: 'member', ...entry };
    const lower = String(name).toLowerCase();
    const seen = byName.get(lower);
    if (seen && seen !== kind) {
      throw httpError(`'${lower}' is named both as a member and as an external member`, 400, {
        code: 'conflicting_membership',
      });
    }
    byName.set(lower, kind);
  }
  return [...byName].map(([name, kind]) => ({ name, kind }));
}

/**
 * `groups` without the ones Lamaste owns (`domains`: every domain record) —
 * what anything outside Authelia is shown of a user's groups: the
 * rendering's are nobody's choice, and who is a member of which domain is
 * shown as memberships.
 *
 * @param {unknown} groups
 * @param {readonly string[]} domains
 * @returns {string[]}
 */
export function adminGroups(groups, domains) {
  return Array.isArray(groups)
    ? groups.filter((g) => typeof g === 'string' && !isLamasteOwnedGroup(g, domains))
    : [];
}

/**
 * The groups an administrator gave `username` in users.yml
 * ({@link adminGroups}).
 *
 * @param {string} username
 * @returns {Promise<string[]>}
 */
export async function adminGroupsOf(username) {
  const [users, names] = await Promise.all([
    readUsersRaw().then((data) => data.users ?? {}),
    domainNames(),
  ]);
  return adminGroups(users[username]?.groups, names);
}

/**
 * The refusal (`external_member_groups`) of Authelia groups for an external
 * member: groups grant by membership, relay-wide (`admins`, `feria-*`), and
 * an external member reaches only what names them. 409 when the user's
 * state is in the way, 400 when the request itself asks for both.
 *
 * @param {400 | 409} statusCode
 */
export function externalMemberGroupsError(statusCode) {
  return httpError(
    "An external member holds no Authelia group: remove the user's groups or the external memberships first",
    statusCode,
    { code: 'external_member_groups' },
  );
}

/**
 * Refuse (400 `reserved_group`) a group an administrator may not assign —
 * one that could be a hostname or one of Lamaste's own groups (core
 * `isAssignableGroupName`) — unless the user holds it already (a group from
 * before the rule).
 *
 * @param {readonly string[]} groups
 * @param {readonly string[]} [held]
 */
export function assertAssignableGroups(groups, held = []) {
  if (groups.every((g) => isAssignableGroupName(g) || held.includes(g))) return;
  throw httpError(
    'A group name is letters, digits, "-" and "_" (1–64): names with ".", ":" or "@" are reserved',
    400,
    { code: 'reserved_group' },
  );
}

/**
 * Refuse (409 `external_member_groups`) memberships that make a user who
 * holds Authelia groups an external member anywhere. Call it holding the
 * users lock (the users API changes groups under it).
 *
 * @param {string | null} username
 * @param {ReadonlyArray<{ kind: 'member' | 'external' }>} memberships
 */
export async function assertNoGroupsForExternal(username, memberships) {
  if (!username || !memberships.some((m) => m.kind === 'external')) return;
  if ((await adminGroupsOf(username)).length > 0) throw externalMemberGroupsError(409);
}

/**
 * The memberships a user created now is given: `requested` (each an
 * existing domain, pending ones too, so an activation goes live with its
 * members; a bare name is a `member`), or — when none are requested and the
 * relay has exactly one domain — a membership of that one. With two or more
 * domains and none requested: none (a user adopted from users.yml waits for
 * an administrator), or with `required` a 400 `domains_required` (the users
 * API and invitations). Throws a 400 `unknown_domain` on a domain the relay
 * does not have.
 *
 * @param {ReadonlyArray<string | { name: string, kind: 'member' | 'external' }> | undefined} requested
 * @param {{ required?: boolean }} [opts]
 * @returns {Promise<Array<{ name: string, kind: 'member' | 'external' }>>}
 */
export async function domainsForNewUser(requested, { required = false } = {}) {
  const domains = await listDomains();
  if (requested === undefined && !newUsersNeedDomains(domains)) {
    return domains.length === 1 ? [{ name: domains[0].name, kind: 'member' }] : [];
  }
  // A user who is a member of nothing reaches nothing: when domains are
  // asked for, none — or an empty list — is refused.
  if (requested === undefined || requested.length === 0) {
    if (!required) return [];
    throw httpError(
      domains.length > 1
        ? 'Name the domains the user is a member of: this relay has more than one'
        : 'A new user is a member of at least one domain',
      400,
      { code: 'domains_required' },
    );
  }
  const names = new Set(domains.map((d) => d.name));
  const wanted = normalizeMemberships(requested);
  const unknown = wanted.find((m) => !names.has(m.name));
  if (unknown !== undefined) {
    throw httpError(`'${unknown.name}' is not a domain of this relay`, 400, {
      code: 'unknown_domain',
    });
  }
  return wanted;
}

/**
 * Give `userId` `memberships`, inside the caller's transaction: the rows
 * that are new — a membership the user holds already keeps its kind — and
 * the audit entries for them (to record once the transaction committed).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} userId
 * @param {ReadonlyArray<string | { name: string, kind: 'member' | 'external' }>} memberships
 *   a bare domain name is a `member`
 * @param {{ actor: string, now: string }} opts
 * @returns {Array<{ action: string, details: object }>}
 */
export function insertMembershipsSync(db, userId, memberships, { actor, now }) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO domain_members (domain, user_id, kind, added_at, added_by)
     SELECT name, ?, ?, ?, ? FROM domains WHERE name = ?`,
  );
  const events = [];
  for (const { name: domain, kind } of normalizeMemberships(memberships)) {
    if (insert.run(userId, kind, now, actor, domain).changes > 0) {
      events.push({ action: 'directory.membership.added', details: { domain, userId, kind } });
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
  return db
    .prepare('DELETE FROM domain_members WHERE user_id = ? RETURNING domain')
    .all(userId)
    .map(({ domain }) => ({
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
    const domain = configDomain();
    if (!domain) return null;
    const now = new Date().toISOString();
    const members = inTransaction(db, () => {
      db.prepare(
        `INSERT INTO domains (name, is_primary, status, created_at, activated_at)
         VALUES (?, 1, 'active', ?, ?)`,
      ).run(domain, now, now);
      return db
        .prepare(
          `INSERT INTO domain_members (domain, user_id, added_at, added_by)
           SELECT ?, user_id, ?, 'migration' FROM directory_users WHERE status <> 'removed'`,
        )
        .run(domain, now).changes;
    });
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
 * The active domains with the usernames of their active members and of
 * their active external members — what Authelia and Gatekeeper are told. A
 * username users.yml holds that is not a Lamaste username is never rendered
 * (counted, never named). Read it under {@link withDomainRendering} to write
 * anything from it.
 *
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<Array<{ name: string, members: string[], externals: string[] }>>}
 */
async function domainsWithMembers(logger) {
  const db = await getStateDb();
  const domains = await activeDomains();
  const rows = db
    .prepare(
      `SELECT dm.domain, dm.kind, u.username FROM domain_members dm
       JOIN directory_users u ON u.user_id = dm.user_id
       JOIN domains d ON d.name = dm.domain
       WHERE d.status = 'active' AND u.status = 'active' AND u.username IS NOT NULL
       ORDER BY u.username`,
    )
    .all();
  let ineligible = 0;
  const byDomain = new Map(domains.map((d) => [d.name, { members: [], externals: [] }]));
  for (const row of rows) {
    if (!isLamasteUsername(row.username)) {
      ineligible += 1;
      continue;
    }
    byDomain
      .get(row.domain)
      ?.[row.kind === 'external' ? 'externals' : 'members'].push(row.username);
  }
  if (ineligible !== loggedIneligible) {
    loggedIneligible = ineligible;
    if (ineligible > 0) {
      logger?.warn({ ineligible }, 'Members whose username Authelia cannot be told are left out');
    }
  }
  return domains.map((d) => ({ name: d.name, ...byDomain.get(d.name) }));
}

/**
 * Run `fn(domains)` — `domains` the active domains with their active
 * members, read now — as the one writer of what members may do: two
 * writers would each write their own reading, and the later one could put
 * back a member the earlier had removed. Every write of Authelia's domain
 * access, the projection and the OIDC provider goes through here.
 *
 * @template T
 * @param {(domains: Array<{ name: string, members: string[], externals: string[] }>) => Promise<T>} fn
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<T>}
 */
export function withDomainRendering(fn, { logger } = {}) {
  return renderMutex.run(async () => fn(await domainsWithMembers(logger)));
}

/**
 * Whether the last rendering failed — so a failure streak is audited and
 * notified once, and its end once.
 */
let renderFailing = false;

/**
 * Render the domains and their people, in this order:
 *
 * 1. the groups Lamaste owns into users.yml (lib/owned-groups.js) — who is
 *    a member or an external member of which domain, the hosts and OIDC
 *    clients that name each external member, the static sites' listed
 *    users. Authelia applies them at each user's next request;
 * 2. Gatekeeper's projection (`domains.json`, v2: members and external
 *    members of each active domain);
 * 3. Authelia's session cookies and `access_control` (`sites`: the
 *    protected sites, `sites.json` unless given — a site change passes the
 *    sites it is saving), whose rules name the groups of step 1 and change
 *    only with the domains and protected sites: Authelia restarts only then.
 *
 * The groups come first: a rule never names a group that is not yet filled,
 * and a host group never outlives the rule that narrows its host (an
 * external member holding a host group is admitted there by their domain's
 * rule). Each step is always attempted — one failing never keeps another
 * at older, more permissive members. Nothing before onboarding made a
 * domain. Throws when any failed (callers report a warning; the identity
 * tick renders again within a minute); the first failure of a streak is
 * audited (`domain.render.failed`) and notified to the administrators, its
 * end audited (`domain.render.recovered`). Gatekeeper's grants that could
 * not be read are a warning (`warnings`), not a failure: the grants
 * external members hold are kept as they are.
 *
 * @param {{ logger?: import('pino').Logger, sites?: readonly object[] }} [opts]
 * @returns {Promise<{ changed: boolean, groupsChanged: boolean, domains: number, warnings?: string[] }>}
 */
export function syncDomainAccess({ logger, sites } = {}) {
  return withDomainRendering(
    async (domains) => {
      if (domains.length === 0) return { changed: false, groupsChanged: false, domains: 0 };
      const siteList = sites ?? (await readSites());
      const failures = [];
      const warnings = [];
      let groupsChanged = false;
      try {
        const allDomains = await domainNames();
        const owned = await desiredOwnedGroups({ domains, allDomains, sites: siteList });
        if (owned.warning) {
          logger?.warn(owned.warning);
          warnings.push(owned.warning);
        }
        ({ changed: groupsChanged } = await writeOwnedGroups(owned.desired, allDomains));
        if (groupsChanged) logger?.info('Authelia users file groups updated');
      } catch (err) {
        failures.push({ step: 'groups', message: err.message });
      }
      try {
        await atomicWriteJSONIfChanged(
          path.join(STATE_DIR, DOMAINS_PROJECTION_FILE),
          { v: 2, domains },
          { mode: 0o600 },
        );
      } catch (err) {
        failures.push({ step: 'gatekeeper', message: err.message });
      }
      let changed = false;
      try {
        ({ changed } = await updateDomainAccess({
          domains: domains.map((d) => d.name),
          sites: protectedSiteRules(siteList),
        }));
        if (changed) logger?.info({ domains: domains.length }, 'Authelia domain access updated');
      } catch (err) {
        failures.push({ step: 'authelia', message: err.message });
      }
      await recordRenderOutcome(failures, logger);
      if (failures.length > 0) {
        throw new Error(failures.map((f) => `${f.step}: ${f.message}`).join('; '));
      }
      return {
        changed,
        groupsChanged,
        domains: domains.length,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
    { logger },
  );
}

/** How long a change of tunnels or sites waits before the hosts it names are rendered. */
const HOST_RENDER_DELAY_MS = 100;
let hostRenderTimer = null;

/**
 * After tunnels.json or sites.json changed (lib/state.js): render the
 * domains once more, shortly — a restricted host's group names the external
 * members granted it, and a tunnel or web surface that became restricted,
 * stopped being one or went changes who holds which. Only while some
 * domain has external members (the host groups name no one else);
 * coalesced, best effort (the identity tick renders every minute anyway).
 */
export function scheduleHostRender() {
  if (hostRenderTimer) return;
  hostRenderTimer = setTimeout(() => {
    hostRenderTimer = null;
    void (async () => {
      const db = await getStateDb();
      if (!db.prepare("SELECT 1 FROM domain_members WHERE kind = 'external' LIMIT 1").get()) return;
      await syncDomainAccess();
    })().catch(() => {
      // Audited by the rendering itself; the identity tick renders again.
    });
  }, HOST_RENDER_DELAY_MS);
  hostRenderTimer.unref();
}

/** Audit and notify the start and the end of a failure streak (steps only, never members). */
async function recordRenderOutcome(failures, logger) {
  const failing = failures.length > 0;
  if (failing === renderFailing) return;
  renderFailing = failing;
  const steps = failures.map((f) => f.step);
  await recordAuditBestEffort(
    failing
      ? { actor: 'lamaste', action: 'domain.render.failed', details: { steps } }
      : { actor: 'lamaste', action: 'domain.render.recovered', details: {} },
    logger,
  );
  if (failing) {
    const { notifyAdminsBestEffort } = await import('./notifications.js');
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'critical',
        message: `Who may reach the relay's domains could not be rendered (${steps.join(', ')}): a membership that ended may still let its user in. The panel retries every minute.`,
      },
      logger,
    );
  }
}

/**
 * After a change of who may reach a domain: render it and — when the change
 * reaches a rendering (`effective`: an active user on an active domain) —
 * drop Gatekeeper's cached session verdicts and recompute the plugins'
 * audiences (a plugin's audience is its domain's members). Returns the
 * warnings.
 */
async function settleMembership(logger, { effective = true } = {}) {
  const warnings = [];
  try {
    await syncDomainAccess({ logger });
  } catch (err) {
    logger?.error({ err: err.message }, 'Rendering domain access failed');
    warnings.push({
      step: 'render',
      message: `Domain access was not fully rendered (${err.message}); the panel renders it again within a minute`,
    });
  }
  if (!effective) return warnings;
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

/** `{ warnings }` when there are any, else nothing — what a route's answer carries. */
const withWarnings = (warnings) => (warnings.length > 0 ? { warnings } : {});

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/**
 * The directory id `ref` names — an id itself, or the username of a user
 * the directory holds (not a deleted one) — or a 404.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} ref
 */
function memberUserId(db, ref) {
  if (isIdentityUuid(ref)) return ref;
  const row = isLamasteUsername(ref)
    ? db
        .prepare("SELECT user_id FROM directory_users WHERE username = ? AND status <> 'removed'")
        .get(ref)
    : undefined;
  if (!row) throw httpError('User not found', 404, { code: 'user_not_found' });
  return row.user_id;
}

/** The directory row of `userId`, or a 404 / 409 the route answers with. */
function memberCandidate(db, userId) {
  const row = db
    .prepare('SELECT user_id, status, username FROM directory_users WHERE user_id = ?')
    .get(userId);
  if (!row) throw httpError('User not found', 404, { code: 'user_not_found' });
  if (row.status === 'removed') {
    throw httpError('The user is deleted', 409, { code: 'user_removed' });
  }
  return row;
}

function domainOr404(db, name) {
  const domain = domainRow(db, name);
  if (!domain) throw httpError('Domain not found', 404, { code: 'domain_not_found' });
  return domain;
}

/**
 * Make user `user` (a directory id or a username) a member of domain
 * `name` of `kind` (`member` unless named): added, or — when they are one
 * of the other kind — changed (audited `directory.membership.changed`).
 * Idempotent (`added: false, changed: false` when they were one of that
 * kind). Refused (409 `external_member_groups`) when an external
 * membership would go to a user who holds Authelia groups. Then renders,
 * busts Gatekeeper's sessions and recomputes the audiences; a member made
 * external whose access to the registry ends loses their registry tokens.
 *
 * @param {string} name
 * @param {string} user
 * @param {{ kind?: 'member' | 'external', actor: string, logger?: import('pino').Logger }} opts
 */
export async function addDomainMember(name, user, { kind = 'member', actor, logger }) {
  const change = await withUsersLock(() =>
    domainsMutex.run(async () => {
      const db = await getStateDb();
      const domain = domainOr404(db, name);
      const userId = memberUserId(db, user);
      const candidate = memberCandidate(db, userId);
      const current = db
        .prepare('SELECT kind FROM domain_members WHERE domain = ? AND user_id = ?')
        .get(name, userId)?.kind;
      if (current === kind) return { userId, added: false, changed: false };
      await assertNoGroupsForExternal(candidate.username, [{ kind }]);
      const now = new Date().toISOString();
      const events =
        current === undefined
          ? insertMembershipsSync(db, userId, [{ name, kind }], { actor, now })
          : changeKindSync(db, userId, name, current, kind);
      for (const event of events) await recordAuditBestEffort({ actor, ...event }, logger);
      return {
        userId,
        username: candidate.username,
        added: current === undefined,
        changed: current !== undefined,
        external: kind === 'external',
        effective: domain.status === 'active' && candidate.status === 'active',
      };
    }),
  );
  if (!change.added && !change.changed) return { added: false, changed: false };
  const warnings = await settleMembership(logger, { effective: change.effective });
  if (change.changed && change.external && change.username) {
    warnings.push(...(await revokeRegistryTokensFor(change.username, change.userId, logger)));
  }
  return { added: change.added, changed: change.changed, ...withWarnings(warnings) };
}

/**
 * Change the kind of `userId`'s membership of `domain` from `from` to `to`,
 * inside the caller's transaction (or alone); returns the audit entry.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
function changeKindSync(db, userId, domain, from, to) {
  db.prepare('UPDATE domain_members SET kind = ? WHERE domain = ? AND user_id = ?').run(
    to,
    domain,
    userId,
  );
  return [{ action: 'directory.membership.changed', details: { domain, userId, from, to } }];
}

/**
 * End the membership of user `user` (a directory id or a username) of
 * domain `name` (`removed: false` when there was none). Then renders, busts
 * Gatekeeper's sessions, recomputes the audiences, and — when `name` is the
 * registry's domain — revokes the user's registry tokens.
 *
 * @param {string} name
 * @param {string} user
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeDomainMember(name, user, { actor, logger }) {
  let userId;
  const removed = await domainsMutex.run(async () => {
    const db = await getStateDb();
    const domain = domainOr404(db, name);
    userId = memberUserId(db, user);
    const row = db
      .prepare(
        `SELECT u.username, u.status FROM domain_members dm JOIN directory_users u USING (user_id)
         WHERE dm.domain = ? AND dm.user_id = ?`,
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
    return {
      username: row.username,
      effective: domain.status === 'active' && row.status === 'active',
    };
  });
  if (!removed) return { removed: false };
  const warnings = await settleMembership(logger, { effective: removed.effective });
  if (removed.username) {
    warnings.push(...(await revokeRegistryTokensFor(removed.username, userId, logger)));
  }
  return { removed: true, ...withWarnings(warnings) };
}

/**
 * Make user `userId`'s memberships exactly `memberships` (a bare domain
 * name is a `member`) — the users API's edit: the difference applied in one
 * transaction — memberships added, ended, and changed in kind — each
 * audited as {@link addDomainMember} / {@link removeDomainMember} audit
 * them. Refused (409 `external_member_groups`) when it would make a user
 * who holds Authelia groups an external member. Then one rendering, and the
 * user's registry tokens revoked when a membership ended or became
 * external and their access to the registry with it. Throws a 400
 * `unknown_domain` for a domain the relay does not have, a 404 / 409 for a
 * user it cannot be.
 *
 * @param {string} userId
 * @param {ReadonlyArray<string | { name: string, kind: 'member' | 'external' }>} memberships
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ domains: Array<{ name: string, kind: 'member' | 'external' }>, changed: boolean, warnings?: Array<object> }>}
 */
export async function setUserDomains(userId, memberships, { actor, logger }) {
  const wanted = normalizeMemberships(memberships).sort((a, b) => a.name.localeCompare(b.name));
  const change = await withUsersLock(() =>
    domainsMutex.run(async () => {
      const db = await getStateDb();
      const known = new Map((await listDomains()).map((d) => [d.name, d]));
      const unknown = wanted.find((m) => !known.has(m.name));
      if (unknown !== undefined) {
        throw httpError(`'${unknown.name}' is not a domain of this relay`, 400, {
          code: 'unknown_domain',
        });
      }
      const user = memberCandidate(db, userId);
      const current = new Map(
        db
          .prepare('SELECT domain, kind FROM domain_members WHERE user_id = ?')
          .all(userId)
          .map((r) => [r.domain, r.kind]),
      );
      const wantedKinds = new Map(wanted.map((m) => [m.name, m.kind]));
      const ended = [...current.keys()].filter((d) => !wantedKinds.has(d));
      const rekinded = wanted.filter((m) => current.has(m.name) && current.get(m.name) !== m.kind);
      const added = wanted.filter((m) => !current.has(m.name));
      if (rekinded.length > 0 || added.length > 0) {
        await assertNoGroupsForExternal(user.username, [...rekinded, ...added]);
      }
      const events = inTransaction(db, () => {
        const remove = db.prepare('DELETE FROM domain_members WHERE domain = ? AND user_id = ?');
        for (const domain of ended) remove.run(domain, userId);
        return [
          ...insertMembershipsSync(db, userId, added, { actor, now: new Date().toISOString() }),
          ...rekinded.flatMap((m) =>
            changeKindSync(db, userId, m.name, current.get(m.name), m.kind),
          ),
          ...ended.map((domain) => ({
            action: 'directory.membership.removed',
            details: { domain, userId, reason: 'removed' },
          })),
        ];
      });
      for (const event of events) await recordAuditBestEffort({ actor, ...event }, logger);
      const touched = events.map((e) => known.get(e.details.domain));
      return {
        username: user.username,
        narrowed: ended.length > 0 || rekinded.some((m) => m.kind === 'external'),
        changed: events.length > 0,
        effective: user.status === 'active' && touched.some((d) => d?.status === 'active'),
      };
    }),
  );
  if (!change.changed) return { domains: wanted, changed: false };
  const warnings = await settleMembership(logger, { effective: change.effective });
  if (change.username && change.narrowed) {
    warnings.push(...(await revokeRegistryTokensFor(change.username, userId, logger)));
  }
  return { domains: wanted, changed: true, ...withWarnings(warnings) };
}

/**
 * Whether user `userId` (`username`) still reaches the registry's sign-in
 * on one of `domains` (its issuer domain, Feria's own domain): as a member
 * of one, or as an external member of one granted a user-facing OIDC client
 * of it (a grant directly or through a Lamaste group). Gatekeeper not
 * answering is "no" — fail closed.
 *
 * @param {string} username
 * @param {string} userId
 * @param {readonly string[]} domains
 */
async function reachesRegistry(username, userId, domains) {
  const db = await getStateDb();
  const kinds = db
    .prepare('SELECT domain, kind FROM domain_members WHERE user_id = ?')
    .all(userId)
    .filter((r) => domains.includes(r.domain));
  if (kinds.some((r) => r.kind === 'member')) return true;
  if (kinds.length === 0) return false;
  const { readGrantedResources, userFacingOidcClients, OIDC_CLIENT_RESOURCE } =
    await import('./owned-groups.js');
  const read = await readGrantedResources();
  if (!read.ok) return false;
  const externalOf = new Set(kinds.map((r) => r.domain));
  return (await userFacingOidcClients()).some(
    (c) => externalOf.has(c.domain) && read.granted[OIDC_CLIENT_RESOURCE].get(c.id)?.has(username),
  );
}

/**
 * After a user's access narrowed — a membership ended or became external, a
 * grant on an OIDC client went: revoke their registry tokens when they no
 * longer reach the registry's sign-in ({@link reachesRegistry}) — the
 * sign-in that minted the tokens would refuse them now. Best effort;
 * returns warnings.
 *
 * @param {string} username
 * @param {string} userId
 * @param {import('pino').Logger} [logger]
 */
export async function revokeRegistryTokensFor(username, userId, logger) {
  try {
    const { readRegistryCredentialConfig } = await import('./registry-credential.js');
    const config = await readRegistryCredentialConfig();
    if (!config) return [];
    if (await reachesRegistry(username, userId, await registryDomainsOf(config))) return [];
    return await revokeTokensOf([{ username, userId }], config, logger);
  } catch (err) {
    logger?.warn({ userId, err: err.message }, 'Registry tokens were not revoked');
    return [{ step: 'registry', message: `Registry tokens were not revoked: ${err.message}` }];
  }
}

/** At most this many registry revocations in flight. */
const REVOCATION_CONCURRENCY = 4;

/** Revoke the registry tokens of `users` against `config`, a few at a time; returns warnings. */
async function revokeTokensOf(users, config, logger) {
  const { revokeUserRegistryTokens } = await import('./registry-credential.js');
  const warnings = [];
  const queue = [...users];
  const worker = async () => {
    for (let user = queue.shift(); user; user = queue.shift()) {
      try {
        await revokeUserRegistryTokens(user.username, { deleted: true }, logger, {
          userId: user.userId,
          config,
        });
      } catch (err) {
        logger?.warn({ userId: user.userId, err: err.message }, 'Registry tokens were not revoked');
        warnings.push({
          step: 'registry',
          message: `Registry tokens were not revoked: ${err.message}`,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REVOCATION_CONCURRENCY, users.length) }, worker));
  return warnings;
}

/**
 * Revoke the registry tokens of every user who is a member or an external
 * member of none of `domains` — after the registry credential changed its
 * domains: who may hold a token follows them (an external member of one
 * whose client grant does not reach the registry is revoked when the grant
 * goes, {@link revokeRegistryTokensFor}). Best effort; returns warnings.
 *
 * @param {readonly string[]} domains
 * @param {object} config the stored credential
 * @param {import('pino').Logger} [logger]
 */
export async function revokeRegistryTokensOutside(domains, config, logger) {
  const db = await getStateDb();
  const placeholders = domains.map(() => '?').join(', ') || "''";
  const outside = db
    .prepare(
      `SELECT u.user_id AS userId, u.username FROM directory_users u
        WHERE u.status != 'removed' AND u.username IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM domain_members m
                           WHERE m.user_id = u.user_id AND m.domain IN (${placeholders}))`,
    )
    .all(...domains);
  return revokeTokensOf(outside, config, logger);
}

// ---------------------------------------------------------------------------
// Domain lifecycle
// ---------------------------------------------------------------------------

/**
 * Change the set of domains — add one, activate one, remove one — holding
 * the tunnel lock, then the sites lock, then the domains lock: the locks
 * under which tunnels, sites and plugin moves resolve their domain, and
 * under which a site or an alias takes a hostname. So no hostname is taken
 * on a domain between the check of its relay hostnames and its insertion,
 * and nothing lands on a domain between its usage check and its removal.
 * Keep slow work (certificates, nginx reloads) outside.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function changeDomains(fn) {
  return withTunnelLock(() => withSitesLock(() => domainsMutex.run(fn)));
}

/**
 * Add domain `name` (`pending`): validated, refused when it overlaps
 * another, shares a registrable domain with one or is a public suffix
 * (400 `invalid_domain` / `public_suffix`, 409 `domain_overlap` /
 * `same_registrable_domain`), or while a tunnel, site or alias holds one of
 * its relay hostnames (409 `relay_host_taken`).
 *
 * @param {string} name
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<Domain>}
 */
export async function addDomain(name, { actor, logger }) {
  return changeDomains(async () => {
    const db = await getStateDb();
    const existing = db
      .prepare('SELECT name FROM domains')
      .all()
      .map((r) => r.name);
    try {
      assertDomainRegistrable(name, existing);
    } catch (err) {
      if (err.code === 'DOMAIN_OVERLAP' || err.code === 'SAME_REGISTRABLE_DOMAIN') {
        throw httpError(err.message, 409, { code: err.code.toLowerCase() });
      }
      throw httpError(err.message, 400, {
        code: err.code === 'PUBLIC_SUFFIX' ? 'public_suffix' : 'invalid_domain',
      });
    }
    await assertRelayHostsFree(name);
    db.prepare(
      "INSERT INTO domains (name, is_primary, status, created_at) VALUES (?, 0, 'pending', ?)",
    ).run(name, new Date().toISOString());
    await recordAuditBestEffort(
      { actor, action: 'domain.added', details: { domain: name, primary: false } },
      logger,
    );
    return domainRow(db, name);
  });
}

/**
 * Check the DNS a domain needs: `auth.<domain>` must resolve to the relay.
 * Reports whether a wildcard record is in place too (a probe name), which
 * every tunnel and site hostname then resolves through.
 *
 * @param {string} name
 */
export async function verifyDomainDns(name) {
  domainOr404(await getStateDb(), name);
  const expectedIp = getConfig().ip;
  const authName = `auth.${name}`;
  const [auth, wildcard] = await Promise.all([
    resolveHostA(authName),
    resolveHostA(`${DNS_WILDCARD_PROBE_LABEL}.${name}`),
  ]);
  const record = (name, resolvedIps, required, purpose) => ({
    type: 'A',
    name,
    value: expectedIp,
    required,
    purpose,
    resolvedIps,
    ok: resolvedIps.includes(expectedIp),
  });
  const records = [
    record(authName, auth, true, 'the domain’s sign-in page'),
    // Probed through a name nothing else uses.
    record(
      `*.${name}`,
      wildcard,
      false,
      'every tunnel and site hostname — or one A record per hostname instead',
    ),
  ];
  return { ok: records.every((r) => !r.required || r.ok), expectedIp, records };
}

/** What activation needs from nginx and certbot (the real ones unless a test gives others). */
async function activationDeps() {
  if (activationOverride) return activationOverride;
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
  const pending = await domainsMutex.run(async () => {
    const domain = domainOr404(await getStateDb(), name);
    return domain.status === 'active' ? null : domain;
  });
  if (pending === null) return getDomain(name);
  const { email } = getConfig();
  if (!email) throw httpError('The panel has no email for certificates', 400);
  const deps = await activationDeps();
  const fqdn = `auth.${name}`;
  // Outside the locks: certbot takes its time, and an extra certificate of
  // a domain removed meanwhile is harmless.
  try {
    await deps.issueCert(fqdn, email);
  } catch (err) {
    throw httpError(`The certificate of ${fqdn} could not be issued: ${err.message}`, 502, {
      code: 'cert_failed',
    });
  }
  const activated = await changeDomains(async () => {
    const db = await getStateDb();
    // Checked again under the locks: removed, activated or its relay
    // hostnames taken while the certificate was issued.
    const domain = domainOr404(db, name);
    if (domain.status === 'active') return null;
    await assertRelayHostsFree(name);
    try {
      await deps.writeAuthVhost(name, { primary: false });
    } catch (err) {
      throw httpError(`nginx refused the vhost of ${fqdn}: ${err.message}`, 502, {
        code: 'nginx_failed',
      });
    }
    db.prepare("UPDATE domains SET status = 'active', activated_at = ? WHERE name = ?").run(
      new Date().toISOString(),
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
    return domainRow(db, name);
  });
  if (activated === null) return getDomain(name);
  await recordAuditBestEffort(
    { actor, action: 'domain.activated', details: { domain: name } },
    logger,
  );
  const { bustGatekeeperSessions } = await import('./gatekeeper-client.js');
  await bustGatekeeperSessions();
  return activated;
}

/**
 * What uses each of `names`: tunnels and sites (a hostname or an alias
 * under it), plugins that belong to it, the registry credential's issuer —
 * the state read once.
 *
 * @param {readonly string[]} names
 * @returns {Promise<Map<string, { tunnels: string[], sites: string[], plugins: string[], registry: boolean }>>}
 */
async function usageByDomain(names) {
  const usage = new Map(
    names.map((n) => [n, { tunnels: [], sites: [], plugins: [], registry: false }]),
  );
  const of = (host) => (typeof host === 'string' ? usage.get(domainOfHost(host, names)) : null);
  for (const t of await readTunnels()) of(t.fqdn)?.tunnels.push(t.fqdn);
  for (const s of await readSites()) {
    const hosts = [s.fqdn, ...(s.aliases ?? [])];
    for (const name of new Set(hosts.map((h) => domainOfHost(h, names)).filter(Boolean))) {
      usage.get(name).sites.push(s.fqdn);
    }
  }
  const db = await getStateDb();
  for (const row of db.prepare('SELECT name, domain FROM plugins ORDER BY name').all()) {
    if (row.domain) usage.get(row.domain)?.plugins.push(row.name);
  }
  for (const domain of await registryDomains().catch(() => [])) {
    if (usage.has(domain)) usage.get(domain).registry = true;
  }
  return usage;
}

/**
 * What uses domain `name`: tunnels and sites (a hostname or an alias under
 * it), plugins that belong to it, the registry credential's issuer.
 *
 * @param {string} name
 */
export async function domainUsage(name) {
  return (await usageByDomain([name])).get(name);
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
  // The usage check and the deletion alone hold the locks (see
  // changeDomains); audits and nginx come after.
  const removed = await changeDomains(async () => {
    const db = await getStateDb();
    const domain = domainOr404(db, name);
    if (domain.primary) {
      throw httpError('The primary domain cannot be removed', 400, { code: 'primary_domain' });
    }
    const usedBy = await domainUsage(name);
    const { tunnels, sites, plugins, registry } = usedBy;
    if (tunnels.length + sites.length + plugins.length > 0 || registry) {
      throw httpError(`Domain '${name}' is in use`, 409, { code: 'domain_in_use', usedBy });
    }
    const members = inTransaction(db, () => {
      const ended = db
        .prepare('DELETE FROM domain_members WHERE domain = ? RETURNING user_id')
        .all(name)
        .map((r) => r.user_id);
      db.prepare('DELETE FROM domains WHERE name = ?').run(name);
      return ended;
    });
    return { active: domain.status === 'active', members };
  });
  for (const userId of removed.members) {
    await recordAuditBestEffort(
      {
        actor,
        action: 'directory.membership.removed',
        details: { domain: name, userId, reason: 'domain-removed' },
      },
      logger,
    );
  }
  await recordAuditBestEffort(
    { actor, action: 'domain.removed', details: { domain: name, members: removed.members.length } },
    logger,
  );
  if (removed.active) {
    // Unless the name was added again meanwhile — its new vhost is its own.
    await domainsMutex.run(async () => {
      if (domainRow(await getStateDb(), name)) return;
      const deps = await activationDeps();
      await deps.removeAuthVhost(name).catch((err) => {
        logger?.warn(
          { domain: name, err: err.message },
          'The auth vhost of a removed domain stayed',
        );
      });
    });
  }
  // No registry token can depend on a removed domain: the registry's
  // domains cannot be removed (`domain_in_use`).
  return {
    removed: true,
    ...withWarnings(await settleMembership(logger, { effective: removed.active })),
  };
}
