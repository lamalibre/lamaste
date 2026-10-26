/**
 * The relay's domains as `lamaste-server domains` prints them — pure
 * helpers, exported for tests (the command is src/commands/domains.js).
 */

import { terminalText } from './plugin-settings.js';

/**
 * One row per domain: name, state, members, what uses it — as terminal text.
 *
 * @param {Array<Record<string, any>>} domains  as `GET /api/domains` lists them
 */
export function domainRows(domains) {
  return domains.map((d) => ({
    name: terminalText(d.name),
    state: d.status === 'active' ? (d.primary ? 'primary' : 'active') : 'pending',
    members: Number.isInteger(d.members) ? d.members : 0,
    externalMembers: Number.isInteger(d.externalMembers) ? d.externalMembers : 0,
    usedBy: usageText(d.usedBy),
  }));
}

/** What uses a domain, in one line (empty when nothing does). */
export function usageText(usedBy) {
  if (!usedBy) return '';
  const parts = [];
  const count = (label, items) => {
    if (Array.isArray(items) && items.length > 0) parts.push(`${items.length} ${label}`);
  };
  count('tunnel(s)', usedBy.tunnels);
  count('site(s)', usedBy.sites);
  count('plugin(s)', usedBy.plugins);
  if (usedBy.registry) parts.push('the registry credential');
  return parts.join(', ');
}

/** `/api/domains/<name><rest>`. */
export function domainPath(name, rest = '') {
  return `/api/domains/${encodeURIComponent(name)}${rest}`;
}

/**
 * A user's memberships in one line — `a.example, b.example (external)` —
 * as terminal text; `—` for none. A bare name (an older panel's answer) is
 * a member.
 *
 * @param {ReadonlyArray<string | { name: string, kind?: string }> | undefined} domains
 */
export function membershipsText(domains) {
  const parts = (domains ?? []).flatMap((d) => {
    const name = typeof d === 'string' ? d : d?.name;
    if (typeof name !== 'string') return [];
    return [terminalText(d?.kind === 'external' ? `${name} (external)` : name)];
  });
  return parts.length > 0 ? parts.join(', ') : '—';
}

/** Whether any of `domains` is an external membership. */
export function isExternalAnywhere(domains) {
  return (domains ?? []).some((d) => d?.kind === 'external');
}

/**
 * What `domains members <domain> <action> <user> …` asks the panel, or
 * null for a command line it does not take:
 *
 * - `add <user> [--external]` — a member (an external one with the flag);
 * - `kind <user> member|external` — change the kind of a membership;
 * - `remove <user>` — end it.
 *
 * `user` is a directory id or a username.
 *
 * @param {string} domain
 * @param {string[]} rest  what follows `members <domain>`
 * @returns {{ method: 'PUT' | 'DELETE', path: string, body: object | null, user: string, kind: 'member' | 'external' | null } | null}
 */
export function memberRequest(domain, rest) {
  const [action, user, ...more] = rest;
  if (!user) return null;
  const path = domainPath(domain, `/members/${encodeURIComponent(user)}`);
  if (action === 'remove' && more.length === 0) {
    return { method: 'DELETE', path, body: null, user, kind: null };
  }
  if (action === 'add' && more.every((a) => a === '--external')) {
    const kind = more.length > 0 ? 'external' : 'member';
    return { method: 'PUT', path, body: { kind }, user, kind };
  }
  if (action === 'kind' && more.length === 1 && (more[0] === 'member' || more[0] === 'external')) {
    return { method: 'PUT', path, body: { kind: more[0] }, user, kind: more[0] };
  }
  return null;
}
