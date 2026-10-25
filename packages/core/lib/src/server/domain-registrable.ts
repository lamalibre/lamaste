/**
 * Which base domains one relay may hold side by side, by the Public Suffix
 * List (the multi-domain relay, `packages/core/docs/multi-domain-relay-design.md`,
 * Security review).
 *
 * Overlap (`domainsOverlap`) is not enough: `cust1.example.net` and
 * `cust2.example.net` never nest, yet an application on one may set a cookie
 * on `example.net` that the browser sends to the other (a stray or planted
 * `authelia_session`, a sign-in forced on someone), and both are one "site"
 * for `SameSite`. So two domains must have different registrable domains
 * (eTLD+1), and a public suffix (`com.tr`, `github.io`) is never a domain.
 * Server only: the list is large and stays out of the browser-safe
 * `@lamalibre/lamaste/domains`.
 */

import { getDomain, getPublicSuffix } from 'tldts';

import { DomainError, assertDomainAddable } from '../domains.js';

/** The Public Suffix List's private section too: `a.github.io` and `b.github.io` are two sites. */
const PSL_OPTIONS = { allowPrivateDomains: true } as const;

/**
 * The registrable domain (eTLD+1) of `name` — `codelama.com.tr` for
 * `feria.codelama.com.tr` — or null when `name` is a public suffix itself.
 */
export function registrableDomain(name: string): string | null {
  return getDomain(name, PSL_OPTIONS);
}

/**
 * Refuse `name` as a new domain beside `existing`: invalid or overlapping
 * ({@link assertDomainAddable}), a public suffix, or under the registrable
 * domain of one of them.
 */
export function assertDomainRegistrable(name: unknown, existing: readonly string[]): void {
  assertDomainAddable(name, existing);
  const registrable = registrableDomain(name as string);
  if (registrable === null || getPublicSuffix(name as string, PSL_OPTIONS) === name) {
    throw new DomainError(`'${String(name)}' is a public suffix, not a domain`, 'PUBLIC_SUFFIX');
  }
  const sibling = existing.find((d) => registrableDomain(d) === registrable);
  if (sibling !== undefined) {
    throw new DomainError(
      `'${String(name)}' shares the registrable domain '${registrable}' with '${sibling}' — ` +
        'an application on one could set cookies for the other',
      'SAME_REGISTRABLE_DOMAIN',
    );
  }
}
