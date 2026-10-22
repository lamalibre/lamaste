/**
 * Users and identity in requests (slice 6), in words — for the Users page,
 * a plugin's People panel, its Lifecycle hooks and the Tunnels page. Pure:
 * nothing here reads the clock or calls the panel.
 */

/** The reason an update waits because it adds or removes roles, or widens the attributes. */
export const IDENTITY_CHANGED = 'identity.changed';

/** The Authelia group whose enabled members administer Lamaste. */
const ADMIN_GROUP = 'admins';

/** What a plugin may declare to receive about its users, in words. */
const ATTRIBUTE_LABEL = {
  displayName: 'display name',
  email: 'email address',
};

/** An attribute's name in words (`displayName` → display name). */
export function attributeLabel(attribute) {
  return ATTRIBUTE_LABEL[attribute] ?? String(attribute);
}

/** `0f6c2a2e…` — enough of an id to tell users apart by eye; the full id on hover and to copy. */
export function shortId(id) {
  return typeof id === 'string' && id.length > 8 ? `${id.slice(0, 8)}…` : (id ?? '');
}

/**
 * A warning a users or entitlement change came back with — a sentence, or
 * `{ step, message }` — as one line.
 *
 * @param {unknown} warning
 * @returns {string}
 */
export function warningText(warning) {
  if (typeof warning === 'string') return warning;
  if (warning && typeof warning === 'object' && typeof warning.message === 'string') {
    return warning.step ? `${warning.step}: ${warning.message}` : warning.message;
  }
  return String(warning);
}

/**
 * Whether `user` is the last enabled administrator among `users` (as
 * `GET /api/users` lists them) — the panel refuses to disable them.
 *
 * @param {{ username: string, groups?: string[], disabled?: boolean }} user
 * @param {Array<{ groups?: string[], disabled?: boolean }>} users
 */
export function isLastEnabledAdmin(user, users) {
  const enabledAdmin = (u) =>
    Array.isArray(u?.groups) && u.groups.includes(ADMIN_GROUP) && u.disabled !== true;
  if (!enabledAdmin(user)) return false;
  return users.filter(enabledAdmin).length <= 1;
}

/**
 * Why users cannot reach a plugin's `/app`, in words — or, when they can,
 * that they can. `readiness` is the identity view's.
 *
 * @param {{ ready: boolean, reason: string | null, version: string | null, readyVersion: string | null } | null | undefined} readiness
 * @returns {{ ready: boolean, text: string }}
 */
