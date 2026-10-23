/**
 * A plugin's web surface at the terminal — the arguments of
 * `lamaste-server plugins web-surface <name> [create|move|delete]`, the
 * words its output is made of, and how `sites list` marks a site a plugin
 * owns (what an approval shows about a web tree is in `plugin-approval.js`). Pure — no output, no
 * panel — so they are tested as they are. Every string from the panel goes
 * through `terminalText` before it is printed; `--json` carries the data as
 * it came.
 */

import { WEB_SURFACE_ACCESS_MODES, isWebSurfaceSubdomain } from '@lamalibre/lamaste';
import { terminalText } from './plugin-settings.js';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** How `plugins web-surface` is called. */
export const WEB_SURFACE_USAGE =
  'Usage: lamaste-server plugins web-surface <name> [create [--subdomain <label>] [--access-mode authenticated|restricted] | move --tunnel <id | subdomain | fqdn> | delete [--yes]]';

/** The flags each action takes, and whether each takes a value. */
const ACTION_FLAGS = {
  status: {},
  create: { '--subdomain': true, '--access-mode': true },
  move: { '--tunnel': true },
  delete: { '--yes': false },
};

/** Every flag that takes a value, whichever action it belongs to. */
const VALUE_FLAGS = new Set(
  Object.values(ACTION_FLAGS).flatMap((flags) =>
    Object.entries(flags)
      .filter(([, takesValue]) => takesValue)
      .map(([flag]) => flag),
  ),
);

/**
 * The arguments of `plugins web-surface …` after the subcommand: the
 * plugin, then an action — none (its status), `create` (with `--subdomain`
 * and `--access-mode`, each defaulting to what the plugin declares),
 * `move --tunnel <ref>` (a tunnel's id, subdomain or FQDN), or `delete`
 * (`--yes` skips the typed confirmation).
 *
 * @param {string[]} args
 * @returns {{ ok: true, name: string, action: 'status' }
 *   | { ok: true, name: string, action: 'create', subdomain: string | null, accessMode: string | null }
 *   | { ok: true, name: string, action: 'move', tunnel: string }
 *   | { ok: true, name: string, action: 'delete', yes: boolean }
 *   | { ok: false, error: string }}
 */
export function parseWebSurfaceArgs(args) {
  const usage = WEB_SURFACE_USAGE;
  const positional = [];
  /** @type {Map<string, string | true>} */
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (flags.has(arg)) return { ok: false, error: `${arg} is given twice — ${usage}` };
    if (!VALUE_FLAGS.has(arg)) {
      flags.set(arg, true);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `${arg} needs a value — ${usage}` };
    }
    flags.set(arg, value);
    i++;
  }
  if (positional.length === 0) return { ok: false, error: usage };
  if (positional.length > 2) {
    return { ok: false, error: `Unexpected argument "${positional[2]}" — ${usage}` };
  }
  const [name, action = 'status'] = positional;
  if (positional.length === 2 && !['create', 'move', 'delete'].includes(action)) {
    return { ok: false, error: `Unknown action "${action}" — ${usage}` };
  }
  const allowed = ACTION_FLAGS[action];
  for (const flag of flags.keys()) {
    if (!Object.hasOwn(allowed, flag)) {
      return {
        ok: false,
        error:
          action === 'status'
            ? `Unknown option ${flag} — ${usage}`
            : `${action} takes no ${flag} — ${usage}`,
      };
    }
  }

  switch (action) {
    case 'create': {
      const subdomain = flags.get('--subdomain') ?? null;
      const accessMode = flags.get('--access-mode') ?? null;
      if (subdomain !== null && !isWebSurfaceSubdomain(subdomain)) {
        return {
          ok: false,
          error: `"${subdomain}" cannot be a web surface's subdomain: a DNS label, not reserved (panel, auth, tunnel, www, mail, ftp, api) and not agent-*`,
        };
      }
      if (accessMode !== null && !WEB_SURFACE_ACCESS_MODES.includes(accessMode)) {
        return {
          ok: false,
          error: `--access-mode is ${WEB_SURFACE_ACCESS_MODES.join(' or ')} — a web surface is never public`,
        };
      }
      return { ok: true, name, action, subdomain, accessMode };
    }
    case 'move': {
      const tunnel = flags.get('--tunnel');
      if (tunnel === undefined) {
        return {
          ok: false,
          error: `Name the tunnel to move: --tunnel <id | subdomain | fqdn> — ${usage}`,
        };
      }
      return { ok: true, name, action, tunnel };
    }
    case 'delete':
      return { ok: true, name, action, yes: flags.has('--yes') };
    default:
      return { ok: true, name, action: 'status' };
  }
}

/**
 * The body of `POST /api/plugins/:name/web-surface`: only what was given —
 * the panel falls back to what the plugin declares.
 *
 * @param {{ subdomain: string | null, accessMode: string | null }} parsed
 * @returns {{ subdomain?: string, accessMode?: string }}
 */
