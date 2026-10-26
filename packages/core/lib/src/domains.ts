/**
 * The base domains a relay serves (the multi-domain relay,
 * `packages/core/docs/multi-domain-relay-design.md`).
 *
 * One domain is the primary — the panel's (`panel.`, `tunnel.`, agent
 * panels); every other one only serves tunnels, sites and surfaces under it,
 * with its own sign-in at `auth.<domain>` and its own member list. Pure: the
 * panel keeps the records (`state.db`), Gatekeeper reads a projection of
 * them, and both decide a hostname's domain here.
 *
 * Browser-safe (zod and the dependency-free constants only): the panel UI
 * imports it as `@lamalibre/lamaste/domains`, with the reserved names and
 * ports re-exported below, so no client keeps a copy of a rule.
 */

import { z } from 'zod';

import {
  AGENT_PANEL_SUBDOMAIN_PREFIX,
  CORE_SUBDOMAINS,
  HOSTNAME_REGEX,
  RESERVED_SUBDOMAINS,
  isLamasteUsername,
} from './constants.js';

export {
  AGENT_PANEL_SUBDOMAIN_PREFIX,
  RESERVED_SUBDOMAINS,
  RESERVED_TUNNEL_PORTS,
} from './constants.js';

/** Where a domain is in its lifecycle: added, or serving (`auth.` issued, cookie rendered). */
export const DOMAIN_STATUSES = ['pending', 'active'] as const;

export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** A base domain of the relay. */
export interface DomainRecord {
  /** Lower case, at least two labels — `codelama.com.tr`. */
  readonly name: string;
  /** Exactly one record is the primary: the panel's domain. */
  readonly primary: boolean;
  readonly status: DomainStatus;
}

/** Why a domain name is refused. */
export class DomainError extends Error {
  readonly code: 'INVALID_DOMAIN' | 'DOMAIN_OVERLAP' | 'PUBLIC_SUFFIX' | 'SAME_REGISTRABLE_DOMAIN';

  constructor(message: string, code: DomainError['code']) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/**
 * Refuse anything but a base domain as the relay stores one: a lower-case
 * hostname ({@link HOSTNAME_REGEX}) — no wildcard, no trailing dot, no port.
 */
export function assertDomainName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !HOSTNAME_REGEX.test(name)) {
    throw new DomainError(`'${String(name)}' is not a domain name`, 'INVALID_DOMAIN');
  }
}

/** True when `host` is `domain` itself or a name under it. Both lower case. */
function isAtOrUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * What `host` holds before `.<domain>` — `feria` of `feria.codelama.com.tr`,
 * `a.b` of `a.b.codelama.com.tr` — or null when it is not under `domain`
 * (the apex included). Case-insensitive; the label comes lower case.
 */
export function labelUnder(host: string, domain: string): string | null {
  const lower = host.toLowerCase();
  const suffix = `.${domain.toLowerCase()}`;
  return lower.endsWith(suffix) && lower.length > suffix.length
    ? lower.slice(0, -suffix.length)
    : null;
}

/** A domain name as an API takes one: trimmed of case, then {@link assertDomainName}'s rule. */
export const DomainNameSchema = z
  .string()
  .max(253)
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(HOSTNAME_REGEX, 'Not a domain name'));

/**
 * True when two domains are one, or one is under the other. A browser sends
 * a domain's cookies to every host under it, so overlapping domains would
 * share one domain's session with the other's hosts: the relay never holds
 * two such domains.
 */
export function domainsOverlap(a: string, b: string): boolean {
  return isAtOrUnder(a, b) || isAtOrUnder(b, a);
}

/** Refuse `name` as a new domain beside `existing`: invalid, or overlapping one of them. */
export function assertDomainAddable(name: unknown, existing: readonly string[]): void {
  assertDomainName(name);
  const clash = existing.find((d) => domainsOverlap(name, d));
  if (clash !== undefined) {
    const why = clash === name ? 'is already a domain of this relay' : `overlaps '${clash}'`;
    throw new DomainError(`'${name}' ${why}`, 'DOMAIN_OVERLAP');
  }
}

/**
 * The domain `host` belongs to — the one it equals or is under — or null
 * when it belongs to none. Unambiguous because domains never overlap.
 * Hostnames compare case-insensitively.
 */
export function domainOfHost(host: string, domains: readonly string[]): string | null {
  const wanted = host.toLowerCase();
  return domains.find((d) => isAtOrUnder(wanted, d)) ?? null;
}

/**
 * True when `label` — the label just under a domain — is kept from tunnels,
 * sites, aliases and surfaces on every domain: the relay's own names and the
 * conventional ones ({@link RESERVED_SUBDOMAINS}), and the agent panel prefix
 * (an agent panel's own tunnel is the one exception, checked by its caller).
 */
