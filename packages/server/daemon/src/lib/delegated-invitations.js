/**
 * Delegated invitations — the rules (packages/core/docs/delegated-invitations-design.md):
 * the administrator's policy for one plugin, whether a plugin can be
 * invited into at all, what an inviter may give, one check of whether an
 * invitation can still be accepted (used by every sweep and by the
 * acceptance itself), and making one. The store is lib/invitations.js.
 *
 * What an invitation grants is fixed here, never by a request: an external
 * membership of the plugin's domain, the one role the inviter named (a role
 * the inviter's own roles may give, `identity.roles[].invites`), and the
 * grant on the plugin's own restricted web surface. Nothing else.
 */

import crypto from 'node:crypto';

import {
  DEFAULT_INVITATION_POLICY,
  INVITATIONS_PER_INVITER_PER_HOUR,
  INVITATION_GRANT_RESERVE,
  InvitationPolicyInputSchema,
  emailDomainOf,
  grantableRoles,
  invitingRoles,
} from '@lamalibre/lamaste';

import { httpError } from './app-error.js';
import { readAudienceRow } from './audience.js';
import { recordAuditBestEffort } from './audit.js';
import { getDirectoryUser } from './directory.js';
import { declaredRoleIds } from './entitlements.js';
import { gatekeeperGrantCapacity } from './gatekeeper-client.js';
import {
  getInvitation,
  listInvitations,
  newInvitationToken,
  revokeInvitationSync,
  withInvitationsLock,
} from './invitations.js';
import { pluginDomainName } from './domains.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { findPlugin } from './plugins.js';
import { readSites, readTunnels } from './state.js';
import { getStateDb } from './state-db.js';

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

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

