/**
 * `lamaste-server native-apps` — the pure part: its arguments, the bodies it
 * sends, the host it names, and the words it prints
 * (packages/core/docs/native-apps-design.md).
 */

import { isNativeClientId, nativeClientId } from '@lamalibre/lamaste';
import { terminalText } from './plugin-settings.js';

export const NATIVE_APPS_USAGE =
  'Usage: lamaste-server native-apps list | create <slug> --host <fqdn | id> --name <n> --redirect <path,…> [settings] | update <client> [settings] | enable|disable <client> | delete <client> [--yes] | grants <client> [--user <u>] [--status live|ended|all] | revoke <client> --grant <id> | --user <u>';

/**
 * The settings flags `create` and `update` take, and the body field each
 * fills: lists split on commas; numbers checked as integers (the panel
 * checks their ranges).
 */
const SETTINGS_FLAGS = {
  '--name': 'name',
  '--redirect': 'redirectPaths',
  '--access-minutes': 'accessTokenMinutes',
  '--idle-days': 'idleDays',
  '--absolute-days': 'absoluteDays',
  '--ios-team': 'iosTeam',
  '--ios-bundle': 'iosBundles',
  '--android': 'android',
};

const NUMBER_FIELDS = new Set(['accessTokenMinutes', 'idleDays', 'absoluteDays']);

/** The flags each subcommand takes: `true` takes a value, `false` stands alone. */
const SUBCOMMAND_FLAGS = {
  list: {},
  create: {
    ...Object.fromEntries(Object.keys(SETTINGS_FLAGS).map((f) => [f, true])),
    '--host': true,
    '--disabled': false,
  },
  update: Object.fromEntries(Object.keys(SETTINGS_FLAGS).map((f) => [f, true])),
  enable: {},
  disable: {},
  delete: { '--yes': false },
  grants: { '--user': true, '--status': true },
  revoke: { '--grant': true, '--user': true },
};

