/**
 * The Authelia groups Lamaste owns (packages/core/docs/external-members-design.md).
 *
 * Who may reach what is written into `users.yml` as groups, and the rules in
 * Authelia's configuration name those groups: Authelia watches the users
 * file and applies a change at each user's next request, so a membership,
 * a kind, a grant or a site's `allowedUsers` changes without a restart.
 *
 * - `lamaste:member@<domain>` — the domain's active members;
 * - `lamaste:external@<domain>` — its active external members;
 * - `lamaste:oidc@<client id>` — external members of the client's domain
 *   granted the OIDC client;
 * - `<hostname>` (a **host group**) — the people named on that host: the
 *   listed users of a protected static site, or the external members granted
 *   a Gatekeeper-gated restricted host. Authelia's `domain_regex` with a
 *   `(?P<Group>…)` capture admits a user on a host whose name is one of
 *   their groups.
 *
 * `:` and `@` never occur in a hostname, and a host group is always a
 * hostname under a relay domain, so the two kinds cannot be mistaken for each
 * other. Groups an administrator assigns (`admins`, `feria-admins`) match
 * {@link ADMIN_GROUP_NAME_RE} and are never owned. Pure; browser-safe.
 */

import { isLamasteUsername, isOidcClientId } from './constants.js';
import { assertDomainName, domainOfHost } from './domains.js';

/** The prefix of every Lamaste-owned group that is not a hostname. */
export const OWNED_GROUP_PREFIX = 'lamaste:';

/**
 * What a group an administrator assigns must be: letters, digits, `_` and
 * `-`, 1–64 characters. A name with `.`, `:` or `@` could be a hostname or
 * one of Lamaste's own groups, which grant access by name.
 */
export const ADMIN_GROUP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether `name` may be assigned to a user as an Authelia group by an administrator. */
export function isAssignableGroupName(name: unknown): name is string {
  return typeof name === 'string' && ADMIN_GROUP_NAME_RE.test(name);
}

/** `lamaste:member@<domain>`. */
export function memberGroup(domain: string): string {
  assertDomainName(domain);
  return `${OWNED_GROUP_PREFIX}member@${domain}`;
}

/** `lamaste:external@<domain>`. */
export function externalGroup(domain: string): string {
  assertDomainName(domain);
  return `${OWNED_GROUP_PREFIX}external@${domain}`;
}

/** `lamaste:oidc@<client id>`. */
export function oidcClientGroup(clientId: string): string {
  if (!isOidcClientId(clientId)) throw new Error('Not an OIDC client id');
  return `${OWNED_GROUP_PREFIX}oidc@${clientId}`;
}

/**
 * Whether `group` is Lamaste's: it starts with `lamaste:`, or it is a
 * hostname equal to or under one of `domains` (every domain record,
 * pending ones too — so a host group of a domain not yet active cannot be
 * planted ahead of it). Case-insensitive, as Authelia compares groups.
 */
export function isLamasteOwnedGroup(group: string, domains: readonly string[]): boolean {
  const lower = group.toLowerCase();
  return lower.startsWith(OWNED_GROUP_PREFIX) || domainOfHost(lower, domains) !== null;
}

/** One active domain and its active people by kind. */
export interface OwnedGroupsDomain {
  readonly name: string;
  readonly members: readonly string[];
  readonly externals: readonly string[];
}

/** A hostname and the usernames named on it. */
export interface OwnedGroupsHost {
  readonly fqdn: string;
  readonly users: readonly string[];
}

/** An OIDC client, its domain and the usernames granted it. */
export interface OwnedGroupsClient {
  readonly clientId: string;
  readonly domain: string;
  readonly users: readonly string[];
}

/** Everything the owned groups are rendered from. */
export interface OwnedGroupsInput {
  /** The active domains with their active members and external members. */
  readonly domains: readonly OwnedGroupsDomain[];
  /** Protected static sites with an `allowedUsers` list. */
  readonly sites: readonly OwnedGroupsHost[];
  /** Gatekeeper-gated restricted hosts with the users granted each (Lamaste groups expanded). */
  readonly hostGrants: readonly OwnedGroupsHost[];
  /** User-facing OIDC clients with the users granted each (Lamaste groups expanded). */
  readonly clientGrants: readonly OwnedGroupsClient[];
}