function rowToPolicy(row) {
  if (!row) return { ...DEFAULT_INVITATION_POLICY, updatedAt: null, updatedBy: null };
  let emailDomains = [];
  try {
    const parsed = JSON.parse(row.email_domains_json);
    if (Array.isArray(parsed)) emailDomains = parsed.filter((d) => typeof d === 'string');
  } catch {
    // an unreadable list allows nothing
  }
  return {
    enabled: row.enabled === 1,
    emailDomains,
    maxOpenPerInviter: row.max_open_per_inviter,
    maxJoined: row.max_joined,
    lifetimeDays: row.lifetime_days,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/**
 * The administrator's policy for plugin `name` — off when none was set.
 *
 * @param {string} name
 */
export async function getInvitationPolicy(name) {
  const db = await getStateDb();
  return rowToPolicy(
    db.prepare('SELECT * FROM plugin_invitation_policies WHERE plugin = ?').get(name),
  );
}

// ---------------------------------------------------------------------------
// Whether a plugin can be invited into
// ---------------------------------------------------------------------------

/**
 * Whether installed plugin `plugin` can be invited into now, and where:
 * its approved version declares an inviting role, and it has its own web
 * surface — a site it owns, `restricted`, served. A tunnel bound as a user
 * surface is never granted (it would open the tunnel's own application),
 * and an `authenticated` surface refuses external members.
 *
 * @returns {Promise<{ ok: true, site: { id: string, fqdn: string }, domain: string } | { ok: false, reason: string }>}
 */
export async function invitationSurface(plugin) {
  if (surfaceForTests) return surfaceForTests(plugin);
  if (!plugin) return { ok: false, reason: 'not_installed' };
  if (!plugin.identity) return { ok: false, reason: 'no_identity' };
  if (invitingRoles(plugin.identity).size === 0) return { ok: false, reason: 'no_inviting_role' };
  if (!(await installedVersionApproved(plugin).catch(() => false))) {
    return { ok: false, reason: 'not_approved' };
  }
  const { ownedSiteOf, webSurfaceServing } = await import('./web-surface.js');
  const [sites, tunnels] = await Promise.all([readSites(), readTunnels()]);
  const site = ownedSiteOf(plugin.route, sites);
  if (!site) return { ok: false, reason: 'no_web_surface' };
  if (site.accessMode !== 'restricted') return { ok: false, reason: 'surface_not_restricted' };
  const serving = await webSurfaceServing(plugin.route, tunnels);
  if (!serving.served) return { ok: false, reason: `surface_${serving.reason}` };
  return {
    ok: true,
    site: { id: site.id, fqdn: site.fqdn },
    domain: await pluginDomainName(plugin),
  };
}

/** Tests only: what {@link invitationSurface} answers instead of reading the web surface. */
let surfaceForTests = null;

/** @param {((plugin: object | null) => Promise<object> | object) | null} fn */
export function setInvitationSurfaceForTests(fn) {
  surfaceForTests = fn;
}

/** The text of an availability refusal, for the administrator. */
const UNAVAILABLE_TEXT = {
  not_installed: 'the plugin is not installed',
  no_identity: 'the plugin declares no identity',
  no_inviting_role: 'no role of the plugin may invite (identity.roles[].invites)',
  not_approved: 'the installed version is not approved',
  no_web_surface: 'the plugin has no web surface of its own',
  surface_not_restricted:
    "the plugin's web surface is not restricted (an authenticated one refuses external members)",
};

function unavailableText(reason) {
  return UNAVAILABLE_TEXT[reason] ?? `the plugin's web surface is not served (${reason})`;
}

/**
 * Set plugin `name`'s policy (the whole of it). Enabling is refused (409
 * `invitations_unavailable`) unless {@link invitationSurface} allows it.
 * Then the plugin's open invitations are swept against it. Audited.
 *
 * @param {string} name
 * @param {unknown} input
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function setInvitationPolicy(name, input, { actor, logger }) {
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" is not installed`, 404);
  const parsed = InvitationPolicyInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw httpError(issue?.message ?? 'Invalid invitation policy', 400, {
      code: 'invalid_policy',
    });
  }
  const policy = parsed.data;
  if (policy.enabled) {
    const surface = await invitationSurface(plugin);
    if (!surface.ok) {
      throw httpError(`Invitations cannot be enabled: ${unavailableText(surface.reason)}`, 409, {
        code: 'invitations_unavailable',
      });
    }
  }
  await withInvitationsLock(name, async () => {
    const db = await getStateDb();
    db.prepare(
      `INSERT INTO plugin_invitation_policies (plugin, enabled, email_domains_json,
         max_open_per_inviter, max_joined, lifetime_days, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (plugin) DO UPDATE SET enabled = excluded.enabled,
         email_domains_json = excluded.email_domains_json,
         max_open_per_inviter = excluded.max_open_per_inviter,
         max_joined = excluded.max_joined, lifetime_days = excluded.lifetime_days,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).run(
      name,
      policy.enabled ? 1 : 0,
      JSON.stringify(policy.emailDomains),
      policy.maxOpenPerInviter,
      policy.maxJoined,
      policy.lifetimeDays,
      new Date().toISOString(),
      actor,
    );
  });
  await recordAuditBestEffort(
    { actor, action: 'invitation.policy.updated', plugin: name, details: { ...policy } },
    logger,
  );
  await sweepPluginInvitations(name, { logger });
  return getInvitationPolicy(name);
}

/** Forget plugin `name`'s policy (its uninstall), after its invitations were swept. */
export async function dropInvitationPolicy(name) {
  const db = await getStateDb();
  db.prepare('DELETE FROM plugin_invitation_policies WHERE plugin = ?').run(name);
}

// ---------------------------------------------------------------------------
// What an inviter may give
// ---------------------------------------------------------------------------

/**
 * The roles user `userId` may give by invitation on `plugin` now: the
 * union of `invites` of the roles the audience holds them with (as the user
 * surface reads them), restricted to the declared roles. Empty for someone
 * who is not an active member of its audience.
 */
export async function inviterGrantableRoles(plugin, userId) {
  if (!plugin?.identity) return [];
  const row = await readAudienceRow(plugin.name, userId);
  const member = row?.change?.kind === 'upsert' ? row.change.member : null;
  if (!member || member.status !== 'active' || member.userId !== userId) return [];
  const declared = declaredRoleIds(plugin.identity);
  const held = (Array.isArray(member.roles) ? member.roles : []).filter((r) => declared.has(r));
  return grantableRoles(plugin.identity, held).filter((r) => declared.has(r));
}

// ---------------------------------------------------------------------------
// Whether an invitation can still be accepted
// ---------------------------------------------------------------------------

/**
 * Why delegated invitation `inv` can no longer be accepted — a revocation
 * reason — or null when nothing stands in its way. The one rule of every
 * sweep and of the acceptance's checks:
 *
 * - the plugin installed and identity-approved, the role still declared;
 * - its policy enabled, the address's domain still allowed;
 * - its web surface the site the invitation recorded, restricted, served,
 *   on the domain the invitation recorded;
 * - its inviter active, and still able to give the role.
 *
 * @param {object} inv lib/invitations.js's invitation
 * @param {{ plugin?: object | null, policy?: object, surface?: object }} [known] what the caller already read
 * @returns {Promise<import('@lamalibre/lamaste').InvitationRevokeReason | 'surface_unavailable' | null>}
 */
export async function whyNotAcceptable(inv, known = {}) {
  const plugin = known.plugin !== undefined ? known.plugin : await findPlugin(inv.plugin);
  if (!plugin) return 'plugin_removed';
  if (!plugin.identity || !declaredRoleIds(plugin.identity).has(inv.role)) {
    return 'role_undeclared';
  }
  const policy = known.policy ?? (await getInvitationPolicy(plugin.name));
  if (!policy.enabled) return 'policy_disabled';
  if (!policy.emailDomains.includes(inv.emailDomain)) return 'email_domain_removed';

  const surface = known.surface ?? (await invitationSurface(plugin));
  if (!surface.ok) {
    if (surface.reason === 'no_web_surface') return 'surface_removed';
    if (surface.reason === 'surface_not_restricted') return 'surface_not_restricted';
    if (surface.reason === 'no_identity' || surface.reason === 'no_inviting_role') {
      return 'role_undeclared';
    }
    // Not approved, not hosted, the tree not current: may pass again.
    return 'surface_unavailable';
  }
  if (surface.site.id !== inv.siteId) return 'surface_removed';
  const recorded = Array.isArray(inv.domains) ? inv.domains[0]?.name : null;
  if (surface.domain !== recorded) return 'surface_removed';

  const inviter = await getDirectoryUser(inv.inviterUserId);
  if (!inviter || inviter.status === 'removed') return 'inviter_removed';
  if (inviter.status !== 'active') return 'inviter_disabled';
  if (!(await inviterGrantableRoles(plugin, inviter.userId)).includes(inv.role)) {
    return 'inviter_unentitled';
  }
  return null;
}

/**
 * Sweep plugin `name`'s open invitations: revoke every pending one that can
 * no longer be accepted (a reason that may pass again — the surface not
 * served for a moment — revokes nothing), and bring each one's expiry
 * within the policy's lifetime. Holds the plugin's invitations lock.
 * Audits each revocation.
 *
 * @param {string} name
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<{ revoked: number, marked: number, shortened: number }>}
 */
export function sweepPluginInvitations(name, { logger } = {}) {
  return withInvitationsLock(name, async () => {
    const db = await getStateDb();
    // Pending ones are revoked; one being accepted is marked, and its
    // acceptance makes no grant and ends revoked (§7).
    const rows = db
      .prepare(
        `SELECT id FROM invitations WHERE kind = 'delegated' AND plugin = ?
           AND status IN ('pending', 'accepting')`,
      )
      .all(name);
    if (rows.length === 0) return { revoked: 0, marked: 0, shortened: 0 };
    const plugin = await findPlugin(name);
    const policy = await getInvitationPolicy(name);
    const surface = plugin
      ? await invitationSurface(plugin)
      : { ok: false, reason: 'not_installed' };
    const known = { plugin, policy, surface };
    const revocations = [];
    let shortened = 0;
    for (const { id } of rows) {
      const inv = await getInvitation(id);
      if (!inv || (inv.status !== 'pending' && inv.status !== 'accepting')) continue;
      const reason = await whyNotAcceptable(inv, known);
      if (reason !== null && reason !== 'surface_unavailable') {
        // Its inviter's standing counts until it is accepted (D1).
        revocations.push({ inv, reason });
        continue;
      }
      if (inv.status !== 'pending') continue;
      const latest = Date.parse(inv.createdAt) + policy.lifetimeDays * 24 * 60 * 60 * 1000;
      if (Date.parse(inv.expiresAt) > latest) {
        db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(
          new Date(latest).toISOString(),
          id,
        );
        shortened += 1;
      }
    }
    const done = [];
    if (revocations.length > 0) {
      inTransaction(db, () => {
        for (const { inv, reason } of revocations) {
          const outcome = revokeInvitationSync(db, inv.id, { by: 'lamaste', reason });
          if (outcome === 'revoked') done.push({ inv, reason });
        }
      });
    }
    for (const { inv, reason } of done) {
      await recordAuditBestEffort(
        {
          actor: 'lamaste',
          action: 'invitation.revoked',
          plugin: name,
          details: { invitationId: inv.id, kind: 'delegated', reason },
        },
        logger,
      );
    }
    return { revoked: done.length, marked: revocations.length - done.length, shortened };
  });
}

/**
 * Sweep every plugin that has open delegated invitations — after the
 * audiences change (an inviter disabled, removed or no longer entitled).
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function sweepAllInvitations({ logger } = {}) {
  const db = await getStateDb();
  const plugins = db
    .prepare(
      `SELECT DISTINCT plugin FROM invitations WHERE kind = 'delegated'
         AND status IN ('pending', 'accepting')`,
    )
    .all()
    .map((r) => r.plugin);
  for (const name of plugins) {
    try {
      await sweepPluginInvitations(name, { logger });
    } catch (err) {
      logger?.error({ err: err.message, plugin: name }, 'Sweeping invitations failed');
    }
  }
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/**
 * Refuse (503 `grant_reserve`) while Gatekeeper has fewer than
 * {@link INVITATION_GRANT_RESERVE} free grants, or cannot say (fail closed).
 */
export async function assertGrantReserve() {
  const capacity = await gatekeeperGrantCapacity();
  if (!capacity.ok) {
    throw httpError('Gatekeeper is not reachable — try again shortly', 503, {
      code: 'gatekeeper_unavailable',
    });
  }
  if (capacity.max - capacity.held < INVITATION_GRANT_RESERVE) {
    throw httpError('The relay cannot take more people by invitation right now', 503, {
      code: 'grant_reserve',
    });
  }
}

/**
 * Inside the plugin's invitations lock and a transaction: the counts the
 * caps are measured against.
 */
function countsSync(db, plugin, inviterUserId, now) {
  const nowIso = new Date(now).toISOString();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const openOfInviter = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invitations WHERE kind = 'delegated' AND plugin = ?
         AND inviter_user_id = ? AND (status = 'accepting' OR (status = 'pending' AND expires_at > ?))`,
    )
    .get(plugin, inviterUserId, nowIso).n;
  const openOfPlugin = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invitations WHERE kind = 'delegated' AND plugin = ?
         AND (status = 'accepting' OR (status = 'pending' AND expires_at > ?))`,
    )
    .get(plugin, nowIso).n;
  const joined = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invitations i JOIN directory_users u ON u.user_id = i.accepted_user_id
       WHERE i.kind = 'delegated' AND i.plugin = ? AND i.status = 'accepted' AND u.status <> 'removed'`,
    )
    .get(plugin).n;
  const lastHour = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invitations WHERE kind = 'delegated' AND inviter_user_id = ?
         AND created_at > ?`,
    )
    .get(inviterUserId, hourAgo).n;
  return {
    openOfInviter: Number(openOfInviter),
    openOfPlugin: Number(openOfPlugin),
    joined: Number(joined),
    lastHour: Number(lastHour),
  };
}