/** The client a subcommand names: `lamaste-native-<slug>`, or the slug alone. */
export function clientIdOf(ref) {
  if (isNativeClientId(ref)) return ref;
  try {
    const id = nativeClientId(ref);
    return isNativeClientId(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The arguments of `native-apps …`: the subcommand, its one positional (a
 * client, or `create`'s slug) and its flags — a flag given twice, unknown to
 * the subcommand, or missing its value is refused. `--android` may repeat:
 * `<package>=<fingerprint>[,<fingerprint>…]`, one app each.
 *
 * @param {string[]} args
 * @returns {{ ok: true, sub: string, target: string | null, flags: Map<string, string | true>, android: string[] } | { ok: false, error: string }}
 */
export function parseNativeAppsArgs(args) {
  const [sub, ...rest] = args;
  if (!sub || !Object.hasOwn(SUBCOMMAND_FLAGS, sub)) {
    return { ok: false, error: NATIVE_APPS_USAGE };
  }
  const allowed = SUBCOMMAND_FLAGS[sub];
  const positional = [];
  const flags = new Map();
  const android = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (!Object.hasOwn(allowed, arg)) {
      return { ok: false, error: `${sub} takes no ${arg} — ${NATIVE_APPS_USAGE}` };
    }
    if (arg !== '--android' && flags.has(arg)) {
      return { ok: false, error: `${arg} is given twice — ${NATIVE_APPS_USAGE}` };
    }
    if (!allowed[arg]) {
      flags.set(arg, true);
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `${arg} needs a value — ${NATIVE_APPS_USAGE}` };
    }
    i++;
    if (arg === '--android') android.push(value);
    else flags.set(arg, value);
  }
  const wants = sub === 'list' ? 0 : 1;
  if (positional.length !== wants) return { ok: false, error: NATIVE_APPS_USAGE };
  return { ok: true, sub, target: positional[0] ?? null, flags, android };
}

/** Split a comma list, empty entries dropped. */
function commaList(value) {
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * The settings a `create` or `update` sets, as the panel's body: only what
 * was given. iOS needs both the team and the bundles when either is given
 * (it replaces the whole association setting, with Android's as given).
 *
 * @param {Map<string, string | true>} flags
 * @param {string[]} android
 * @param {{ associations?: object }} [current] the client as it is (update only)
 * @returns {{ ok: true, body: Record<string, unknown> } | { ok: false, error: string }}
 */
export function nativeSettingsBody(flags, android, current = {}) {
  const body = {};
  const fields = {};
  for (const [flag, field] of Object.entries(SETTINGS_FLAGS)) {
    if (flags.has(flag)) fields[field] = flags.get(flag);
  }
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.redirectPaths !== undefined) body.redirectPaths = commaList(fields.redirectPaths);
  for (const field of NUMBER_FIELDS) {
    if (fields[field] === undefined) continue;
    if (!/^\d{1,4}$/.test(fields[field])) {
      return { ok: false, error: `${field} is a whole number — got "${fields[field]}"` };
    }
    body[field] = Number(fields[field]);
  }
  const iosGiven = fields.iosTeam !== undefined || fields.iosBundles !== undefined;
  if (iosGiven || android.length > 0) {
    const associations = { ...(current.associations ?? {}) };
    if (iosGiven) {
      if (fields.iosTeam === undefined || fields.iosBundles === undefined) {
        return { ok: false, error: '--ios-team and --ios-bundle go together' };
      }
      associations.ios = { teamId: fields.iosTeam, bundleIds: commaList(fields.iosBundles) };
    }
    if (android.length > 0) {
      const apps = [];
      for (const entry of android) {
        const at = entry.indexOf('=');
        if (at <= 0) {
          return {
            ok: false,
            error: `--android is <package>=<SHA-256 fingerprint>[,<fingerprint>…] — got "${entry}"`,
          };
        }
        apps.push({
          packageName: entry.slice(0, at),
          sha256CertFingerprints: commaList(entry.slice(at + 1)).map((f) => f.toUpperCase()),
        });
      }
      associations.android = apps;
    }
    body.associations = associations;
  }
  return { ok: true, body };
}

/**
 * The application host `ref` names — a plugin-owned site or a tunnel bound
 * to plugin routes — by id or FQDN (any case).
 *
 * @param {{ sites: object[], tunnels: object[] }} state
 * @param {string} ref
 * @returns {{ hostKind: 'site' | 'tunnel', hostId: string, fqdn: string } | { error: string }}
 */
export function findApplicationHost({ sites, tunnels }, ref) {
  const wanted = String(ref).toLowerCase();
  const matches = (entry) =>
    entry.id === ref || (typeof entry.fqdn === 'string' && entry.fqdn.toLowerCase() === wanted);
  const site = (sites ?? []).find((s) => s?.owner && matches(s));
  if (site) return { hostKind: 'site', hostId: site.id, fqdn: site.fqdn };
  const tunnel = (tunnels ?? []).find(
    (t) => Array.isArray(t?.userSurface?.routes) && t.userSurface.routes.length > 0 && matches(t),
  );
  if (tunnel) return { hostKind: 'tunnel', hostId: tunnel.id, fqdn: tunnel.fqdn };
  return {
    error: `"${ref}" is no application host — a plugin-owned site or a tunnel bound to plugin routes (by id or FQDN)`,
  };
}

/** One line on whether Authelia signs people in with the client. */
export function nativeClientStateText(client) {
  if (client.served) return 'signs people in';
  return (
    {
      disabled: 'disabled — no sign-ins, its grants ended',
      host_missing: 'not served — its host is gone',
      host_public: 'not served — its host is public',
      host_disabled: 'not served — its host is disabled',
      domain_inactive: 'not served — its host lies under no active domain',
    }[client.reason] ?? 'not served'
  );
}

/**
 * The rows `native-apps list` prints for one client: label → value, every
 * value as {@link terminalText}.
 *
 * @returns {Array<[string, string]>}
 */
export function nativeClientRows(client) {
  const rows = [
    ['name', client.name],
    ['host', `${client.hostKind} ${client.fqdn ?? client.hostId}`],
    ['state', nativeClientStateText(client)],
    ['audience', client.audience ?? '—'],
    [
      'redirect URIs',
      (client.redirectUris?.length ? client.redirectUris : client.redirectPaths).join(', '),
    ],
    [
      'lifetimes',
      `access ${client.accessTokenMinutes} min · idle ${client.idleDays} d · absolute ${client.absoluteDays} d`,
    ],
    ['plugins', client.servedRoutes?.length ? client.servedRoutes.join(', ') : 'none served'],
  ];
  const ios = client.associations?.ios;
  if (ios) rows.push(['iOS', `${ios.teamId} · ${ios.bundleIds.join(', ')}`]);
  for (const app of client.associations?.android ?? []) {
    rows.push([
      'Android',
      `${app.packageName} · ${app.sha256CertFingerprints.length} fingerprint(s)`,
    ]);
  }
  return rows.map(([label, value]) => [label, terminalText(String(value))]);
}

/** Why a grant ended, in words. */
export function grantEndWords(reason) {
  const words = {
    idle_expired: 'idle lifetime passed',
    absolute_expired: 'absolute lifetime reached',
    reuse: 'a spent refresh token was used again',
    issuer_refused: 'the issuer refused its refresh token',
    revoked_by_client: 'signed out in the app',
    revoked_by_admin: 'ended by an administrator',
    client_disabled: 'client disabled',
    client_deleted: 'client deleted',
    host_deleted: 'host deleted',
    'standing:disabled': 'person disabled',
    'standing:removed': 'person removed',
    'standing:erased': 'person erased',
    'standing:not_member': 'person left the domain',
    'standing:no_role': 'person holds no role on the host’s plugins',
    'standing:no_grant': 'person lost the host’s grant',
    'standing:cleanup_pending': 'an earlier holder of the username is being cleaned up',
  };
  return terminalText(words[reason] ?? String(reason ?? ''));
}

/** One line per grant: who, which device, since, last used, and its end or expiry. */
export function grantLine(grant, { withClient = false } = {}) {
  const who = grant.username ?? grant.userId;
  const device = grant.deviceName ?? 'unnamed device';
  const end =
    grant.status === 'live'
      ? `until ${grant.expiresAt ?? '—'}`
      : `ended ${grant.endedAt ?? ''} (${grantEndWords(grant.endedReason)})`;
  return terminalText(
    `${withClient ? `${grant.clientId} ` : ''}${who} · ${device} · signed in ${grant.createdAt} · last used ${grant.lastUsedAt} · ${end} · ${grant.grantId}`,
  );
}
