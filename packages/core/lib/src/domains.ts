/**
 * The base domains a relay serves (the multi-domain relay,
 * `packages/core/docs/multi-domain-relay-design.md`).
 *
 * One domain is the primary — the panel's (`panel.`, `tunnel.`, agent
 * panels); every other one only serves tunnels, sites and surfaces under it,
 * with its own sign-in at `auth.<domain>` and its own member list. Pure: the
 * panel keeps the records (`state.db`), Gatekeeper reads a projection of
 * them, and both decide a hostname's domain here.
 */

import {
  AGENT_PANEL_SUBDOMAIN_PREFIX,
  CORE_SUBDOMAINS,
  HOSTNAME_REGEX,
  RESERVED_SUBDOMAINS,
  isLamasteUsername,
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
  readonly code: 'INVALID_DOMAIN' | 'DOMAIN_OVERLAP';

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
  const lower = host.toLowerCase();
  const domain = domainOfHost(lower, domains);
  if (domain === null || lower === domain) return false;
  const label = lower.slice(0, -(domain.length + 1));
  if (label.includes('.')) return false;
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

/** What {@link DOMAINS_PROJECTION_FILE} holds: the active domains and their active members. */
export interface DomainsProjection {
  readonly v: 1;
  readonly domains: ReadonlyArray<{ readonly name: string; readonly members: readonly string[] }>;
}

/**
 * The projection in `parsed` (a parsed `domains.json`), or null when it is
 * not one — Gatekeeper then admits nobody. Domains must be valid and must
 * not overlap; members are Lamaste usernames.
 */
export function parseDomainsProjection(parsed: unknown): DomainsProjection | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, domains } = parsed as { v?: unknown; domains?: unknown };
  if (v !== 1 || !Array.isArray(domains)) return null;
  const out: Array<{ name: string; members: string[] }> = [];
  for (const entry of domains as unknown[]) {
    if (!entry || typeof entry !== 'object') return null;
    const { name, members } = entry as { name?: unknown; members?: unknown };
    if (typeof name !== 'string' || !HOSTNAME_REGEX.test(name)) return null;
    if (out.some((d) => domainsOverlap(d.name, name))) return null;
    if (!Array.isArray(members) || !members.every((m) => isLamasteUsername(m))) return null;
    out.push({ name, members: [...(members as string[])] });
  }
  return { v: 1, domains: out };
}

/**
 * Whether `username` is a member of the domain `host` is under:
 * `member`, `not_member`, or `no_domain` for a host under none of them.
 */
export function domainMembership(
  projection: DomainsProjection,
  host: string,
  username: string,
): 'member' | 'not_member' | 'no_domain' {
  const name = domainOfHost(
    host,
    projection.domains.map((d) => d.name),
  );
  if (name === null) return 'no_domain';
  const domain = projection.domains.find((d) => d.name === name);
  return domain?.members.includes(username) ? 'member' : 'not_member';
}