export function isReservedLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return (
    (RESERVED_SUBDOMAINS as readonly string[]).includes(lower) ||
    lower.startsWith(AGENT_PANEL_SUBDOMAIN_PREFIX)
  );
}

/**
 * True when `host` is one the relay answers on itself, on any of `domains`:
 * `<panel|auth|tunnel>.<domain>` and the agent panels' `agent-<label>.<domain>`.
 * A custom site or an alias never takes one. The conventional names
 * (`www`, `mail`, …) are not among them: a custom site's alias may be
 * `www.<domain>`.
 */
export function isRelayHost(host: string, domains: readonly string[]): boolean {
  const domain = domainOfHost(host, domains);
  const label = domain === null ? null : labelUnder(host, domain);
  if (label === null || label.includes('.')) return false;
  return (
    (CORE_SUBDOMAINS as readonly string[]).includes(label) ||
    label.startsWith(AGENT_PANEL_SUBDOMAIN_PREFIX)
  );
}

// ---------------------------------------------------------------------------
// Gatekeeper's projection
// ---------------------------------------------------------------------------

/**
 * The file in the relay's data directory, next to `tunnels.json`, that
 * tells Gatekeeper who is a member of which domain. The panel writes it
 * (0600, atomic) from its directory whenever membership, a user or a domain
 * changes; Gatekeeper watches it and refuses every request it cannot read
 * it for.
 */
export const DOMAINS_PROJECTION_FILE = 'domains.json';

/** The kind of a domain membership: a member, or an external member who reaches only what names them. */
export type MembershipKind = 'member' | 'external';

/** Every membership kind, in the order the panel lists them. */
export const MEMBERSHIP_KINDS: readonly MembershipKind[] = ['member', 'external'];

/** One domain of the projection: its active members and active external members (usernames). */
export interface DomainsProjectionDomain {
  readonly name: string;
  readonly members: readonly string[];
  readonly externals: readonly string[];
}

/**
 * What {@link DOMAINS_PROJECTION_FILE} holds: the active domains with their
 * active members and external members. Version 2 — Gatekeeper reads no
 * other (a version-1 file, which says nothing of kinds, is no projection).
 */
export interface DomainsProjection {
  readonly v: 2;
  readonly domains: readonly DomainsProjectionDomain[];
}

/** A list of Lamaste usernames, else null. */
function usernameList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((m) => isLamasteUsername(m))
    ? [...(value as string[])]
    : null;
}

/**
 * The projection in `parsed` (a parsed `domains.json`), or null when it is
 * not one — Gatekeeper then admits nobody. Domains must be valid and must
 * not overlap; members and external members are Lamaste usernames, and no
 * one is both on one domain.
 */
export function parseDomainsProjection(parsed: unknown): DomainsProjection | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, domains } = parsed as { v?: unknown; domains?: unknown };
  if (v !== 2 || !Array.isArray(domains)) return null;
  const out: DomainsProjectionDomain[] = [];
  for (const entry of domains as unknown[]) {
    if (!entry || typeof entry !== 'object') return null;
    const { name, members, externals } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !HOSTNAME_REGEX.test(name)) return null;
    if (out.some((d) => domainsOverlap(d.name, name))) return null;
    const memberList = usernameList(members);
    const externalList = usernameList(externals);
    if (!memberList || !externalList) return null;
    const memberSet = new Set(memberList);
    if (externalList.some((x) => memberSet.has(x))) return null;
    out.push({ name, members: memberList, externals: externalList });
  }
  return { v: 2, domains: out };
}

/** A projection indexed for lookups: its domain names, each one's people with their kind. */
export interface DomainsIndex {
  readonly names: readonly string[];
  readonly kinds: ReadonlyMap<string, ReadonlyMap<string, MembershipKind>>;
}

/** Index a projection once (Gatekeeper does when it reads `domains.json`). */
export function indexDomainsProjection(projection: DomainsProjection): DomainsIndex {
  return {
    names: projection.domains.map((d) => d.name),
    kinds: new Map(
      projection.domains.map((d) => [
        d.name,
        new Map<string, MembershipKind>([
          ...d.members.map((m) => [m, 'member'] as const),
          ...d.externals.map((x) => [x, 'external'] as const),
        ]),
      ]),
    ),
  };
}

/**
 * The domain `host` is under (null: none) and the kind of `username`'s
 * membership of it (null: not one).
 */
export function domainMembership(
  index: DomainsIndex,
  host: string,
  username: string,
): { readonly domain: string | null; readonly kind: MembershipKind | null } {
  const domain = domainOfHost(host, index.names);
  return { domain, kind: (domain !== null && index.kinds.get(domain)?.get(username)) || null };
}