export function createBody({ subdomain, accessMode }) {
  return {
    ...(subdomain !== null ? { subdomain } : {}),
    ...(accessMode !== null ? { accessMode } : {}),
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** A tree digest as the terminal shows it beside others: its first 12 hex digits. */
export function shortDigest(sha256) {
  if (typeof sha256 !== 'string' || sha256.length === 0) return '—';
  return terminalText(sha256.slice(0, 12));
}

/** A size in bytes, in words (`1.5 MiB`). */
export function bytesText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'an unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Whether the web surface's site serves the shell and the API, and why not
 * — the status's `served`/`reason` (and whether it owns a site at all) in
 * a sentence.
 *
 * @param {{ served?: boolean, reason?: string | null, site?: unknown }} view
 * @param {string} name  the plugin
 * @returns {{ served: boolean, text: string }}
 */
export function webSurfaceServedText(view, name) {
  const plugin = terminalText(name);
  const hasSite = view?.site !== null && view?.site !== undefined;
  if (view?.served) {
    return hasSite
      ? { served: true, text: 'served — its site serves the shell and the API' }
      : {
          served: false,
          text: 'ready to be served, but it owns no site yet — create one, or move a bound tunnel to it',
        };
  }
  const where = hasSite ? 'its site answers 503' : 'it owns no site yet';
  const notServed = (why) => ({ served: false, text: `${why} (${where})` });
  switch (view?.reason) {
    case 'not_installed':
      return notServed('not served — the plugin is not installed');
    case 'no_identity':
      return notServed(
        'not served — its installed version declares no identity, which a web surface fronts',
      );
    case 'no_web_surface':
      return notServed('not served — its installed version declares no web surface');
    case 'not_approved':
      return notServed(
        `not served — its installed version waits for approval: lamaste-server plugins hooks ${plugin}`,
      );
    case 'not_hosted':
      return notServed(
        `not served — it is not hosted on an agent, or its hosting is not active: lamaste-server plugins hosting ${plugin}`,
      );
    case 'tree_not_current':
      return notServed(
        'not served yet — the relay does not serve its approved web tree yet; it switches once the agent half runs the approved version',
      );
    default:
      return {
        served: false,
        text: `not served (${terminalText(view?.reason ?? 'unknown')}; ${where})`,
      };
  }
}

/**
 * The trees the relay holds for a web surface (the status's `tree`:
 * `{ approved, current, previous }`) as `[label, value]` rows — short
 * digests, with whether the one served is the approved one.
 *
 * @param {{ approved?: string | null, current?: string | null, previous?: string | null } | null | undefined} tree
 * @returns {Array<[string, string]>}
 */
export function webTreeRows(tree) {
  const approved = tree?.approved ?? null;
  const current = tree?.current ?? null;
  const previous = tree?.previous ?? null;
  const serving =
    current === null
      ? 'none'
      : approved !== null && current === approved
        ? `${shortDigest(current)} (the approved tree)`
        : `${shortDigest(current)} (not the approved tree)`;
  return [
    ['approved tree', approved === null ? 'none' : shortDigest(approved)],
    ['serving', serving],
    [
      'previous',
      previous === null ? 'none' : `${shortDigest(previous)} (fallback for pages still open)`,
    ],
  ];
}

/** What each refusal of the web-surface routes asks of the administrator, beside its message. */
const REFUSAL_HINTS = {
  no_web_surface: () =>
    'Its installed version declares no userSurface.web; update to a version that does.',
  no_identity: () =>
    'A web surface is the front of its user surface, which needs an identity block.',
  exists: (name) => `It owns a site already: lamaste-server plugins web-surface ${name}`,
  bound_to_tunnel: (name) =>
    `Move that tunnel's host to it instead: lamaste-server plugins web-surface ${name} move --tunnel <id | fqdn>`,
  hostname_taken: (name) =>
    `Choose another subdomain: lamaste-server plugins web-surface ${name} create --subdomain <label>`,
  not_bound: () =>
    'Only a tunnel bound as its user surface moves (lamaste-server tunnels bind-user-surface).',
  shared_tunnel: () =>
    'Unbind the other plugins first: lamaste-server tunnels unbind-user-surface <tunnel> <plugin>',
  tunnel_disabled: () => 'Enable the tunnel first: lamaste-server tunnels toggle <id> --enable',
  not_hosted: (name) =>
    `The agent carrying the tunnel must host it: lamaste-server plugins hosting ${name}`,
  not_approved: (name) =>
    `Approve its installed version first: lamaste-server plugins hooks ${name}`,
  web_tree: () =>
    "The approved web tree could not be put in place; nothing changed. The panel's log names the file.",
  gatekeeper: () => 'Gatekeeper could not be reached; nothing changed. Try again once it runs.',
};

/**
 * The next step a refusal (`code`) of the web-surface routes points to, or
 * null when its message says all there is.
 *
 * @param {unknown} code
 * @param {string} name  the plugin
 * @returns {string | null}
 */
export function webSurfaceRefusalHint(code, name) {
  if (typeof code !== 'string' || !Object.hasOwn(REFUSAL_HINTS, code)) return null;
  return terminalText(REFUSAL_HINTS[code](terminalText(name)));
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

/**
 * How `sites list` marks a site: `[plugin <route>, <access mode>]` for a
 * site a plugin owns as its web surface, null for any other.
 *
 * @param {Record<string, any>} site
 * @returns {string | null}
 */
export function siteOwnerTag(site) {
  const owner = site?.owner;
  if (owner === null || typeof owner !== 'object' || typeof owner.plugin !== 'string') return null;
  const mode = typeof site.accessMode === 'string' ? `, ${site.accessMode}` : '';
  return terminalText(`[plugin ${owner.plugin}${mode}]`);
}
