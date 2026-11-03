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
 * A revocation that lands during an acceptance ends the invitation
 * `revoked` however the acceptance goes. Before the account exists no
 * account is made; after, it cannot be unmade by withholding, so the account
 * is disabled through the usual offboarding and the administrators are told.
 *
 * A delegated token is answered only by `auth.<its domain>` — the `Host`
 * every auth vhost writes as a literal; the panel and IP vhosts write one no
 * invitation names (never `request.host`, which follows a client's
 * `X-Forwarded-Host` behind the trusted loopback hop).
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
import { entitlementChangedByOthers, recordAuditBestEffort } from './audit.js';
import {
  autheliaHoldsOidcIdentity,
  createUserFromInvitation,
  generateTotpSecret,
  hashPassword,
  readUsersRaw,
  writeTotpToDatabase,
  writeUsers,
} from './authelia.js';
import {
  assertGrantReserve,
  invitationSurface,
  inviterHoldsSite,
  whyNotAcceptable,
} from './delegated-invitations.js';
import {
  changeUsers,
  directoryUserOfInvitation,
  findDirectoryUser,
  getDirectoryUser,
  usersFileError,
  withReconciledDirectory,
  withUsernamesForGrants,
} from './directory.js';
import { invitationDomainsNow, invitationSignInDomain, syncDomainAccess } from './domains.js';
import { grantRoles, setEntitlement } from './entitlements.js';
import {
  createGatekeeperGrant,
  inspectUserPrincipal,
  listPluginGrants,
  listResourceGrants,
} from './gatekeeper-client.js';
import {
  abandonRepair,
  claimInvitation,
  claimState,
  clearSiteAttempt,
  findInvitationByToken,
  finishClaim,
  getInvitation,
  importLegacyInvitations,
  invitationClosedError,
  pruneEndedInvitations,
  recordCompletion,
  recordFailedAttempt,
  releaseClaim,
  reservedInvitationUsernames,
  revokedAccountsToDisable,
  settleStaleClaim,
  staleClaims,
  unfulfilledAcceptances,
  usernameUnavailableError,
} from './invitations.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { findPlugin } from './plugins.js';
import { readSites } from './state.js';
import { listGrantsForUser } from './user-access.js';

/**
 * An inviter's standing counts until their invitation is accepted — at the
 * claim, in a sweep (which marks one being accepted) and before each grant.
 * Once accepted it counts no more: the repair of an accepted invitation
 * ignores these, as an invitee keeps what a departed inviter gave (D1).
 */
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

/** 404 `invitation_not_found`: no invitation, or not one this host may answer for — one answer. */
function invitationNotFoundError() {
  return httpError('Invitation not found', 404, { code: 'invitation_not_found' });
}

/** The invitation a body's token opens, or 404 — a delegated one only on its own sign-in host. */
async function openedInvitation(input, host) {
  const invitation = isRecord(input) ? await findInvitationByToken(input.token) : null;
  if (!invitation) throw invitationNotFoundError();
  if (invitation.kind === 'delegated' && !hostServesInvitation(host, invitation)) {
    throw invitationNotFoundError();
  }
  return invitation;
}