export function readinessText(readiness) {
  if (!readiness) return { ready: false, text: 'Unknown' };
  if (readiness.ready) return { ready: true, text: 'Users reach its application' };
  const version = readiness.version ? `version ${readiness.version}` : 'the installed version';
  switch (readiness.reason) {
    case 'not_installed':
      return { ready: false, text: 'The plugin is not installed' };
    case 'no_identity':
      return { ready: false, text: `${capitalize(version)} declares no identity` };
    case 'not_approved':
      return {
        ready: false,
        text: `${capitalize(version)} waits for approval — approve it under Lifecycle hooks`,
      };
    case 'not_hosted':
      return {
        ready: false,
        text: 'The plugin is not hosted on an agent, or its hosting is not active yet',
      };
    case 'not_answered':
      return {
        ready: false,
        text: `Its agent half has not answered the identity feed for ${version} yet — it is sent its users first`,
      };
    default:
      return { ready: false, text: readiness.reason ? String(readiness.reason) : 'Not ready' };
  }
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Why a route bound to a tunnel is not served there (`userSurfaceStatus`'s
 * reason), in words.
 *
 * @param {string | null} reason
 */
export function userSurfaceReasonText(reason) {
  switch (reason) {
    case null:
    case undefined:
      return 'served — users reach its application here';
    case 'not_installed':
      return 'no installed plugin holds this route';
    case 'no_identity':
      return 'its installed version declares no identity — requests go down the tunnel until one does';
    case 'not_approved':
      return 'its installed version waits for approval — requests go down the tunnel until then';
    default:
      return String(reason);
  }
}

/**
 * Whether a tunnel's host can serve a plugin's user surface, and why not:
 * an enabled app tunnel an agent carries, `authenticated` or `restricted`
 * (the panel's rule; it refuses the rest).
 *
 * @param {{ exposure?: string, subdomain?: string | null, type?: string, enabled?: boolean, agentLabel?: string | null, accessMode?: string }} tunnel
 * @returns {{ eligible: boolean, reason: string | null }}
 */
export function userSurfaceEligibility(tunnel) {
  if (tunnel.exposure === 'internal' || !tunnel.subdomain || (tunnel.type ?? 'app') !== 'app') {
    return { eligible: false, reason: "Only an app tunnel's host serves a plugin's user surface" };
  }
  if (tunnel.enabled === false) {
    return { eligible: false, reason: 'Enable the tunnel first' };
  }
  if (!tunnel.agentLabel) {
    return { eligible: false, reason: 'Assign the tunnel to an agent first' };
  }
  if ((tunnel.accessMode ?? 'restricted') === 'public') {
    return {
      eligible: false,
      reason:
        'A public tunnel has no signed-in user to vouch for — make it authenticated or restricted first',
    };
  }
  return { eligible: true, reason: null };
}

/** The routes a tunnel is bound to as a user surface. */
export function boundRoutes(tunnel) {
  return Array.isArray(tunnel?.userSurface?.routes) ? tunnel.userSurface.routes : [];
}

/** How `route`, bound to `tunnel`, is served (its `userSurfaceStatus` entry), or null. */
export function userSurfaceStatusOf(tunnel, route) {
  return (tunnel?.userSurfaceStatus ?? []).find((s) => s.route === route) ?? null;
}

/**
 * An audience row in the terms the People panel shows: who, the roles
 * held, and where they stand — `active` or `disabled` (a member), `removed`
 * (deleted from the directory, or no longer entitled; the last known name
 * kept) or `erased` (nothing but the id).
 *
 * @param {{ userId: string, seq: number, version: number, updatedAt: string, change: object | null }} row
 */
export function audienceRowView(row) {
  const change = row.change;
  const who = (user) => ({
    username: user?.username ?? null,
    displayName: user?.displayName ?? null,
    email: user?.email ?? null,
  });
  // A row the panel cannot read: nobody, `unknown`.
  const view = {
    userId: row.userId,
    seq: row.seq,
    version: row.version,
    updatedAt: row.updatedAt,
    member: false,
    ...who(null),
    roles: [],
    status: 'unknown',
    reason: null,
  };
  if (change?.kind === 'upsert' && change.member) {
    const member = change.member;
    return {
      ...view,
      member: true,
      ...who(member),
      roles: Array.isArray(member.roles) ? member.roles : [],
      status: member.status === 'disabled' ? 'disabled' : 'active',
    };
  }
  if (change?.kind === 'remove') {
    return {
      ...view,
      ...who(change.last),
      status: change.reason === 'erased' ? 'erased' : 'removed',
      reason: change.reason ?? null,
    };
  }
  return view;
}

/** Why a user left an audience, in words. */
export function removeReasonText(reason) {
  switch (reason) {
    case 'deleted':
      return 'deleted';
    case 'unentitled':
      return 'no longer entitled';
    case 'erased':
      return 'erased';
    default:
      return reason ? String(reason) : 'removed';
  }
}

/**
 * The roles `current` holds with `role` switched on or off, sorted, each
 * once — what an entitlement change sends.
 *
 * @param {string[]} current
 * @param {string} role
 * @param {boolean} on
 */
export function toggledRoles(current, role, on) {
  const roles = new Set(current);
  if (on) roles.add(role);
  else roles.delete(role);
  return [...roles].sort();
}

/**
 * What an update changes in a plugin's identity block (`pendingUpdate.
 * identity`: `{ before, after, rolesAdded, rolesRemoved, attributesAdded,
 * attributesRemoved, labelsChanged }`), as rows — roles added and removed
 * and attributes widened wait for an administrator (`approval`), narrowing
 * and label edits only change the digest. Null when it changes nothing.
 *
 * @param {object | null | undefined} diff
 * @returns {{ rows: Array<{ label: string, entries: string[], approval: boolean }>, declaredBefore: boolean, declaredAfter: boolean } | null}
 */
export function identityDiffRows(diff) {
  if (!diff || typeof diff !== 'object') return null;
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  const labelOf = (block, id) => block?.roles?.find((role) => role.id === id)?.label ?? null;
  const role = (block) => (id) => {
    const label = labelOf(block, id);
    return label ? `${id} (${label})` : id;
  };
  const rows = [
    { label: 'roles added', entries: list(diff.rolesAdded).map(role(diff.after)), approval: true },
    {
      label: 'roles removed',
      entries: list(diff.rolesRemoved).map(role(diff.before)),
      approval: true,
    },
    {
      label: 'receives more about its users',
      entries: list(diff.attributesAdded).map(attributeLabel),
      approval: true,
    },
    {
      label: 'receives less about its users',
      entries: list(diff.attributesRemoved).map(attributeLabel),
      approval: false,
    },
    {
      label: 'role labels changed',
      entries: list(diff.labelsChanged).map(role(diff.after)),
      approval: false,
    },
  ].filter((row) => row.entries.length > 0);
  const declaredBefore = diff.before != null;
  const declaredAfter = diff.after != null;
  if (rows.length === 0 && declaredBefore === declaredAfter) return null;
  return { rows, declaredBefore, declaredAfter };
}