function assertUsername(username: string): void {
  // Never the value itself: the message can reach logs and warnings.
  if (!isLamasteUsername(username)) throw new Error('A user is not a Lamaste username');
}

/**
 * The Lamaste-owned groups each user should hold, sorted, keyed by username
 * (users who should hold none are absent):
 *
 * - members and external members get their domain's group;
 * - a static site's host group: its listed users who are members or
 *   external members of the site's domain (a site under no active domain
 *   names nobody);
 * - a restricted host's group and an OIDC client's group: the granted users
 *   who are **external** members of its domain — members reach those through
 *   their domain's group already.
 *
 * Throws on a username that is not a Lamaste username and on a user who is
 * both a member and an external member of one domain. Pure.
 */
export function renderOwnedGroups(input: OwnedGroupsInput): Map<string, string[]> {
  const names = input.domains.map((d) => d.name);
  const people = new Map<string, { members: Set<string>; externals: Set<string> }>();
  const out = new Map<string, Set<string>>();
  const give = (username: string, group: string): void => {
    let set = out.get(username);
    if (!set) out.set(username, (set = new Set()));
    set.add(group);
  };

  for (const domain of input.domains) {
    const members = new Set(domain.members);
    const externals = new Set(domain.externals);
    for (const username of [...members, ...externals]) assertUsername(username);
    if ([...externals].some((x) => members.has(x))) {
      throw new Error(`A user is both a member and an external member of ${domain.name}`);
    }
    people.set(domain.name, { members, externals });
    for (const m of members) give(m, memberGroup(domain.name));
    for (const x of externals) give(x, externalGroup(domain.name));
  }

  /** The people of `host`'s domain that `admit` keeps, among `users`. */
  const named = (
    host: string,
    users: readonly string[],
    admit: (p: { members: Set<string>; externals: Set<string> }, u: string) => boolean,
  ): string[] => {
    const domain = domainOfHost(host, names);
    const p = domain === null ? undefined : people.get(domain);
    if (!p) return [];
    return users.filter((u) => {
      assertUsername(u);
      return admit(p, u);
    });
  };

  for (const site of input.sites) {
    const fqdn = site.fqdn.toLowerCase();
    for (const u of named(fqdn, site.users, (p, u) => p.members.has(u) || p.externals.has(u))) {
      give(u, fqdn);
    }
  }
  for (const host of input.hostGrants) {
    const fqdn = host.fqdn.toLowerCase();
    for (const u of named(fqdn, host.users, (p, u) => p.externals.has(u))) give(u, fqdn);
  }
  for (const client of input.clientGrants) {
    const group = oidcClientGroup(client.clientId);
    const p = people.get(client.domain);
    for (const u of client.users) {
      assertUsername(u);
      if (p?.externals.has(u)) give(u, group);
    }
  }

  return new Map([...out].map(([u, groups]) => [u, [...groups].sort()]));
}

/** A users-file entry, as far as its groups go. */
export interface GroupsHolder {
  groups?: unknown;
  [k: string]: unknown;
}

/**
 * `users` (the users map of `users.yml`) with exactly the Lamaste-owned
 * groups of `desired` ({@link renderOwnedGroups}): every owned group a user
 * holds that is not desired goes — a stray host group cannot survive — and
 * every desired one is added after the administrator's groups, which keep
 * their order. `domains` are every domain record (see
 * {@link isLamasteOwnedGroup}). A desired user the file does not hold is
 * skipped. `changed` says whether any entry differs; entries that do not
 * are the same objects. Pure — `users` is not modified.
 */
export function mergeOwnedGroups<T extends GroupsHolder>(
  users: Readonly<Record<string, T>>,
  desired: ReadonlyMap<string, readonly string[]>,
  domains: readonly string[],
): { readonly users: Record<string, T>; readonly changed: boolean } {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [username, entry] of Object.entries(users)) {
    const before: readonly unknown[] = Array.isArray(entry.groups) ? entry.groups : [];
    const next = [
      ...before.filter(
        (g): g is string => typeof g === 'string' && !isLamasteOwnedGroup(g, domains),
      ),
      ...(desired.get(username) ?? []),
    ];
    if (next.length === before.length && next.every((g, i) => before[i] === g)) {
      out[username] = entry;
    } else {
      changed = true;
      out[username] = { ...entry, groups: next };
    }
  }
  return { users: out, changed };
}