/** 410 for an invitation that cannot be accepted any more, 409 while it is being accepted. */
function assertOpen(invitation) {
  if (invitation.shownStatus === 'accepted') {
    throw httpError('This invitation has already been used', 410, { code: 'invitation_used' });
  }
  if (invitation.shownStatus === 'expired') {
    throw httpError('This invitation has expired', 410, { code: 'invitation_expired' });
  }
  if (invitation.shownStatus === 'revoked') {
    throw httpError('This invitation is no longer valid', 410, { code: 'invitation_closed' });
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
 * claim still `claimId`'s and not marked for revocation (an acceptance), the
 * username still user `userId`'s (a name deleted and taken again is someone
 * else), and nothing standing in the way. `repair`: never replace a role
 * grant, never ask for a site grant twice when the first answer was lost,
 * and the inviter's standing no longer counts.
 *
 * @param {string} id
 * @param {{ username: string, userId: string, claimId?: string | null, repair?: boolean, logger?: import('pino').Logger }} opts
 * @returns {Promise<{ complete: boolean, stopped: string | null }>}
 */
export async function completeGrants(
  id,
  { username, userId, claimId = null, repair = false, logger },
) {
  const actor = `invitation:${id}`;
  const precondition = async () => {
    if (claimId !== null) {
      const state = await claimState(id, claimId);
      if (!state.held) throw new GrantStopped('claim_lost');
      if (state.revokePendingReason) throw new GrantStopped(state.revokePendingReason);
    }
    const current = await getInvitation(id);
    if (!current) throw new GrantStopped('claim_lost');
    if ((await findDirectoryUser(username))?.userId !== userId) {
      throw new GrantStopped('repair_abandoned');
    }
    const reason = await whyNotAcceptable(current);
    if (reason === null || (repair && INVITER_REASONS.has(reason))) return;
    throw new GrantStopped(reason);
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
          if (!created.ok) {
            // Refused, or never reached: nothing was made, the repair may ask again.
            if (!created.outcomeUnknown) await clearSiteAttempt(id);
            throw new GrantStopped('surface_unavailable');
          }
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

/**
 * TOTP for a user that exists: the URI and its QR code, or nulls (non-fatal:
 * the administrators are told to reset it). The error of a failed write
 * names the command line, and with it the username: it is never logged.
 */
async function setUpTotp(invitationId, username, logger) {
  try {
    const { secret, uri } = generateTotpSecret(username);
    await writeTotpToDatabase(username, secret);
    const issued = { totpUri: uri, totpQr: totpQrDataUri(uri) };
    await recordCompletion(invitationId, 'totp_issued_at');
    return issued;
  } catch (err) {
    logger?.error(
      { exitCode: err.exitCode ?? null, invitationId },
      'Failed to set up TOTP for an invited user',
    );
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

/** Audit a revocation as it was recorded: its author, its reason, and the account it found. */
async function auditRevoked(invitation, logger, details = {}) {
  await recordAuditBestEffort(
    {
      actor: invitation.revokedBy ?? 'lamaste',
      action: 'invitation.revoked',
      plugin: invitation.plugin,
      details: {
        invitationId: invitation.id,
        kind: invitation.kind,
        reason: invitation.revokedReason,
        ...details,
      },
    },
    logger,
  );
}

/** Give a claim up; a revocation that landed meanwhile ends the invitation (and is audited). */
async function giveClaimUp(invitation, claimId, logger) {
  const released = await releaseClaim(invitation.id, invitation.plugin, claimId);
  if (released?.status === 'revoked') await auditRevoked(released, logger);
}

/** Count a refused acceptance; the fifth locks the link, and that is audited. */
async function countFailedAttempt(invitation, logger) {
  const { locked } = await recordFailedAttempt(invitation.id, invitation.plugin);
  if (locked) {
    await auditRevoked(
      { ...invitation, revokedBy: 'lamaste', revokedReason: 'attempts_exhausted' },
      logger,
    );
  }
}

/**
 * Disable the account a revoked invitation had made, through the usual
 * offboarding (an administrator's invitation with `admins` included): it
 * was revoked, so it reaches nothing. Answers whether that is so; retried on
 * the tick until it is. An administrator may delete it, or enable it.
 *
 * @returns {Promise<boolean>}
 */
export async function disableRevokedAccount(invitation, { logger } = {}) {
  const user = await getDirectoryUser(invitation.acceptedUserId);
  if (user?.status === 'active' && user.username) {
    const { username, userId } = user;
    try {
      const outcome = await changeUsers(
        async () => {
          const usersData = await readUsersRaw();
          const entry = usersData.users?.[username];
          if (!entry || entry.disabled === true) return;
          entry.disabled = true;
          await writeUsers(usersData);
        },
        {
          actor: `invitation:${invitation.id}`,
          logger,
          expect: (users) => !users[username] || users[username].disabled === true,
        },
      );
      if (!outcome.persisted) return false;
    } catch (err) {
      logger?.error(
        { err: err.message, invitationId: invitation.id },
        'A revoked invitation’s account is not disabled yet',
      );
      return false;
    }
    await recordAuditBestEffort(
      {
        actor: 'lamaste',
        action: 'invitation.account.disabled',
        plugin: invitation.plugin,
        details: { invitationId: invitation.id, kind: invitation.kind, userId },
      },
      logger,
    );
  }
  await recordCompletion(invitation.id, 'account_disabled_at');
  return true;
}

/**
 * What follows a claim ending with a user, from the row as recorded: one
 * audit entry, and what the administrators need to know. A revoked one has
 * its account disabled. A user without a TOTP secret (a failed write, a
 * recovered acceptance) cannot sign in until an administrator resets it.
 */
async function settleFinished(recorded, { logger, recovered = false }) {
  const userId = recorded.acceptedUserId;
  const where = recorded.plugin ? `plugin "${recorded.plugin}"` : 'the relay';
  const source = recorded.plugin ? `invitation:${recorded.plugin}` : 'invitation';
  const also = recovered ? { recovered: true } : {};
  if (recorded.status === 'revoked') {
    const disabled = await disableRevokedAccount(recorded, { logger });
    await auditRevoked(recorded, logger, { userId, accountDisabled: disabled, ...also });
    await notifyAdminsBestEffort(
      {
        source,
        level: 'warning',
        message: `An invitation into ${where} was revoked while it was being accepted (${recorded.revokedReason}), after its account was made (user ${userId}). The account ${disabled ? 'was disabled' : 'is being disabled — retried every minute'}; delete it, or enable it if it is wanted after all.`,
      },
      logger,
    );
    return;
  }
  await recordAuditBestEffort(
    {
      actor: 'invitation',
      action: 'invitation.accepted',
      plugin: recorded.plugin,
      details: {
        invitationId: recorded.id,
        kind: recorded.kind,
        userId,
        ...(recorded.kind === 'delegated'
          ? { inviterUserId: recorded.inviterUserId, role: recorded.role }
          : {}),
        ...also,
      },
    },
    logger,
  );
  if (recorded.kind === 'delegated') {
    await notifyAdminsBestEffort(
      {
        source,
        level: 'info',
        message: `Someone joined plugin "${recorded.plugin}" by invitation, as ${recorded.role} (user ${userId}).`,
      },
      logger,
    );
  }
  if (recorded.totpIssuedAt === null) {
    await notifyAdminsBestEffort(
      {
        source,
        level: 'warning',
        message: `User ${userId}, who accepted an invitation into ${where}, has no two-factor secret: reset their TOTP on Users, or they cannot sign in.`,
      },
      logger,
    );
  }
}

/** 410 for a claim that ended revoked — there is no account to hand over. */
function assertNotRevoked(finished) {
  if (finished?.status === 'revoked') {
    throw httpError('This invitation was revoked while it was being accepted', 410, {
      code: 'invitation_revoked',
    });
  }
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
            throw invitationClosedError();
          }
          await vet(name);
        },
        domains: memberships,
      },
    );
  } catch (err) {
    await giveClaimUp(invitation, claimId, logger);
    if (err.code === 'username_unavailable' || err.code === 'username_has_oidc_identity') {
      await countFailedAttempt(invitation, logger);
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
  if (await usersFileHolds(username)) {
    throw httpError('This username already exists', 409, { code: 'username_unavailable' });
  }
  const claimId = await claimInvitation(invitation.id, null, username);
  let hashed;
  try {
    hashed = await hashPassword(password);
  } catch (err) {
    await giveClaimUp(invitation, claimId, logger);
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
  const totp = (await usersFileHolds(username))
    ? await setUpTotp(invitation.id, username, logger)
    : {};
  if (user) {
    const recorded = await finishClaim(invitation.id, null, claimId, user.userId);
    if (recorded) await settleFinished(recorded, { logger });
    assertNotRevoked(recorded ?? (await getInvitation(invitation.id)));
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
    await countFailedAttempt(invitation, logger);
    throw usernameUnavailableError();
  }
  await assertGrantReserve();
  // Gatekeeper's answer, before the lock: an inviter who lost the site's
  // grant has lost the plugin, whatever role is left on their name.
  const inviterHoldsGrant = await inviterHoldsSite(invitation);
  const claimId = await claimInvitation(invitation.id, invitation.plugin, username, {
    check: async () => {
      const current = await getInvitation(invitation.id);
      const reason = current ? await whyNotAcceptable(current) : 'plugin_removed';
      if (reason === 'surface_unavailable') return 'unavailable';
      return reason ?? (inviterHoldsGrant ? null : 'inviter_unentitled');
    },
  }).catch(async (err) => {
    if (err.code === 'username_unavailable') await countFailedAttempt(invitation, logger);
    if (err.revokedReason) {
      await auditRevoked(
        { ...invitation, revokedBy: 'lamaste', revokedReason: err.revokedReason },
        logger,
      );
    }
    throw err;
  });

  let hashed;
  try {
    hashed = await hashPassword(password);
  } catch (err) {
    await giveClaimUp(invitation, claimId, logger);
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
  const totp = (await usersFileHolds(username))
    ? await setUpTotp(invitation.id, username, logger)
    : {};
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

  const grants = await completeGrants(invitation.id, {
    username,
    userId: user.userId,
    claimId,
    logger,
  });
  const recorded = await finishClaim(invitation.id, invitation.plugin, claimId, user.userId, {
    revokeReason: grants.stopped === 'claim_lost' ? null : grants.stopped,
  });
  // Null: recovery took the claim, and settled it.
  if (recorded) await settleFinished(recorded, { logger });
  assertNotRevoked(recorded ?? (await getInvitation(invitation.id)));
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

// ---------------------------------------------------------------------------
// Recovery and repair (the identity tick)
// ---------------------------------------------------------------------------

/**
 * Settle every claim older than the stale limit by what exists, under the
 * users lock after a reconcile: a directory row stamped with the invitation
 * → it is accepted (the repair completes its grants) or, marked, revoked
 * with its account disabled; otherwise it is pending again, or revoked when
 * marked. An acceptance still queued finds its claim gone and stops.
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
      if (settled?.acceptedUserId) await settleFinished(settled, { logger, recovered: true });
      else if (settled?.status === 'revoked') await auditRevoked(settled, logger);
    } catch (err) {
      logger?.warn(
        { err: err.message, invitationId: claim.id },
        'A stale invitation claim was not settled',
      );
    }
  }
}

/**
 * Whether what the acceptance made still stands: the role grant it recorded
 * and the site grant it recorded, read from Gatekeeper — a site grant changes
 * by no audited route — and no entitlement change by anyone else in the
 * audit. Null when Gatekeeper cannot say: the repair waits for the next tick.
 */
async function grantsStandAsMade(invitation, user) {
  const changed = await entitlementChangedByOthers({
    plugin: invitation.plugin,
    userId: user.userId,
    since: invitation.roleGrantedAt ?? invitation.statusAt,
    actor: `invitation:${invitation.id}`,
  });
  if (changed) return false;
  const own = (g) => g.principalType === 'user' && g.principalId === user.username;
  if (invitation.roleGrantedAt !== null) {
    const plugin = await findPlugin(invitation.plugin);
    if (!plugin) return false;
    const grants = await listPluginGrants(plugin.route);
    if (!grants.ok) return null;
    const roles = grants.grants.filter(own).map(grantRoles);
    if (!roles.some((r) => r?.length === 1 && r[0] === invitation.role)) return false;
  }
  if (invitation.siteGrantedAt !== null) {
    const grants = await listResourceGrants('site', invitation.siteId);
    if (!grants.ok) return null;
    if (!grants.grants.some(own)) return false;
  }
  return true;
}

/**
 * Complete the grants of accepted delegated invitations, for
 * {@link INVITATION_REPAIR_WINDOW_MS} after their acceptance, only while
 * their user is active, nothing but the inviter's standing stands in the
 * way, and what it already made stands as it made it — and only by creating
 * what is missing. Otherwise the repair stops (`repair_abandoned`, admins
 * notified).
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
      if (!stopped) {
        const standing = await grantsStandAsMade(invitation, user);
        if (standing === null) continue;
        if (!standing) stopped = 'repair_abandoned';
      }
      if (!stopped) {
        const result = await completeGrants(invitation.id, {
          username: user.username,
          userId: user.userId,
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
 * Disable the accounts of revoked invitations that are not disabled yet: a
 * failed write, or a crash between recording the revocation and disabling.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function disableRevokedAccounts({ logger } = {}) {
  for (const invitation of await revokedAccountsToDisable()) {
    await disableRevokedAccount(invitation, { logger });
  }
}

/**
 * The invitations' part of the identity tick, which also runs at start:
 * import invitations.json (once), settle stale claims, disable the accounts
 * of revoked invitations, repair acceptances, prune ended invitations.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function invitationsTick({ logger } = {}) {
  try {
    await importLegacyInvitations({ logger });
  } catch (err) {
    logger?.error({ err: err.message }, 'Importing invitations.json failed');
  }
  for (const step of [resolveStaleClaims, disableRevokedAccounts, repairAcceptances]) {
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
