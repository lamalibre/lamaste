/**
 * The relay's base domains (the multi-domain relay), in the panel's words —
 * for the Domains page, the domain pickers of tunnels and sites, and the
 * users' memberships. Pure: nothing here calls the panel.
 */

import { errorMessage, refusalOf } from './errorMessage.js';

/**
 * The domains a hostname may be put under: the active ones, the primary
 * first, then by name.
 *
 * @param {ReadonlyArray<{ name: string, primary: boolean, status: string }>} domains
 * @returns {string[]}
 */
export function activeDomainNames(domains) {
  return (domains ?? [])
    .filter((d) => d.status === 'active')
    .sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1))
    .map((d) => d.name);
}

/**
 * Whether a form asks which domain: only once the relay has two active
 * domains — a single-domain relay looks as it did.
 */
export function needsDomainChoice(domains) {
  return activeDomainNames(domains).length > 1;
}

/** A domain's state in words. */
export function domainStatusText(domain) {
  if (domain.status === 'active') return domain.primary ? 'active — primary' : 'active';
  return 'pending — sign-in not served yet';
}

/**
 * What uses a domain, one line each (what keeps it from being removed).
 *
 * @param {{ tunnels?: string[], sites?: string[], plugins?: string[], registry?: boolean } | undefined} usedBy
 * @returns {string[]}
 */
export function domainUsageLines(usedBy) {
  if (!usedBy) return [];
  const lines = [];
  const list = (label, items) => {
    if (items?.length > 0) lines.push(`${label}: ${items.join(', ')}`);
  };
  list('Tunnels', usedBy.tunnels);
  list('Sites', usedBy.sites);
  list('Plugins', usedBy.plugins);
  if (usedBy.registry) lines.push('The registry credential trusts its issuer');
  return lines;
}

/** A refused domain change in words, with what still uses the domain. */
export function explainDomainRefusal(err) {
  const { code } = refusalOf(err);
  const message = errorMessage(err);
  if (code === 'domain_in_use') {
    const lines = domainUsageLines(err?.usedBy);
    return lines.length > 0 ? `${message} — ${lines.join('; ')}` : message;
  }
  return message;
}

/**
 * Users who could be added to a domain: active and disabled users with a
 * directory id who are not members yet, by username.
 *
 * @param {ReadonlyArray<{ username: string, userId: string | null }>} users
 * @param {ReadonlyArray<{ userId: string }>} members
 */
export function memberCandidates(users, members) {
  const taken = new Set((members ?? []).map((m) => m.userId));
  return (users ?? [])
    .filter((u) => u.userId && !taken.has(u.userId))
    .sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * What an external member reaches, in the panel's words: only what names
 * them (decided per domain, packages/core/docs/external-members-design.md).
 */
export const EXTERNAL_MEMBER_HINT =
  'An external member reaches only what names them: restricted tunnels and surfaces that grant them, sites that list them, OIDC clients granted to them. They hold no Authelia groups.';

/**
 * Memberships as the panel answers them — `{ name, kind }` — each domain
 * once, by name. A bare name (an answer of an older panel) is a member.
 *
 * @param {ReadonlyArray<string | { name: string, kind?: string }> | undefined} list
 * @returns {Array<{ name: string, kind: 'member' | 'external' }>}
 */
export function membershipsOf(list) {
  const byName = new Map();
  for (const entry of list ?? []) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (typeof name !== 'string') continue;
    byName.set(name, entry?.kind === 'external' ? 'external' : 'member');
  }
  return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([name, kind]) => ({ name, kind }));
}

/** Whether any of `memberships` is external — such a user holds no Authelia groups. */
export function isExternalAnywhere(memberships) {
  return membershipsOf(memberships).some((m) => m.kind === 'external');
}

/** The kind of the membership of `name` among `memberships`, or null when there is none. */
export function membershipKind(memberships, name) {
  return membershipsOf(memberships).find((m) => m.name === name)?.kind ?? null;
}

/**
 * `memberships` with the membership of `name` set to `kind` — or ended,
 * when `kind` is null.
 *
 * @param {ReadonlyArray<string | { name: string, kind?: string }> | undefined} memberships
 * @param {string} name
 * @param {'member' | 'external' | null} kind
 */
export function withMembership(memberships, name, kind) {
  const others = membershipsOf(memberships).filter((m) => m.name !== name);
  return membershipsOf(kind === null ? others : [...others, { name, kind }]);
}

/** Whether two membership lists hold the same domains with the same kinds, in any order. */
export function sameMemberships(a, b) {
  const key = (list) =>
    membershipsOf(list)
      .map((m) => `${m.name}:${m.kind}`)
      .join(',');
  return key(a) === key(b);
}

/**
 * The directory ids of the users who are external members of `domain` —
 * for marking them where a list does not say (a plugin's audience).
 *
 * @param {ReadonlyArray<{ userId: string | null, domains?: unknown }>} users
 * @param {string | undefined} domain
 * @returns {Set<string>}
 */
export function externalUserIds(users, domain) {
  const ids = new Set();
  if (!domain) return ids;
  for (const user of users ?? []) {
    if (user.userId && membershipKind(user.domains, domain) === 'external') ids.add(user.userId);
  }
  return ids;
}
