/**
 * Users and identity in requests at the terminal — the arguments of
 * `lamaste-server users …`, `plugins entitlements|identity-sync` and
 * `tunnels bind-user-surface|unbind-user-surface`, and the words their
 * output is made of. Pure — no output, no panel — so they are tested as
 * they are. Every string from the panel goes through `terminalText` before
 * it is printed; `--json` carries the data as it came.
 */

import {
  IDENTITY_ROLE_ID_REGEX,
  IDENTITY_ROLES_MAX,
  isIdentityUuid,
  isLamasteUsername,
} from '@lamalibre/lamaste';
import { formatMoment, terminalText } from './plugin-settings.js';

/** A Lamaste (Gatekeeper) group name — Gatekeeper's rule. */
const GROUP_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** How `plugins entitlements` is called. */
export const ENTITLEMENTS_USAGE =
  'Usage: lamaste-server plugins entitlements <name> [--user <username> | --group <group> --roles <a,b>] [--revoke --user <username> | --group <group>]';

/** The value after `flag` (at `args[index]`): `{ value }`, or `{ error }` when it has none. */
function flagValue(args, index, flag, usage) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return { error: `${flag} needs a value — ${usage}` };
  }
  return { value };
}

/**
 * The arguments of `plugins entitlements <name> …` after the subcommand:
 * the plugin and, to change something, a principal — `--user <username>`
 * or `--group <group>` — with `--roles a,b` (give exactly these roles) or
 * `--revoke` (take every role away). Without a principal it lists them.
 *
 * @param {string[]} args
 * @returns {{ ok: true, name: string, action: 'list' }
 *   | { ok: true, name: string, action: 'set', principalType: 'user' | 'group', principalId: string, roles: string[] }
 *   | { ok: true, name: string, action: 'revoke', principalType: 'user' | 'group', principalId: string }
 *   | { ok: false, error: string }}
 */
export function parseEntitlementsArgs(args) {
  const usage = ENTITLEMENTS_USAGE;
  let name = null;
  let principal = null;
  let roles = null;
  let revoke = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--user' || arg === '--group') {
      const read = flagValue(args, i, arg, usage);
      if (read.error) return { ok: false, error: read.error };
      if (principal !== null) {
        return { ok: false, error: `Name one principal: --user or --group, once — ${usage}` };
      }
      principal = { principalType: arg === '--user' ? 'user' : 'group', principalId: read.value };
      i++;
    } else if (arg === '--roles') {
      const read = flagValue(args, i, arg, usage);
      if (read.error) return { ok: false, error: read.error };
      roles = read.value.split(',').map((role) => role.trim());
      i++;
    } else if (arg === '--revoke') {
      revoke = true;
    } else if (arg.startsWith('--')) {
      return { ok: false, error: `Unknown option ${arg} — ${usage}` };
    } else if (name === null) {
      name = arg;
    } else {
      return { ok: false, error: `Unexpected argument "${arg}" — ${usage}` };
    }
  }
  if (name === null) return { ok: false, error: usage };
  if (principal === null) {
    if (roles !== null || revoke) {
      return {
        ok: false,
        error: `Name whose roles: --user <username> or --group <group> — ${usage}`,
      };
    }
    return { ok: true, name, action: 'list' };
  }
  if (principal.principalType === 'user' && !isLamasteUsername(principal.principalId)) {
    return { ok: false, error: `"${principal.principalId}" is not a username` };
  }
  if (
    principal.principalType === 'group' &&
    !(
      principal.principalId.length >= 2 &&
      principal.principalId.length <= 63 &&
      GROUP_NAME_RE.test(principal.principalId)
    )
  ) {
    return { ok: false, error: `"${principal.principalId}" is not a group name` };
  }
  if (revoke) {
    if (roles !== null) {
      return { ok: false, error: `--revoke takes every role away; it takes no --roles — ${usage}` };
    }
    return { ok: true, name, action: 'revoke', ...principal };
  }
  if (roles === null) {
    return { ok: false, error: `Give --roles <a,b>, or --revoke — ${usage}` };
  }
  const unique = [...new Set(roles)].sort();
  if (unique.length === 0 || unique.length > IDENTITY_ROLES_MAX || unique.includes('')) {
    return { ok: false, error: `--roles is a comma-separated list of role ids — ${usage}` };
  }
  const bad = unique.find((role) => !IDENTITY_ROLE_ID_REGEX.test(role));
  if (bad !== undefined) return { ok: false, error: `"${bad}" is not a role id` };
  return { ok: true, name, action: 'set', ...principal, roles: unique };
}

/**
 * The arguments of `plugins identity-sync <name> [--reconcile]`.
 *
 * @param {string[]} args
 * @returns {{ ok: true, name: string, reconcile: boolean } | { ok: false, error: string }}
 */
