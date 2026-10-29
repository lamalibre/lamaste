/**
 * Accepting an invitation — the public `POST /api/invite/lookup` and
 * `POST /api/invite/accept` — and what keeps acceptances whole afterwards:
 * the recovery of claims a crash left behind and the repair of a delegated
 * acceptance whose grants did not all land
 * (packages/core/docs/delegated-invitations-design.md §7).
 *
 * An acceptance claims its invitation (`accepting`, a random `claim_id`)
 * and checks that claim again under the users lock before it writes
 * anything, so recovery or a revocation taking the claim stops it; the
 * reconcile gives a user created under a claimed username that invitation's
 * memberships (lib/directory.js). A delegated invitee's username must be
 * one nothing names — no directory row (removed ones included), no open
 * invitation, nothing in Gatekeeper, no site list, no desktop grant, no
 * OpenID Connect identity — so nobody inherits anything; every such refusal
 * is the same `409 username_unavailable` and counts a failed attempt (the
 * fifth locks the link). The password is hashed only after the checks that
 * need no lock pass.
 *
 * A delegated token is answered only by `auth.<its domain>` — the `Host`
 * every auth vhost writes as a literal (never `request.host`, which follows
 * a client's `X-Forwarded-Host` behind the trusted loopback hop).
 */

import qrcode from 'qrcode-generator';

import {
  AdminAcceptanceSchema,
  DelegatedAcceptanceSchema,
  INVITATION_REPAIR_WINDOW_MS,
  refusedField,
  suggestedUsername,
} from '@lamalibre/lamaste';

import { httpError } from './app-error.js';
import { listAudit, recordAuditBestEffort } from './audit.js';
import {
  autheliaHoldsOidcIdentity,
  createUserFromInvitation,
  generateTotpSecret,
  hashPassword,
  readUsersRaw,
  writeTotpToDatabase,
} from './authelia.js';
import {
  assertGrantReserve,
  invitationSurface,
  whyNotAcceptable,
} from './delegated-invitations.js';
import {
  changeUsers,
  directoryUserOfInvitation,
  getDirectoryUser,
  usersFileError,
  withReconciledDirectory,
  withUsernamesForGrants,
} from './directory.js';
import { invitationDomainsNow, invitationSignInDomain, syncDomainAccess } from './domains.js';
import { setEntitlement } from './entitlements.js';
import {
  createGatekeeperGrant,
  inspectUserPrincipal,
  listResourceGrants,
} from './gatekeeper-client.js';
import {
  abandonRepair,
  claimInvitation,
  claimState,
  findInvitationByToken,
  finishClaim,
  getInvitation,
  importLegacyInvitations,
  pruneEndedInvitations,
  recordCompletion,
  recordFailedAttempt,
  releaseClaim,
  reservedInvitationUsernames,
  settleStaleClaim,
  staleClaims,
  unfulfilledAcceptances,
  usernameUnavailableError,
} from './invitations.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { findPlugin } from './plugins.js';
import { readSites } from './state.js';
import { listGrantsForUser } from './user-access.js';