/**
 * The inviter's view of plugin `plugin`: the roles they may give, the
 * policy's bounds as they apply to them, and their own invitations.
 *
 * @param {object} plugin
 * @param {{ userId: string }} caller
 */
export async function inviterView(plugin, caller) {
  const policy = await getInvitationPolicy(plugin.name);
  const grantable = await inviterGrantableRoles(plugin, caller.userId);
  const labels = new Map(plugin.identity.roles.map((r) => [r.id, r.label]));
  const db = await getStateDb();
  const counts = countsSync(db, plugin.name, caller.userId, Date.now());
  const own = await listInvitations({ plugin: plugin.name, inviterUserId: caller.userId });
  return {
    policy: {
      grantableRoles: grantable.map((id) => ({ id, label: labels.get(id) ?? id })),
      emailDomains: policy.emailDomains,
      lifetimeDays: policy.lifetimeDays,
      maxOpen: policy.maxOpenPerInviter,
      open: counts.openOfInviter,
    },
    invitations: own.map((inv) => inviterItem(inv, labels)),
  };
}

/**
 * An invitation as its inviter sees it — never the token, never who
 * accepted it (the plugin learns that from its feed).
 *
 * @param {object} inv lib/invitations.js's invitation
 * @param {Map<string, string>} labels role id → label
 */
