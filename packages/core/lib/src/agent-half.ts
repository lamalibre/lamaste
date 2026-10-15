/**
 * The agent half of an agent-hosted plugin as Lamaste installs it onto an
 * agent (slice 3): the manifest declares a package and a service, the relay
 * pins the package's version and tarball integrity when it stages the
 * plugin, and the agent's root helper `lamaste-apphost` installs exactly
 * that tarball and runs it as a hardened systemd service under an account of
 * its own. See `plugin-development/design/agent-hosted-app-plugins.md`,
 * "Slice 3 as planned".
 *
 * **The agent half ships bundled.** One self-contained tarball — no runtime
 * dependencies, no install scripts — so the integrity the relay pins is the
 * whole code that runs, and nothing is compiled or fetched as root.
 *
 * Every name and path here is derived from the plugin's route, and the root
 * helper derives the same ones itself (it never takes a path from its
 * caller). They are fixed, not branded: the helper is a self-contained
 * script that does not read `LAMALIBRE_ORG`, so these values must not move
 * with it either.
 */

import crypto from 'node:crypto';

import semver from 'semver';
import { z } from 'zod';

import { AGENT_LABEL_REGEX } from './constants.js';
import type { ParsedManifest } from './schemas.js';

// ---------------------------------------------------------------------------
// Validation primitives (the manifest's `agent` block is built from these)
// ---------------------------------------------------------------------------

/**
 * A plugin route the app host helper accepts: what it names accounts, units
 * and directories after. A route is derived from the plugin's name, which is
 * at most 100 characters.
 */
export const APPHOST_ROUTE_RE = /^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/;

/** npm Subresource Integrity of the agent package's tarball (SHA-512). */
export const AGENT_HALF_INTEGRITY_RE = /^sha512-[A-Za-z0-9+/]{86}==$/;

/** The version of an installed agent half: plain semver, no build metadata (as the helper checks it). */
const AGENT_HALF_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** A system package the agent half needs (Debian's naming rules). */
export const SystemPackageNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9+.-]*$/, 'System package names are lowercase');

/** The agent half's package: an `@lamalibre/` package published at the plugin's version. */
export const AgentHalfPackageNameSchema = z
  .string()
  .max(214)
  .regex(
    /^@lamalibre\/[a-z0-9][a-z0-9-]*$/,
    'The agent package is an @lamalibre/ package (lowercase letters, digits and hyphens)',
  );

/**
 * The agent half's service entry: a path inside the package to a `.js`,
 * `.mjs` or `.cjs` file — relative, with no `..`, no `.` segment and no
 * empty segment.
 */
export const AgentServiceEntrySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!(?:.*\/)?\.\/)[A-Za-z0-9._/-]+\.(?:mjs|cjs|js)$/,
    'entry is a relative path to a .js, .mjs or .cjs file inside the package',
  );

/** The agent half's systemd `MemoryMax=`: a size in K, M or G. */
export const AgentServiceMemoryMaxSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,5}[KMG]$/, 'memoryMax is a size such as "512M" (K, M or G)');

/** A version of an agent half: semver without build metadata. */
export const AgentHalfVersionSchema = z
  .string()
  .max(100)
  .refine(
    (v) => AGENT_HALF_VERSION_RE.test(v) && semver.valid(v) === v,
    'The version is not a semver version (x.y.z or x.y.z-pre)',
  );

// ---------------------------------------------------------------------------
// Declaration and spec
// ---------------------------------------------------------------------------

/** The agent half as the manifest declares it, with every default applied. */
export interface AgentHalfDeclaration {
  readonly package: string;
  readonly service: { readonly entry: string; readonly memoryMax: string | null };
  /** `agent.requires.systemPackages`, sorted and without repeats; empty when none. */
  readonly systemPackages: readonly string[];
}

/** The agent half pinned for one version: what the approval binds and the agent installs. */
export interface AgentHalfSpec extends AgentHalfDeclaration {
  /** The plugin's version — the agent package is published at it. */
  readonly version: string;
  /** npm Subresource Integrity of the package tarball, `sha512-<base64>`. */
  readonly integrity: string;
}

/** Validates an {@link AgentHalfSpec} received from elsewhere (an agent job, a stored row). */
export const AgentHalfSpecSchema = z
  .object({
    package: AgentHalfPackageNameSchema,
    version: AgentHalfVersionSchema,
    integrity: z
      .string()
      .regex(AGENT_HALF_INTEGRITY_RE, 'integrity is the sha512 SRI of the package tarball'),
    service: z
      .object({
        entry: AgentServiceEntrySchema,
        memoryMax: AgentServiceMemoryMaxSchema.nullable(),
      })
      .strict(),
    systemPackages: z.array(SystemPackageNameSchema).max(50),
  })
  .strict();

/**
 * The agent half a manifest declares, or null when Lamaste does not install
 * one: a manifest with an `agent` block but no `agent.package` is hosted the
 * 2a way, its agent half installed by hand.
 */
export function agentHalfOf(manifest: Pick<ParsedManifest, 'agent'>): AgentHalfDeclaration | null {
  const agent = manifest.agent;
  if (agent?.package === undefined) return null;
  // The manifest schema requires both together; a record that holds one
  // without the other did not come from a validated manifest.
  if (agent.service === undefined) {
    throw new Error('The agent block names a package but no service');
  }
  return {
    package: agent.package,
    service: { entry: agent.service.entry, memoryMax: agent.service.memoryMax ?? null },
    systemPackages: [...new Set(agent.requires?.systemPackages ?? [])].sort(),
  };
}