export function parseIdentitySyncArgs(args) {
  const usage = 'Usage: lamaste-server plugins identity-sync <name> [--reconcile]';
  let name = null;
  let reconcile = false;
  for (const arg of args) {
    if (arg === '--reconcile') reconcile = true;
    else if (arg.startsWith('--')) return { ok: false, error: `Unknown option ${arg} — ${usage}` };
    else if (name === null) name = arg;
    else return { ok: false, error: `Unexpected argument "${arg}" — ${usage}` };
  }
  if (name === null) return { ok: false, error: usage };
  return { ok: true, name, reconcile };
}

/**
 * The arguments of `users disable|enable|delete <username>` (`--erase` for
 * delete) and `users erase <userId>`.
 *
 * @param {'disable' | 'enable' | 'delete' | 'erase'} sub
 * @param {string[]} args  what follows the subcommand
 * @returns {{ ok: true, username: string, erase: boolean } | { ok: true, userId: string } | { ok: false, error: string }}
 */
export function parseUserArgs(sub, args) {
  const usage =
    sub === 'erase'
      ? 'Usage: lamaste-server users erase <userId> (a deleted user, as `users directory` lists them)'
      : sub === 'delete'
        ? 'Usage: lamaste-server users delete <username> [--erase]'
        : `Usage: lamaste-server users ${sub} <username>`;
  let target = null;
  let erase = false;
  for (const arg of args) {
    if (arg === '--erase' && sub === 'delete') erase = true;
    else if (arg.startsWith('--')) return { ok: false, error: `Unknown option ${arg} — ${usage}` };
    else if (target === null) target = arg;
    else return { ok: false, error: `Unexpected argument "${arg}" — ${usage}` };
  }
  if (target === null) return { ok: false, error: usage };
  if (sub === 'erase') {
    if (!isIdentityUuid(target)) {
      return { ok: false, error: `"${target}" is not a user id — ${usage}` };
    }
    return { ok: true, userId: target };
  }
  if (!isLamasteUsername(target)) return { ok: false, error: `"${target}" is not a username` };
  return { ok: true, username: target, erase };
}

/**
 * The arguments of `tunnels bind-user-surface|unbind-user-surface <tunnel>
 * <plugin>`: the tunnel (its id, subdomain or FQDN) and the plugin (its name
 * or route).
 *
 * @param {'bind-user-surface' | 'unbind-user-surface'} sub
 * @param {string[]} args
 * @returns {{ ok: true, tunnel: string, plugin: string } | { ok: false, error: string }}
 */
export function parseUserSurfaceArgs(sub, args) {
  const usage = `Usage: lamaste-server tunnels ${sub} <tunnel id | subdomain | fqdn> <plugin>`;
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--')) return { ok: false, error: `Unknown option ${arg} — ${usage}` };
    positional.push(arg);
  }
  if (positional.length !== 2) return { ok: false, error: usage };
  return { ok: true, tunnel: positional[0], plugin: positional[1] };
}

/**
 * The tunnel `ref` names among `tunnels` (as `tunnels.json` holds them): by
 * id, subdomain or FQDN — a host, never an internal plugin tunnel.
 *
 * @param {Array<Record<string, unknown>>} tunnels
 * @param {string} ref
 * @returns {{ tunnel: Record<string, unknown> } | { error: string }}
 */
export function findHostTunnel(tunnels, ref) {
  const hosts = tunnels.filter((t) => typeof t.subdomain === 'string' && t.subdomain.length > 0);
  const tunnel =
    hosts.find((t) => t.id === ref) ??
    hosts.find((t) => t.fqdn === ref) ??
    hosts.find((t) => t.subdomain === ref);
  if (!tunnel) return { error: `No tunnel with the id, subdomain or FQDN "${ref}"` };
  return { tunnel };
}

/**
 * The installed agent-hosted plugin `ref` names (its name or route) among
 * the panel's plugin list.
 *
 * @param {Array<Record<string, unknown>>} plugins
 * @param {string} ref
 * @returns {{ plugin: Record<string, unknown> } | { error: string }}
 */