export function inviterItem(inv, labels) {
  return {
    id: inv.id,
    email: inv.email,
    displayName: inv.displayName,
    role: inv.role,
    roleLabel: labels.get(inv.role) ?? inv.role,
    status: inv.shownStatus,
    revokedReason: inv.revokedReason,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt,
  };
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

/**
 * Make a delegated invitation into `plugin` for `caller` (the inviter, as
 * the panel resolved them): `request` is the parsed
 * `DelegatedInvitationRequestSchema` body. Refused with 403
 * `invitations_unavailable` (policy off, surface not ready), 400
 * `email_domain_not_allowed`, 403 `role_not_grantable`, 409
 * `invitation_cap` (`cap`: `inviter` or `plugin`), 429 `invitation_rate`,
 * 503 `grant_reserve`. Returns the invitation and its token (shown once).
 *
 * @param {object} plugin
 * @param {{ userId: string }} caller
 * @param {{ email: string, displayName?: string, role: string }} request
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function createDelegatedInvitation(plugin, caller, request, { logger } = {}) {
  const policy = await getInvitationPolicy(plugin.name);
  const surface = await invitationSurface(plugin);
  if (!policy.enabled || !surface.ok) {
    logger?.info(
      { plugin: plugin.name, reason: policy.enabled ? surface.reason : 'policy_disabled' },
      'Delegated invitation refused: unavailable',
    );
    throw httpError('Invitations are not available for this plugin', 403, {
      code: 'invitations_unavailable',
    });
  }
  const emailDomain = emailDomainOf(request.email);
  if (!emailDomain || !policy.emailDomains.includes(emailDomain)) {
    throw httpError('This e-mail address is not under a domain invitations may go to', 400, {
      code: 'email_domain_not_allowed',
    });
  }
  await assertGrantReserve();

  const { token, tokenSha256 } = newInvitationToken();
  const id = crypto.randomUUID();
  await withInvitationsLock(plugin.name, async () => {
    // The inviter's roles, read inside the lock: a revocation of their role
    // and this invitation are never interleaved.
    const grantable = await inviterGrantableRoles(plugin, caller.userId);
    if (!grantable.includes(request.role)) {
      throw httpError('You may not invite people with this role', 403, {
        code: 'role_not_grantable',
      });
    }
    const db = await getStateDb();
    const now = Date.now();
    inTransaction(db, () => {
      const counts = countsSync(db, plugin.name, caller.userId, now);
      if (counts.lastHour >= INVITATIONS_PER_INVITER_PER_HOUR) {
        throw httpError('Too many invitations in the last hour — try again later', 429, {
          code: 'invitation_rate',
        });
      }
      if (counts.openOfInviter >= policy.maxOpenPerInviter) {
        throw httpError(
          `You have ${counts.openOfInviter} open invitations, the most allowed — revoke one or wait for one to be accepted`,
          409,
          { code: 'invitation_cap', cap: 'inviter' },
        );
      }
      if (counts.joined + counts.openOfPlugin >= policy.maxJoined) {
        throw httpError('This plugin takes no more people by invitation', 409, {
          code: 'invitation_cap',
          cap: 'plugin',
        });
      }
      const nowIso = new Date(now).toISOString();
      db.prepare(
        `INSERT INTO invitations (id, token_sha256, kind, email, display_name, email_domain,
           groups_json, domains_json, plugin, role, site_id, inviter_user_id, created_by,
           created_at, expires_at, status, status_at)
         VALUES (?, ?, 'delegated', ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        id,
        tokenSha256,
        request.email,
        request.displayName ?? null,
        emailDomain,
        JSON.stringify([{ name: surface.domain, kind: 'external' }]),
        plugin.name,
        request.role,
        surface.site.id,
        caller.userId,
        `user:${caller.userId}`,
        nowIso,
        new Date(now + policy.lifetimeDays * 24 * 60 * 60 * 1000).toISOString(),
        nowIso,
      );
    });
  });
  const invitation = await getInvitation(id);
  await recordAuditBestEffort(
    {
      actor: `user:${caller.userId}`,
      action: 'invitation.created',
      plugin: plugin.name,
      details: {
        invitationId: id,
        kind: 'delegated',
        role: request.role,
        emailDomain,
        expiresAt: invitation.expiresAt,
      },
    },
    logger,
  );
  return {
    invitation,
    token,
    // The token in the fragment: no server's log keeps it.
    inviteUrl: `https://auth.${surface.domain}/invite#${token}`,
  };
}

/**
 * Revoke the caller's own pending invitation `id` of `plugin`: 404 for
 * anything else (another's invitation is not told apart from none), 409
 * while it is being accepted.
 */
export async function revokeOwnInvitation(plugin, caller, id, { logger } = {}) {
  const revoked = await withInvitationsLock(plugin.name, async () => {
    const db = await getStateDb();
    return inTransaction(db, () => {
      const row = db
        .prepare(
          `SELECT status FROM invitations WHERE id = ? AND kind = 'delegated' AND plugin = ?
             AND inviter_user_id = ?`,
        )
        .get(id, plugin.name, caller.userId);
      if (!row || (row.status !== 'pending' && row.status !== 'accepting')) {
        throw httpError('Invitation not found', 404);
      }
      return revokeInvitationSync(db, id, { by: `user:${caller.userId}`, reason: 'inviter' });
    });
  });
  if (revoked === null) throw httpError('Invitation not found', 404);
  await recordAuditBestEffort(
    {
      actor: `user:${caller.userId}`,
      action: 'invitation.revoked',
      plugin: plugin.name,
      details: { invitationId: id, kind: 'delegated', reason: 'inviter' },
    },
    logger,
  );
}

// ---------------------------------------------------------------------------
// Queued sweeps
// ---------------------------------------------------------------------------

let sweepTimer = null;
let sweepLogger = null;
let sweeping = Promise.resolve();

/**
 * Sweep every plugin's open invitations soon — coalesced, never awaited by
 * the caller: what changes a plugin, its web surface, its policy holder's
 * standing or an audience asks for it after it is done (the invitations
 * lock is a leaf: nothing holding another lock takes it; §6).
 *
 * @param {import('pino').Logger} [logger]
 */
export function scheduleInvitationSweep(logger) {
  if (logger) sweepLogger = logger;
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    sweeping = sweeping
      .then(() => sweepAllInvitations({ logger: sweepLogger ?? undefined }))
      .catch((err) => sweepLogger?.error({ err: err.message }, 'Sweeping invitations failed'));
  }, 100);
  sweepTimer.unref?.();
}