// ---------------------------------------------------------------------------
// Names and paths on the agent
// ---------------------------------------------------------------------------

function appRoute(route: string): string {
  if (!APPHOST_ROUTE_RE.test(route)) throw new Error(`Invalid plugin route "${route}"`);
  return route;
}

/** systemd's strict limit for a user or group name (`User=` warns on longer names). */
export const APP_SERVICE_USER_MAX = 31;

/**
 * The system account (user and group) an agent half runs as. Two forms that
 * can never be equal:
 *
 * - `lamaste-app-<route>` while that is at most 30 characters (routes of up
 *   to 18) — readable in `ps`, the journal and file listings;
 * - otherwise `lamaste-app-<first 2 characters>-<16 hex digits of the
 *   route's SHA-256>`, always exactly 31 characters.
 *
 * The lengths keep the forms apart (no readable name equals a hashed one),
 * and 64 bits of hash make crafting a route whose hashed name equals
 * another's a 2^64 search — not 32 bits a GPU can afford. The helper
 * additionally records the owning route on the account
 * ({@link appServiceAccountComment}) and refuses an account that names
 * another, so even a collision could only be refused, never shared.
 */
export function appServiceUser(route: string): string {
  const name = `lamaste-app-${appRoute(route)}`;
  if (name.length < APP_SERVICE_USER_MAX) return name;
  const hash = crypto.createHash('sha256').update(route).digest('hex').slice(0, 16);
  return `lamaste-app-${route.slice(0, 2)}-${hash}`;
}

/**
 * The GECOS comment the helper gives an agent half's account: which route
 * owns it. An account with another comment (or none) is never reused,
 * chowned to or deleted by the helper.
 */
export function appServiceAccountComment(route: string): string {
  return `lamaste-app route=${appRoute(route)}`;
}

/** The system unit an agent half runs as. */
export function appUnitName(route: string): string {
  return `lamalibre-app-${appRoute(route)}.service`;
}

/** Where the app host helper and the agent halves it installs live on an agent. */
export const APPHOST_PATHS = Object.freeze({
  /** The root helper (root:root 0755). */
  helper: '/usr/local/sbin/lamaste-apphost',
  /** The one sudoers rule letting the agent's user run the helper (0440). */
  sudoers: '/etc/sudoers.d/lamaste-apphost',
  /** Installed versions (`<version>/`, root-owned, read-only) and the `current` symlink. */
  codeDir: (route: string): string => `/opt/lamalibre/apps/${appRoute(route)}`,
  /** The agent half's data (0700, owned by its account) — kept on removal unless purged. */
  dataDir: (route: string): string => `/var/lib/lamalibre/apps/${appRoute(route)}`,
  /** The agent half's configuration directory (0750 root:<its group>). */
  configDir: (route: string): string => `/etc/lamalibre/apps/${appRoute(route)}`,
  /** The plugin config (port, installation secret) — 0600, owned by its account. */
  configFile: (route: string): string =>
    `/etc/lamalibre/apps/${appRoute(route)}/plugin-config.json`,
  /**
   * Who owns the route on this machine (root 0644, outside the data the
   * agent half can write): the package and the agent label that installed
   * it. Kept with the data on removal; deleted by a purge.
   */
  ownerFile: (route: string): string => `/var/lib/lamalibre/apps/.owners/${appRoute(route)}.json`,
  /**
   * The relay keys the helper verifies app jobs with (root 0755): one file
   * per agent label on the machine, written by `sudo lamaste-agent apphost
   * enable|pin` from the relay that agent is enrolled with.
   */
  relaysDir: '/etc/lamalibre/apphost/relays',
  /** The relay key pinned for agent `label` (root 0644; public material). */
  relayPinFile: (label: string): string =>
    `/etc/lamalibre/apphost/relays/${agentLabel(label)}.json`,
  /** The app jobs the helper ran (root 0700), so none runs twice; kept until they expire. */
  jobsDir: '/var/lib/lamalibre/apps/.jobs',
});

function agentLabel(label: string): string {
  if (!AGENT_LABEL_REGEX.test(label)) throw new Error(`Invalid agent label "${label}"`);
  return label;
}

/** The protocol of `lamaste-apphost` this Lamaste speaks; an agent's helper must be at least this. */
export const APPHOST_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Approval preview
// ---------------------------------------------------------------------------

/** What the approval preview shows about an agent half Lamaste will install. */
export interface AgentHalfPreview {
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly entry: string;
  readonly memoryMax: string | null;
  /** Installed with apt-get once approved. */
  readonly systemPackages: readonly string[];
  readonly serviceUser: string;
  readonly unitName: string;
  /** Its data directory on the agent ({@link APPHOST_PATHS}`.dataDir`) — kept on removal unless purged. */
  readonly dataDir: string;
}

/** The approval preview of plugin `route`'s agent half. */
export function agentHalfPreview(route: string, spec: AgentHalfSpec): AgentHalfPreview {
  return {
    package: spec.package,
    version: spec.version,
    integrity: spec.integrity,
    entry: spec.service.entry,
    memoryMax: spec.service.memoryMax,
    systemPackages: [...new Set(spec.systemPackages)].sort(),
    serviceUser: appServiceUser(route),
    unitName: appUnitName(route),
    dataDir: APPHOST_PATHS.dataDir(route),
  };
}