/** Inviter reasons hold at the claim and no later: an invitee keeps what a departed inviter gave (D1). */
const INVITER_REASONS = new Set(['inviter_disabled', 'inviter_removed', 'inviter_unentitled']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The QR code of an `otpauth://` URI as the page shows it: an SVG data URI. */
export function totpQrDataUri(uri) {
  const code = qrcode(0, 'M');
  code.addData(uri);
  code.make();
  const svg = code.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

/**
 * Whether the request's `Host` is `auth.<the domain a delegated invitation
 * names>` (its port, if any, ignored).
 *
 * @param {string | undefined} host the raw `Host` header
 * @param {{ domains: unknown }} invitation
 */
export function hostServesInvitation(host, invitation) {
  const domain = Array.isArray(invitation.domains) ? invitation.domains[0]?.name : null;
  if (typeof host !== 'string' || typeof domain !== 'string') return false;
  const name = host.toLowerCase().replace(/:\d+$/, '');
  return name === `auth.${domain}`;
}

/** The invitation a body's token opens, or 404 — a delegated one only on its own sign-in host. */
async function openedInvitation(input, host) {
  const invitation = isRecord(input) ? await findInvitationByToken(input.token) : null;
  if (!invitation) throw httpError('Invitation not found', 404);
  if (invitation.kind === 'delegated' && !hostServesInvitation(host, invitation)) {
    throw httpError('Invitation not found', 404);
  }
  return invitation;
}

/** 410 for an invitation that cannot be accepted any more, 409 while it is being accepted. */
function assertOpen(invitation) {
  if (invitation.shownStatus === 'accepted') {
    throw httpError('This invitation has already been used', 410);
  }
  if (invitation.shownStatus === 'expired') throw httpError('This invitation has expired', 410);
  if (invitation.shownStatus === 'revoked') {
    throw httpError('This invitation is no longer valid', 410);
  }
  if (invitation.shownStatus === 'accepting') {
    throw httpError('This invitation is being accepted right now', 409, {
      code: 'invitation_accepting',
    });
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * `POST /api/invite/lookup { token }` — what the invitation page shows
 * whoever holds the link.
 *
 * @param {unknown} input
 * @param {{ host?: string }} opts
 */
export async function lookupInvitation(input, { host }) {
  const invitation = await openedInvitation(input, host);
  assertOpen(invitation);
  if (invitation.kind === 'admin') {
    return {
      kind: 'admin',
      username: invitation.username,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    };
  }
  const plugin = await findPlugin(invitation.plugin);
  const role = plugin?.identity?.roles.find((r) => r.id === invitation.role);
  const inviter = await getDirectoryUser(invitation.inviterUserId);
  return {
    kind: 'delegated',
    email: invitation.email,
    displayName: invitation.displayName,
    plugin: plugin?.displayName ?? plugin?.route ?? invitation.plugin,
    role: role?.label ?? invitation.role,
    // Their display name only — a sign-in name is nobody else's business.
    invitedBy: inviter?.status === 'active' ? (inviter.displayName ?? null) : null,
    expiresAt: invitation.expiresAt,
    suggestedUsername: invitation.email ? suggestedUsername(invitation.email) : null,
  };
}

// ---------------------------------------------------------------------------
// The username a delegated invitee picks
// ---------------------------------------------------------------------------

/**
 * Inside the users lock: refuse (`username_unavailable`) a username
 * anything names — a directory row of any status, an open invitation other
 * than `invitationId`, a grant or group membership in Gatekeeper (the "user
 * still to come" `withUsernamesForGrants` allows), a static site's listed
 * users, a desktop plugin grant, or an OpenID Connect identity Authelia
 * keeps. 503 when Gatekeeper or Authelia's storage cannot say.
 *
 * @param {string} username
 * @param {string} invitationId
 */
export async function vetInviteeUsername(username, invitationId) {
  if (await usernameNamedLocally(username, invitationId)) throw usernameUnavailableError();
  const principal = await inspectUserPrincipal(username);
  if (!principal.ok) {
    throw httpError('Gatekeeper is not reachable — try again shortly', 503, {
      code: 'gatekeeper_unavailable',
    });
  }
  if (principal.grants > 0 || principal.groups > 0) throw usernameUnavailableError();
  const sites = await readSites();
  if (
    sites.some((site) => Array.isArray(site.allowedUsers) && site.allowedUsers.includes(username))
  ) {
    throw usernameUnavailableError();
  }
  if ((await listGrantsForUser(username)).length > 0) throw usernameUnavailableError();
  let held;
  try {
    held = await autheliaHoldsOidcIdentity(username);
  } catch {
    throw httpError("Authelia's storage cannot be read — try again shortly", 503, {
      code: 'authelia_storage_unavailable',
    });
  }
  if (held) throw usernameUnavailableError();
}

/** The checks of {@link vetInviteeUsername} that need neither a lock nor another service. */
async function usernameNamedLocally(username, invitationId) {
  const db = await (await import('./state-db.js')).getStateDb();
  const directory = db.prepare('SELECT 1 FROM directory_users WHERE username = ?').get(username);
  if (directory) return true;
  return (await reservedInvitationUsernames({ except: invitationId })).has(username);
}

// ---------------------------------------------------------------------------
// The grants of a delegated acceptance
// ---------------------------------------------------------------------------

/** Thrown by a grant's precondition: the invitation may not grant (any more). */
class GrantStopped extends Error {
  /** @param {string} reason a revocation reason, `claim_lost`, or `surface_unavailable` (may pass later) */
  constructor(reason) {
    super(`grant stopped: ${reason}`);
    this.reason = reason;
  }
}

/**
 * Make what delegated invitation `id` grants `username` and has not made
 * yet — the role, the site grant, the rendering — each behind a
 * precondition checked inside the users lock just before it is made: the
 * claim still `claimId`'s and not marked for revocation (an acceptance), and
 * nothing but the inviter's standing standing in the way. `repair`: never
 * replace a role grant, and never ask for a site grant twice when the first
 * answer was lost.
 *
 * @param {string} id
 * @param {{ username: string, claimId?: string | null, repair?: boolean, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ complete: boolean, stopped: string | null }>}
 */
async function completeGrants(id, { username, claimId = null, repair = false, logger }) {
  const actor = `invitation:${id}`;
  const precondition = async () => {
    if (claimId !== null) {
      const state = await claimState(id, claimId);
      if (!state.held) throw new GrantStopped('claim_lost');
      if (state.revokePendingReason) throw new GrantStopped(state.revokePendingReason);
    }
    const current = await getInvitation(id);
    if (!current) throw new GrantStopped('claim_lost');
    const reason = await whyNotAcceptable(current);
    if (reason !== null && !INVITER_REASONS.has(reason)) throw new GrantStopped(reason);
  };

  let invitation = await getInvitation(id);
  try {
    const plugin = await findPlugin(invitation.plugin);
    if (!plugin) throw new GrantStopped('plugin_removed');
    if (invitation.roleGrantedAt === null) {
      await setEntitlement(
        plugin,
        { principalType: 'user', principalId: username, roles: [invitation.role] },
        { actor, logger, precondition, onlyIfNone: repair },
      );
      await recordCompletion(id, 'role_granted_at');
    }
    invitation = await getInvitation(id);
    if (invitation.siteGrantedAt === null) {
      await withUsernamesForGrants([username], { actor, logger, requireUser: true }, async () => {
        await precondition();
        const existing = await listResourceGrants('site', invitation.siteId);
        if (!existing.ok) throw new GrantStopped('surface_unavailable');
        const held = existing.grants.some(
          (g) => g.principalType === 'user' && g.principalId === username,
        );
        if (!held) {
          // A first attempt whose answer was lost may have been revoked
          // since by an administrator: never made again blindly.
          if (repair && invitation.siteAttemptedAt !== null) {
            throw new GrantStopped('repair_abandoned');
          }
          await recordCompletion(id, 'site_attempted_at');
          const created = await createGatekeeperGrant({
            principalType: 'user',
            principalId: username,
            resourceType: 'site',
            resourceId: invitation.siteId,
            context: {},
          });
          if (!created.ok) throw new GrantStopped('surface_unavailable');
        }
      });
      await recordCompletion(id, 'site_granted_at');
    }
    invitation = await getInvitation(id);
    if (invitation.renderedAt === null) {
      // The site's host group: Authelia admits an external member only on
      // a host that names them.
      await syncDomainAccess({ logger });
      await recordCompletion(id, 'rendered_at');
    }
    return { complete: true, stopped: null };
  } catch (err) {
    if (err instanceof GrantStopped) {
      return { complete: false, stopped: err.reason === 'surface_unavailable' ? null : err.reason };
    }
    logger?.warn(
      { err: err.message, invitationId: id },
      'An invitation’s grants are not complete yet',
    );
    return { complete: false, stopped: null };
  }
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

/** TOTP for a user that exists: the URI and its QR code, or nulls (non-fatal). */
async function setUpTotp(username, logger) {
  try {
    const { secret, uri } = generateTotpSecret(username);
    await writeTotpToDatabase(username, secret);
    return { totpUri: uri, totpQr: totpQrDataUri(uri) };
  } catch (err) {
    logger?.error({ err: err.message }, 'Failed to set up TOTP for an invited user');
    return { totpUri: null, totpQr: null };
  }
}

/** Whether users.yml holds `username` (false when it cannot be read). */
async function usersFileHolds(username) {
  try {
    const raw = await readUsersRaw();
    return isRecord(raw?.users) && Object.hasOwn(raw.users, username);
  } catch {
    return false;
  }
}

/**
 * `POST /api/invite/accept` — either kind. Answers `{ ok, username,
 * loginUrl, totpUri, totpQr, accessPending }`.
 *
 * @param {unknown} input
 * @param {{ host?: string, logger?: import('pino').Logger }} opts
 */
export async function acceptInvitation(input, { host, logger }) {
  const invitation = await openedInvitation(input, host);
  const schema =
    invitation.kind === 'delegated' ? DelegatedAcceptanceSchema : AdminAcceptanceSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const field = refusedField(parsed.error);
    throw httpError(field ? `Invalid ${field}` : 'Invalid request', 400, {
      code: 'invalid_request',
      ...(field ? { field } : {}),
    });
  }
  assertOpen(invitation);
  return invitation.kind === 'delegated'
    ? acceptDelegated(invitation, parsed.data, { logger })
    : acceptAdmin(invitation, parsed.data, { logger });
}

/**
 * The claim, the user and what follows — shared by both kinds: `vet`
 * (inside the users lock, before anything is prepared) then `create`;
 * returns the claim id and the user the directory made, or null when its
 * directory step did not land (recovery settles the claim).
 */
async function createInvitedUser(invitation, { username, claimId, vet, create, logger }) {
  const memberships = Array.isArray(invitation.domains)
    ? { [username]: await invitationDomainsNow(invitation) }
    : {};
  let outcome;
  try {
    outcome = await changeUsers(
      async () => {
        let current = { users: {} };
        try {
          current = await readUsersRaw();
        } catch (err) {
          if (err.code !== 'ENOENT') {
            throw httpError('Failed to read user database', 500, { cause: usersFileError(err) });
          }
        }
        if (current.users[username]) throw usernameUnavailableError();
        await create();
      },
      {
        actor: 'invitation',
        logger,
        creates: [username],
        invitationId: invitation.id,
        vetCreates: async (name) => {
          const state = await claimState(invitation.id, claimId);
          if (!state.held || state.revokePendingReason) {
            throw httpError('This invitation can no longer be accepted', 410);
          }
          await vet(name);
        },
        domains: memberships,
      },
    );
  } catch (err) {
    await releaseClaim(invitation.id, invitation.plugin, claimId);
    if (err.code === 'username_unavailable' || err.code === 'username_has_oidc_identity') {
      await recordFailedAttempt(invitation.id, invitation.plugin);
      throw usernameUnavailableError();
    }
    throw err;
  }
  if (!outcome.persisted || outcome.warnings.some((w) => w.step === 'directory')) {
    logger?.warn(
      { invitationId: invitation.id },
      'An acceptance’s user is not in the directory yet',
    );
  }
  return directoryUserOfInvitation(invitation.id);
}

async function acceptAdmin(invitation, { password }, { logger }) {
  const username = invitation.username;
  if (await usersFileHolds(username)) throw httpError('This username already exists', 409);
  const claimId = await claimInvitation(invitation.id, null, username);
  let hashed;
  try {
    hashed = await hashPassword(password);
  } catch (err) {
    await releaseClaim(invitation.id, null, claimId);
    logger?.error({ err: err.message }, 'Failed to hash password');
    throw httpError('Failed to process password', 500);
  }
  const user = await createInvitedUser(invitation, {
    username,
    claimId,
    vet: async () => {},
    create: () => createUserFromInvitation(username, invitation.email, invitation.groups, hashed),
    logger,
  });
  const totp = (await usersFileHolds(username)) ? await setUpTotp(username, logger) : {};
  if (user) {
    await finishClaim(invitation.id, null, claimId, user.userId);
    await recordAuditBestEffort(
      {
        actor: 'invitation',
        action: 'invitation.accepted',
        details: { invitationId: invitation.id, kind: 'admin', userId: user.userId },
      },
      logger,
    );
  }
  const loginDomain = await invitationSignInDomain(invitation);
  return {
    ok: true,
    username,
    loginUrl: loginDomain ? `https://auth.${loginDomain}/` : null,
    totpUri: null,
    totpQr: null,
    ...totp,
    accessPending: !user,
  };
}

async function acceptDelegated(invitation, { username, displayName, password }, { logger }) {
  if (await usernameNamedLocally(username, invitation.id)) {
    await recordFailedAttempt(invitation.id, invitation.plugin);
    throw usernameUnavailableError();
  }
  await assertGrantReserve();
  const claimId = await claimInvitation(invitation.id, invitation.plugin, username, {
    check: async () => {
      const current = await getInvitation(invitation.id);
      const reason = current ? await whyNotAcceptable(current) : 'plugin_removed';
      return reason === 'surface_unavailable' ? 'unavailable' : reason;
    },
  }).catch(async (err) => {
    if (err.code === 'username_unavailable') {
      await recordFailedAttempt(invitation.id, invitation.plugin);
    }
    throw err;
  });

  let hashed;
  try {
    hashed = await hashPassword(password);
  } catch (err) {
    await releaseClaim(invitation.id, invitation.plugin, claimId);
    logger?.error({ err: err.message }, 'Failed to hash password');
    throw httpError('Failed to process password', 500);
  }
  const user = await createInvitedUser(invitation, {
    username,
    claimId,
    vet: (name) => vetInviteeUsername(name, invitation.id),
    create: () => createUserFromInvitation(username, invitation.email, [], hashed, displayName),
    logger,
  });
  const totp = (await usersFileHolds(username)) ? await setUpTotp(username, logger) : {};
  const plugin = await findPlugin(invitation.plugin);
  const surface = plugin ? await invitationSurface(plugin) : { ok: false };
  const loginUrl = surface.ok
    ? `https://${surface.site.fqdn}/`
    : `https://auth.${invitation.domains[0].name}/`;
  if (!user) {
    // The claim stays: recovery finds the user once the directory holds it.
    return {
      ok: true,
      username,
      loginUrl,
      totpUri: null,
      totpQr: null,
      ...totp,
      accessPending: true,
    };
  }

  const grants = await completeGrants(invitation.id, { username, claimId, logger });
  const recorded = await finishClaim(invitation.id, invitation.plugin, claimId, user.userId, {
    revokeReason: grants.stopped === 'claim_lost' ? null : grants.stopped,
  });
  await recordDelegatedAcceptance(recorded ?? invitation, user.userId, { logger });
  return {
    ok: true,
    username,
    loginUrl,
    totpUri: null,
    totpQr: null,
    ...totp,
    accessPending: !grants.complete,
  };
}

/** Audit and notify a delegated acceptance as it was recorded (accepted, or revoked with a reason). */
async function recordDelegatedAcceptance(invitation, userId, { logger, recovered = false }) {
  const accepted = invitation.status === 'accepted';
  await recordAuditBestEffort(
    {
      actor: 'invitation',
      action: accepted ? 'invitation.accepted' : 'invitation.revoked',
      plugin: invitation.plugin,
      details: {
        invitationId: invitation.id,
        kind: 'delegated',
        userId,
        inviterUserId: invitation.inviterUserId,
        role: invitation.role,
        ...(accepted ? {} : { reason: invitation.revokedReason }),
        ...(recovered ? { recovered: true } : {}),
      },
    },
    logger,
  );
  await notifyAdminsBestEffort(
    {
      source: `invitation:${invitation.plugin}`,
      level: accepted ? 'info' : 'warning',
      message: accepted
        ? `Someone joined plugin "${invitation.plugin}" by invitation, as ${invitation.role} (user ${userId}).`
        : `An invitation into plugin "${invitation.plugin}" made an account (user ${userId}) but was revoked while it was accepted (${invitation.revokedReason}): it reaches nothing — keep or delete it.`,
    },
    logger,
  );
}

// ---------------------------------------------------------------------------
// Recovery and repair (the identity tick)
// ---------------------------------------------------------------------------

/**
 * Settle every claim older than the stale limit by what exists, under the
 * users lock after a reconcile: a directory row stamped with the invitation
 * → it is accepted (the repair completes its grants); otherwise it is
 * pending again. An acceptance still queued finds its claim gone and stops.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function resolveStaleClaims({ logger } = {}) {
  for (const claim of await staleClaims()) {
    try {
      const settled = await withReconciledDirectory(
        async () => {
          const user = await directoryUserOfInvitation(claim.id);
          return settleStaleClaim(claim.id, claim.plugin, claim.claimId, user?.userId ?? null);
        },
        { logger },
      );
      if (settled?.acceptedUserId) {
        if (settled.kind === 'delegated') {
          await recordDelegatedAcceptance(settled, settled.acceptedUserId, {
            logger,
            recovered: true,
          });
        } else {
          await recordAuditBestEffort(
            {
              actor: 'invitation',
              action: 'invitation.accepted',
              details: {
                invitationId: claim.id,
                kind: 'admin',
                userId: settled.acceptedUserId,
                recovered: true,
              },
            },
            logger,
          );
        }
      }
    } catch (err) {
      logger?.warn(
        { err: err.message, invitationId: claim.id },
        'A stale invitation claim was not settled',
      );
    }
  }
}

/** Whether anyone but the invitation changed `userId`'s entitlement on `plugin` since `since`. */
async function entitlementChangedByOthers(plugin, userId, since, invitationId) {
  for (const action of ['plugin.entitlement.set', 'plugin.entitlement.removed']) {
    const entries = await listAudit({ plugin, action, limit: 200 });
    if (
      entries.some(
        (e) =>
          e.at >= since && e.details?.userId === userId && e.actor !== `invitation:${invitationId}`,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Complete the grants of accepted delegated invitations, for
 * {@link INVITATION_REPAIR_WINDOW_MS} after their acceptance, only while
 * their user is active, nothing but the inviter's standing stands in the
 * way, and no one else changed the user's entitlement since — and only by
 * creating what is missing. Otherwise the repair stops (`repair_abandoned`,
 * admins notified).
 *
 * @param {{ logger?: import('pino').Logger, now?: number }} [opts]
 */
export async function repairAcceptances({ logger, now = Date.now() } = {}) {
  for (const invitation of await unfulfilledAcceptances()) {
    try {
      const user = await getDirectoryUser(invitation.acceptedUserId);
      const expired = Date.parse(invitation.statusAt) + INVITATION_REPAIR_WINDOW_MS < now;
      let stopped =
        expired || !user || user.status !== 'active' || !user.username ? 'repair_abandoned' : null;
      if (
        !stopped &&
        (await entitlementChangedByOthers(
          invitation.plugin,
          user.userId,
          invitation.statusAt,
          invitation.id,
        ))
      ) {
        stopped = 'repair_abandoned';
      }
      if (!stopped) {
        const result = await completeGrants(invitation.id, {
          username: user.username,
          repair: true,
          logger,
        });
        if (result.complete) continue;
        stopped = result.stopped;
      }
      if (stopped) {
        await abandonRepair(invitation.id, invitation.plugin);
        await recordAuditBestEffort(
          {
            actor: 'lamaste',
            action: 'invitation.revoked',
            plugin: invitation.plugin,
            details: { invitationId: invitation.id, kind: 'delegated', reason: 'repair_abandoned' },
          },
          logger,
        );
        await notifyAdminsBestEffort(
          {
            source: `invitation:${invitation.plugin}`,
            level: 'warning',
            message: `An invitation into plugin "${invitation.plugin}" was accepted (user ${invitation.acceptedUserId}) but its access could not be completed — grant it by hand if it is still wanted.`,
          },
          logger,
        );
      }
    } catch (err) {
      logger?.warn(
        { err: err.message, invitationId: invitation.id },
        'Repairing an acceptance failed',
      );
    }
  }
}

/**
 * The invitations' part of the identity tick: import a restored
 * invitations.json, settle stale claims, repair acceptances, prune ended
 * invitations.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function invitationsTick({ logger } = {}) {
  try {
    await importLegacyInvitations({ logger });
  } catch (err) {
    logger?.error({ err: err.message }, 'Importing invitations.json failed');
  }
  for (const step of [resolveStaleClaims, repairAcceptances]) {
    try {
      await step({ logger });
    } catch (err) {
      logger?.error({ err: err.message }, 'Invitation upkeep failed');
    }
  }
  try {
    await pruneEndedInvitations();
  } catch (err) {
    logger?.warn({ err: err.message }, 'Pruning ended invitations failed');
  }
}