/** Resolves once no queued sweep is waiting or running (tests). */
export async function invitationSweepsIdle() {
  while (sweepTimer) await new Promise((resolve) => setTimeout(resolve, 20));
  await sweeping;
}

// ---------------------------------------------------------------------------
// The administrator's views and actions
// ---------------------------------------------------------------------------

/**
 * Plugin `name`'s policy as the administrator reads it: the policy, whether
 * the plugin can be invited into now (and why not), and its inviting roles.
 *
 * @param {string} name
 */
export async function invitationPolicyView(name) {
  const plugin = await findPlugin(name);
  if (!plugin) throw httpError(`Plugin "${name}" is not installed`, 404);
  const [policy, surface] = await Promise.all([
    getInvitationPolicy(name),
    invitationSurface(plugin),
  ]);
  const inviting = plugin.identity ? invitingRoles(plugin.identity) : new Map();
  return {
    ...policy,
    available: surface.ok,
    unavailableReason: surface.ok ? null : unavailableText(surface.reason),
    invitingRoles: [...inviting].map(([role, invites]) => ({ role, invites: [...invites] })),
  };
}

/**
 * The users who joined by an invitation of `inviterUserId` — and, with
 * `transitive`, everyone those invited, and so on.
 *
 * @param {string} inviterUserId
 * @param {{ transitive?: boolean }} [opts]
 * @returns {Promise<string[]>} user ids
 */
