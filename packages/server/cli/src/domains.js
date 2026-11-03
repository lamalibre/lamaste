/**
 * The relay's domains as `lamaste-server domains` prints them — pure
 * helpers, exported for tests (the command is src/commands/domains.js).
 */

import { PAGE_LANGUAGE_NAMES, isPageLanguage } from '@lamalibre/lamaste/page-messages';
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
    language: isPageLanguage(d.language) ? d.language : null,
  }));
}

/** A page language in words — `tr (Türkçe)` —, or the "not set" words. */
export function languageText(language) {
  return isPageLanguage(language)
    ? `${language} (${PAGE_LANGUAGE_NAMES[language]})`
    : 'not set — English pages, sign-in following the browser';
}

/**
 * What `domains language <domain> [<language> | --unset]` does: show the
 * current language (no argument), set one, or clear it. The panel decides
 * which languages exist (400 `invalid_language`); null for a command line
 * it does not take.
 *
 * @param {string} domain
 * @param {string[]} rest  what follows `language <domain>`
 * @returns {{ action: 'show' } | { action: 'set', language: string | null, path: string, body: { language: string | null } } | null}
 */
export function languageRequest(domain, rest) {
  if (rest.length === 0) return { action: 'show' };
  if (rest.length !== 1) return null;
  const [arg] = rest;
  if (arg !== '--unset' && arg.startsWith('-')) return null;
  const language = arg === '--unset' ? null : arg;
  return { action: 'set', language, path: domainPath(domain, '/language'), body: { language } };
}

/**
 * The state of a domain's sign-in rendering in one line, or null when it
 * has neither a brand nor a language.
 *
 * @param {{ status?: string, rendering?: { rendered: object | null, current: boolean, renderFailing: boolean, vhostPending: boolean } | null }} domain
 */
export function renderingText(domain) {
  const r = domain?.rendering;
  if (!r) return null;
  if (r.renderFailing) return 'the last rendering failed — the panel retries every minute';
  if (!r.current || r.rendered === null) return 'rendering (within a minute)';
  if (domain.status === 'active' && r.vhostPending) return 'rendered; the vhost waits for a retry';
  return domain.status === 'active' ? 'rendered and served' : 'rendered; served once active';
}

/**
 * The relay's Authelia when it is not the pinned release, in one line —
 * null when it is, or when its version could not be read.
 *
 * @param {{ running: string | null, pinned: string } | null | undefined} authelia
 */
export function autheliaVersionText(authelia) {
  if (!authelia?.running || authelia.running === authelia.pinned) return null;
  return terminalText(
    `Authelia ${authelia.running} runs on this relay; Lamaste is tested with ${authelia.pinned} — on a domain with a language or a brand, some sign-in texts may show in English or the browser's language.`,
  );
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
