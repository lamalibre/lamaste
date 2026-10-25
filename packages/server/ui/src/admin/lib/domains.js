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

/** Whether two domain lists hold the same domains, in any order. */
export function sameDomains(a, b) {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  return left.size === right.size && [...left].every((d) => right.has(d));
}