export async function inviteesOf(inviterUserId, { transitive = false } = {}) {
  const db = await getStateDb();
  const stmt = db.prepare(
    `SELECT DISTINCT accepted_user_id AS id FROM invitations
     WHERE kind = 'delegated' AND inviter_user_id = ? AND accepted_user_id IS NOT NULL`,
  );
  const found = new Set();
  let frontier = [inviterUserId];
  while (frontier.length > 0) {
    const next = [];
    for (const inviter of frontier) {
      for (const { id } of stmt.all(inviter)) {
        if (id === inviterUserId || found.has(id)) continue;
        found.add(id);
        next.push(id);
      }
    }
    frontier = transitive ? next : [];
  }
  return [...found];
}

/**
 * Disable everyone `inviterUserId` invited (with `transitive`, everyone
 * those invited too) — one users.yml write through `changeUsers`, so each
 * is offboarded as any disabled user is (sessions ended, registry tokens
 * revoked, the plugins told). Users already disabled or removed are left
 * as they are; an administrator is never disabled this way. Audited.
 *
 * @param {string} inviterUserId
 * @param {{ transitive?: boolean, actor: string, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ disabled: string[], warnings: Array<{ step: string, message: string }> }>}
 */
export async function disableInvitees(inviterUserId, { transitive = false, actor, logger }) {
  const { changeUsers } = await import('./directory.js');
  const { readUsersRaw, writeUsers } = await import('./authelia.js');
  const ids = await inviteesOf(inviterUserId, { transitive });
  const targets = [];
  for (const id of ids) {
    const user = await getDirectoryUser(id);
    if (user?.status === 'active' && user.username) targets.push(user);
  }
  if (targets.length === 0) return { disabled: [], warnings: [] };
  const usernames = new Set(targets.map((u) => u.username));
  const outcome = await changeUsers(
    async () => {
      const usersData = await readUsersRaw();
      const done = [];
      for (const [username, entry] of Object.entries(usersData.users ?? {})) {
        if (!usernames.has(username) || entry?.disabled === true) continue;
        if (Array.isArray(entry?.groups) && entry.groups.includes('admins')) continue;
        entry.disabled = true;
        done.push(username);
      }
      if (done.length > 0) await writeUsers(usersData);
      return done;
    },
    {
      actor,
      logger,
      expect: (users) =>
        [...usernames].every(
          (u) =>
            !users[u] || users[u].disabled === true || (users[u].groups ?? []).includes('admins'),
        ),
    },
  );
  const disabled = targets.filter((u) => outcome.result.includes(u.username)).map((u) => u.userId);
  await recordAuditBestEffort(
    {
      actor,
      action: 'invitation.invitees.disabled',
      details: { inviterUserId, transitive, userIds: disabled },
    },
    logger,
  );
  return { disabled, warnings: outcome.warnings };
}
