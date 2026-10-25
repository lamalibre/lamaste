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

/** The primary domain's name, or null before the list has loaded. */
export function primaryDomainName(domains) {
  return (domains ?? []).find((d) => d.primary)?.name ?? null;
}

/**
 * Whether a form asks which domain: only once the relay has two active
 * domains — a single-domain relay looks as it did.
 */
export function needsDomainChoice(domains) {
  return activeDomainNames(domains).length > 1;
}

/**
 * Whether new users must be given their domains: the relay has two
 * domains or more (pending ones count — the panel refuses without them,
 * `domains_required`).
 */
export function newUsersNeedDomains(domains) {
  return (domains ?? []).length > 1;
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

/**
 * The DNS records a domain needs at its DNS host before activation: its
 * sign-in, and either one wildcard or one record per hostname.
 *
 * @param {string} name
 * @param {string | null | undefined} ip the relay's address
 */
export function dnsRecordsFor(name, ip) {
  const value = ip || '<relay IP>';
  return [
    { type: 'A', name: `auth.${name}`, value, purpose: 'the domain’s sign-in page (required)' },
    {
      type: 'A',
      name: `*.${name}`,
      value,
      purpose: 'every tunnel and site hostname — or one A record per hostname instead',
    },
  ];
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
 * The membership changes that turn `before` into `after`.
 *
 * @param {readonly string[]} before
 * @param {readonly string[]} after
 */
export function membershipChanges(before, after) {
  const was = new Set(before ?? []);
  const will = new Set(after ?? []);
  return {
    add: [...will].filter((d) => !was.has(d)).sort(),
    remove: [...was].filter((d) => !will.has(d)).sort(),
  };
}