export function findPluginByNameOrRoute(plugins, ref) {
  const plugin = plugins.find((p) => p.name === ref) ?? plugins.find((p) => p.route === ref);
  if (!plugin) return { error: `No installed plugin named "${ref}" or holding that route` };
  if (typeof plugin.route !== 'string' || plugin.route.length === 0) {
    return { error: `Plugin "${ref}" has no route` };
  }
  return { plugin };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Why users cannot reach a plugin's `/app`, or that they can — the identity
 * view's `readiness` in words.
 *
 * @param {{ ready?: boolean, reason?: string | null, version?: string | null } | null | undefined} readiness
 * @returns {{ ready: boolean, text: string }}
 */
export function readinessText(readiness) {
  if (!readiness) return { ready: false, text: 'unknown' };
  if (readiness.ready) return { ready: true, text: 'ready — users reach its application' };
  const version = readiness.version ? `version ${terminalText(readiness.version)}` : 'it';
  switch (readiness.reason) {
    case 'not_installed':
      return { ready: false, text: 'not installed' };
    case 'no_identity':
      return { ready: false, text: `${version} declares no identity` };
    case 'not_approved':
      return { ready: false, text: `${version} waits for approval (plugins hooks <name>)` };
    case 'not_hosted':
      return { ready: false, text: 'not hosted on an agent, or its hosting is not active' };
    case 'not_answered':
      return {
        ready: false,
        text: `its agent half has not answered the identity feed for ${version} yet`,
      };
    default:
      return { ready: false, text: terminalText(readiness.reason ?? 'not ready') };
  }
}

/** Why a route bound to a tunnel is not served there (`userSurfaceStatus`'s reason), in words. */
export function userSurfaceStatusText(status) {
  if (!status) return 'status unknown';
  if (status.served) return 'served';
  switch (status.reason) {
    case 'not_installed':
      return 'not served — no installed plugin holds the route';
    case 'no_identity':
      return 'not served yet — its installed version declares no identity (requests go down the tunnel)';
    case 'not_approved':
      return 'not served yet — its installed version waits for approval (requests go down the tunnel)';
    default:
      return `not served (${terminalText(status.reason)})`;
  }
}

/** Why a user left an audience, as the terminal says it. */
const REMOVED_STATUS = new Map([
  ['unentitled', 'removed (no longer entitled)'],
  ['deleted', 'removed (deleted)'],
  ['erased', 'erased'],
]);

/**
 * An audience row (`{ userId, seq, version, updatedAt, change }`) as the
 * terminal lists it: who (the member's, or the last known, name), the roles
 * held and where they stand.
 *
 * @param {{ userId: string, seq: number, change: Record<string, any> | null }} row
 * @returns {{ userId: string, seq: number, who: string, roles: string, status: string, member: boolean }}
 */
export function audienceRowText(row) {
  const change = row.change ?? {};
  const name = (user) =>
    user?.displayName && user?.username
      ? `${user.displayName} (${user.username})`
      : (user?.username ?? '—');
  // A row the panel cannot read.
  const text = {
    userId: terminalText(row.userId),
    seq: row.seq,
    who: '—',
    roles: '',
    status: 'unreadable',
    member: false,
  };
  if (change.kind === 'upsert' && change.member) {
    return {
      ...text,
      who: terminalText(name(change.member)),
      roles: terminalText((change.member.roles ?? []).join(', ')),
      status: change.member.status === 'disabled' ? 'disabled' : 'active',
      member: true,
    };
  }
  if (change.kind === 'remove') {
    return {
      ...text,
      who: change.reason === 'erased' ? '—' : terminalText(name(change.last)),
      status: REMOVED_STATUS.get(change.reason) ?? 'removed',
    };
  }
  return text;
}

/**
 * The feed's state (the identity view's `sync`) as `[label, value]` rows:
 * the directory, what the agent half follows, its cursor against the head,
 * the version that answered, the last sync and reconcile with what it
 * found, the last error.
 *
 * @param {Record<string, any>} sync
 * @param {number} now  epoch ms
 * @returns {Array<[string, string]>}
 */
export function syncRows(sync, now) {
  const follows =
    sync.halfDirectoryId === null || sync.halfDirectoryId === undefined
      ? 'nothing yet'
      : sync.halfDirectoryId === sync.directoryId
        ? 'this directory'
        : `another directory (${terminalText(sync.halfDirectoryId)}) — the next sync replays`;
  const rows = [
    ['directory', terminalText(sync.directoryId)],
    ['half follows', follows],
    [
      'position',
      `cursor ${sync.cursor ?? '—'} of head ${sync.head}${sync.behind > 0 ? ` — ${sync.behind} change(s) behind` : ' — up to date'}`,
    ],
    ['answered for', sync.readyVersion ? `version ${terminalText(sync.readyVersion)}` : '—'],
    ['last sync', sync.lastSyncAt ? formatMoment(sync.lastSyncAt, now) : '—'],
    [
      'last reconcile',
      sync.lastReconcileAt
        ? `${formatMoment(sync.lastReconcileAt, now)}${sync.lastMismatches != null ? ` — ${sync.lastMismatches} out of step` : ''}`
        : '—',
    ],
  ];
  if (sync.lastError) rows.push(['last error', terminalText(sync.lastError)]);
  return rows;
}

/**
 * A warning a users or entitlement change came back with — a sentence, or
 * `{ step, message }` — as one line.
 *
 * @param {unknown} warning
 * @returns {string}
 */
export function warningLine(warning) {
  if (typeof warning === 'string') return terminalText(warning);
  if (warning !== null && typeof warning === 'object' && typeof warning.message === 'string') {
    return terminalText(warning.step ? `${warning.step}: ${warning.message}` : warning.message);
  }
  return terminalText(warning);
}
