/**
 * Shared constants — single source of truth for reserved API prefixes,
 * base capability names, curated plugin catalog, and reserved navigation labels.
 */

// ---------------------------------------------------------------------------
// Reserved API prefixes
// ---------------------------------------------------------------------------

/**
 * Core API route prefixes reserved from plugin use.
 * Shared across plugin installation, plugin routing, and ticket scope registration.
 */
export const RESERVED_API_PREFIXES = [
  'health',
  'onboarding',
  'invite',
  'enroll',
  'tunnels',
  'sites',
  'system',
  'services',
  'logs',
  'users',
  'certs',
  'invitations',
  'plugins',
  'tickets',
  'settings',
  'identity',
  'storage',
  'agents',
  'user-access',
  'gatekeeper',
  'audit',
  'notifications',
] as const;

export type ReservedApiPrefix = (typeof RESERVED_API_PREFIXES)[number];

// ---------------------------------------------------------------------------
// Reserved navigation labels
// ---------------------------------------------------------------------------

/**
 * Display names reserved for core panel navigation.
 * Plugin `displayName` must not match any of these (case-insensitive).
 */
export const RESERVED_NAV_LABELS = [
  'dashboard',
  'tunnels',
  'static sites',
  'users',
  'certificates',
  'services',
  'plugins',
  'documentation',
  'tickets',
  'settings',
] as const;

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Base capabilities that can be assigned to agent certificates.
 * `tunnels:read` is always-on (mandatory baseline for all agents).
 *
 * These are the only `<scope>:<action>` capabilities recognized by the core.
 * Plugin and ticket-scope capabilities live in their own `plugin:*` namespace
 * (see {@link PLUGIN_CAPABILITY_NAMESPACE} and
 * {@link pluginCapabilityRegexFor}). Plugins MUST NOT shadow any core
 * capability or invent a new top-level namespace.
 */
export const BASE_CAPABILITIES = [
  'tunnels:read',
  'tunnels:write',
  'services:read',
  'services:write',
  'system:read',
  'sites:read',
  'sites:write',
  'panel:expose',
  'identity:read',
  'identity:query',
] as const;

export type BaseCapability = (typeof BASE_CAPABILITIES)[number];

/**
 * Top-level scopes owned by the core. Capability strings whose first
 * segment matches one of these are reserved — plugins cannot declare them.
 *
 * `admin` is included even though there is no `admin:*` base capability,
 * because that scope name is intuitively reserved for future use and any
 * plugin claiming `admin:write` would be a security red flag.
 */
export const CORE_CAPABILITY_NAMESPACES = [
  'admin',
  'tunnels',
  'services',
  'system',
  'sites',
  'panel',
  'identity',
] as const;

export type CoreCapabilityNamespace = (typeof CORE_CAPABILITY_NAMESPACES)[number];

/**
 * Top-level prefix for all plugin- and ticket-scope-contributed capabilities.
 * Format: `plugin:<short-name>:<action>`, where `<short-name>` is the value
 * returned by `derivePluginRoute(manifest.name)` (also the panel/api route
 * segment). `<action>` is lowercase alphanumeric with optional hyphens.
 */
export const PLUGIN_CAPABILITY_NAMESPACE = 'plugin' as const;

/**
 * Regex matching any well-formed plugin capability — `plugin:<route>:<action>`.
 * Use {@link pluginCapabilityRegexFor} when you need to bind to a specific
 * plugin's route.
 */
export const PLUGIN_CAPABILITY_REGEX =
  /^plugin:[a-z0-9]([a-z0-9-]*[a-z0-9])?:[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Build the regex for capabilities owned by a specific plugin route.
 * The route is interpolated as a literal — caller must ensure it has been
 * validated (lowercase alphanumeric + hyphens). The action segment uses
 * the same charset as {@link PLUGIN_CAPABILITY_REGEX}.
 */
export function pluginCapabilityRegexFor(route: string): RegExp {
  // Defense-in-depth: refuse to build a regex from an unsafe route. The caller
  // should have validated already; this catches programmer error rather than
  // an attacker (route comes from manifest.name → derivePluginRoute).
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(route)) {
    throw new Error(`Invalid plugin route for capability regex: "${route}"`);
  }
  return new RegExp(`^plugin:${route}:[a-z0-9]([a-z0-9-]*[a-z0-9])?$`);
}

// ---------------------------------------------------------------------------
// Plugin route derivation
// ---------------------------------------------------------------------------

/**
 * Derive a plugin's short route segment from either an npm package name
 * (`@lamalibre/herd-server`) or a bare manifest name (`herd`). Strips the
 * `@lamalibre/` scope and the `-server` / `-agent` suffix.
 *
 * The result is the canonical short identifier used for:
 *   - panel/api routing (`/api/<route>`, `/<route>/...`)
 *   - capability namespacing (`plugin:<route>:<action>`)
 *   - reserved-route bookkeeping
 *
 * Lives in the root constants module because both the schema layer (manifest
 * validation) and the server subpath (tunnel routing) consume it. Re-exported
 * from `@lamalibre/lamaste/server` for backwards-compatible imports.
 */
export function derivePluginRoute(pluginNameOrPackage: string): string {
  return pluginNameOrPackage.replace(/^@lamalibre\//, '').replace(/-(server|agent)$/, '');
}

/**
 * Agent label format — a DNS label: lowercase alphanumerics and hyphens,
 * 1–63 characters, no leading or trailing hyphen. Labels become the
 * `agent-<label>` chisel user and the `agent-<label>` panel subdomain, so the
 * DNS-label shape is load-bearing, not cosmetic.
 */
export const AGENT_LABEL_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A fully qualified host name as the relay stores and checks one: lower-case
 * DNS labels (each {@link AGENT_LABEL_REGEX}'s shape), at least two, at most
 * 253 characters in all.
 */
export const HOSTNAME_REGEX =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Lamaste username format — the rule of the users and invitations APIs: a
 * lowercase letter or digit, then lowercase letters, digits, `_` and `-`,
 * {@link USERNAME_MIN_LENGTH}–{@link USERNAME_MAX_LENGTH} characters in
 * all. A leading `-` would read as a flag to Authelia's CLI when a TOTP
 * secret is stored for the user. The identity contract (`identity.ts`) and
 * the `user` caller of caller assertions name users by it too.
 */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 32;

/** Whether `value` is a Lamaste username: {@link USERNAME_REGEX}, within its lengths. */
export function isLamasteUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= USERNAME_MIN_LENGTH &&
    value.length <= USERNAME_MAX_LENGTH &&
    USERNAME_REGEX.test(value)
  );
}

/**
 * Loopback ports on the relay that belong to Lamaste's own services and can
 * never be a tunnel port: the panel server (3100), the chisel server (9090),
 * Authelia (9091), the IP-based panel listener (9292) and Gatekeeper (9294).
 *
 * A tunnel's vhost proxies to `127.0.0.1:<port>` on the relay. Were one of
 * these ports allowed, a tunnel hostname would publish that internal service
 * on the internet — the panel API behind it trusts nginx-supplied client
 * certificate headers, so this is an administrator takeover, not a leak.
 * Enforced in the tunnel workflow, in the request schemas, and again when the
 * chisel grants are rendered.
 */
export const RESERVED_TUNNEL_PORTS: readonly number[] = Object.freeze([
  3100, 9090, 9091, 9292, 9294,
]);

/**
 * Relay-loopback ports Lamaste assigns to internal plugin tunnels — the
 * tunnels that carry an agent-hosted plugin's admin API from its hosting
 * agent to the panel's forwarder. Lamaste picks the lowest free port of the
 * range when the plugin is hosted; the range sits above the hand-planned
 * application ports (blocks of ten from 20000) and below Linux's ephemeral
 * range, and no tunnel created by hand may use it, so the two never collide.
 * A tunnel created before this range existed keeps its port.
 */
export const INTERNAL_PLUGIN_PORT_RANGE = Object.freeze({ min: 21000, max: 21999 });

/** True when `port` lies in {@link INTERNAL_PLUGIN_PORT_RANGE}. */
export function isInternalPluginPort(port: number): boolean {
  return (
    Number.isInteger(port) &&
    port >= INTERNAL_PLUGIN_PORT_RANGE.min &&
    port <= INTERNAL_PLUGIN_PORT_RANGE.max
  );
}

/**
 * True when `port` may carry a tunnel created by hand (1024–65535, not a
 * reserved Lamaste port, not in the internal plugin range).
 */
export function isTunnelPortAllowed(port: number): boolean {
  return (
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535 &&
    !RESERVED_TUNNEL_PORTS.includes(port) &&
    !isInternalPluginPort(port)
  );
}

/**
 * The action segment of the capability that marks an agent as the hosting
 * agent of a plugin: `plugin:<route>:host`. It is never declared in a
 * manifest — Lamaste contributes it for every installed agent-hosted plugin
 * that has an `agent` block, grants it to the hosting agent's certificate,
 * and only that certificate may fetch the plugin's installation secret. It
 * does not admit calls to the plugin's forwarded API.
 */
export const PLUGIN_HOST_ACTION = 'host';

/** `plugin:<route>:host` for the plugin whose route is `route`. */
export function pluginHostCapability(route: string): string {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(route)) {
    throw new Error(`Invalid plugin route for host capability: "${route}"`);
  }
  return `${PLUGIN_CAPABILITY_NAMESPACE}:${route}:${PLUGIN_HOST_ACTION}`;
}

/**
 * The subdomains of the base domain the relay itself serves: the panel,
 * the Authelia portal and the chisel endpoint. They are the only names
 * onboarding issues certificates for, so they are the only names onboarding
 * requires to resolve to the relay — the base domain's apex may stay with
 * another host until a site is put on it.
 */
export const CORE_SUBDOMAINS = ['panel', 'auth', 'tunnel'] as const;

/**
 * Subdomains no tunnel or site may take: the relay's own
 * ({@link CORE_SUBDOMAINS}) and the names a domain conventionally keeps for
 * other services.
 */
export const RESERVED_SUBDOMAINS = [...CORE_SUBDOMAINS, 'www', 'mail', 'ftp', 'api'] as const;

/**
 * The subdomain prefix kept for agent panel tunnels (`agent-<label>`): no
 * other tunnel and no site starts with it.
 */
export const AGENT_PANEL_SUBDOMAIN_PREFIX = 'agent-';

/**
 * The Let's Encrypt registration email the relay accepts — the exact rule the
 * root-owned `lamaste-certbot` wrapper enforces before calling certbot, so the
 * panel rejects at onboarding what certbot issuance would later refuse. The
 * local part starts with a letter or digit (never `-`, which certbot would
 * parse as a flag); the TLD may be punycode.
 */
export const LETSENCRYPT_EMAIL_REGEX =
  /^(?=.{3,254}$)[A-Za-z0-9][A-Za-z0-9._%+'-]{0,63}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

/**
 * The Chisel release every Lamaste server and agent runs, pinned by version
 * and by the SHA-256 of each release asset (the `.gz` files published on
 * GitHub). Downloads are verified against these digests before anything is
 * unpacked, and an installed binary reporting another version is replaced.
 *
 * 1.12.0 is the first release whose `--authfile` reload survives atomic
 * renames and re-checks a user's grants on every new tunnel, which is what
 * lets the relay grant a new tunnel port without restarting chisel.
 */
export const CHISEL_RELEASE = Object.freeze({
  version: '1.12.0',
  sha256: Object.freeze({
    linux_amd64: 'f3f180f1d93aa72cce4e6386f98cc06569a0146fbd65eb4423cf83e6434bcfe6',
    linux_arm64: '2ec6152cd2c74fe0146d4d79e4e7aa174521368c56e433d55e023a92ea404ec3',
    darwin_amd64: '4aeae36c867f11c8e8c3f2b913a0e063ea3c6d29e1c14a52ed2e6eef8cfc4395',
    darwin_arm64: '707a4b932eea214765146504a0df246cefc415b4297af65a80dd67cf69ba85a9',
  }),
});

export type ChiselArch = keyof typeof CHISEL_RELEASE.sha256;

/** Download URL of the pinned Chisel release asset for `arch`. */
export function chiselAssetUrl(arch: ChiselArch): string {
  const v = CHISEL_RELEASE.version;
  return `https://github.com/jpillora/chisel/releases/download/v${v}/chisel_${v}_${arch}.gz`;
}

/**
 * The Authelia release every Lamaste server runs, pinned by version and by
 * the SHA-256 of each release tarball published on GitHub. The installer
 * verifies the download against these digests before unpacking it. The
 * configuration the panel writes (`identity_validation`, `session.cookies`,
 * `server.address`) needs 4.38 or later.
 */
export const AUTHELIA_RELEASE = Object.freeze({
  version: '4.39.28',
  sha256: Object.freeze({
    'linux-amd64': 'e8ad9ff965cbf3b93138945e13cb4b7874c999c254772b2bb77952863177699c',
    'linux-arm64': '089f3f8bdcba962024e15283811256cea28032d1cdccc56cf4e4c1b284022faa',
  }),
});

export type AutheliaArch = keyof typeof AUTHELIA_RELEASE.sha256;

/** Download URL of the pinned Authelia release tarball for `arch`. */
export function autheliaAssetUrl(arch: AutheliaArch): string {
  const v = AUTHELIA_RELEASE.version;
  return `https://github.com/authelia/authelia/releases/download/v${v}/authelia-v${v}-${arch}.tar.gz`;
}

/**
 * The mandatory capability every regular agent receives.
 */
export const DEFAULT_AGENT_CAPABILITY: BaseCapability = 'tunnels:read';

/**
 * CN prefix for plugin-agent certificates.
 * Full CN format: `plugin-agent:<delegatingLabel>:<pluginAgentLabel>`
 */
export const PLUGIN_AGENT_CN_PREFIX = 'plugin-agent:';

// ---------------------------------------------------------------------------
// Plugin modes
// ---------------------------------------------------------------------------

/**
 * Valid plugin execution modes.
 */
export const PLUGIN_MODES = ['server', 'agent', 'local'] as const;

export type PluginMode = (typeof PLUGIN_MODES)[number];

/**
 * Default modes when a plugin manifest omits the `modes` field.
 */
export const DEFAULT_PLUGIN_MODES: readonly PluginMode[] = ['server', 'agent'];

// ---------------------------------------------------------------------------
// Plugin hosting
// ---------------------------------------------------------------------------

/**
 * Where a plugin's code runs (manifest `hosting`).
 *
 * - `'server'` — the plugin host imports its server package and mounts its
 *   routes (every plugin before 4.2).
 * - `'agent'`  — the application runs on an agent of its own, behind a
 *   Lamaste tunnel. Lamaste never imports or mounts its code, wherever the
 *   package is installed; it registers only what the manifest declares
 *   (OIDC clients, capabilities).
 */
export const PLUGIN_HOSTINGS = ['server', 'agent'] as const;

export type PluginHosting = (typeof PLUGIN_HOSTINGS)[number];

/** Hosting of a manifest that omits the field. */
export const DEFAULT_PLUGIN_HOSTING: PluginHosting = 'server';

/**
 * Whether a manifest or registry entry is agent-hosted. A registry entry
 * written before 4.2 has no `hosting` and is a server plugin.
 */
export function isAgentHostedPlugin(plugin: { readonly hosting?: string | undefined }): boolean {
  return plugin.hosting === 'agent';
}

/**
 * Whether an agent-hosted plugin has an *agent half* Lamaste connects to:
 * its manifest carries an `agent` block. Such a plugin can be hosted on an
 * agent (internal tunnel, installation secret, forwarded admin API) and may
 * declare panel pages, served through the forwarder. An agent-hosted plugin
 * without the block is identity only (slice 1), as Feria is.
 */
export function hasAgentHalf(plugin: {
  readonly hosting?: string | undefined;
  readonly agent?: object | null | undefined;
}): boolean {
  return isAgentHostedPlugin(plugin) && plugin.agent !== undefined && plugin.agent !== null;
}

// ---------------------------------------------------------------------------
// Curated plugins
// ---------------------------------------------------------------------------

export interface CuratedPlugin {
  readonly name: string;
  readonly packageName: string;
  readonly description: string;
  readonly icon: string;
}

/**
 * Official curated plugin catalog.
 * Used by the desktop app and local plugin host for plugin discovery.
 */
export const CURATED_PLUGINS: readonly CuratedPlugin[] = [
  {
    name: 'herd',
    packageName: '@lamalibre/herd-server',
    description: 'Zero-config LLM inference pooling',
    icon: 'cpu',
  },
  {
    name: 'shell',
    packageName: '@lamalibre/shell-server',
    description: 'Secure remote terminal via tmux',
    icon: 'terminal',
  },
  {
    name: 'sync',
    packageName: '@lamalibre/sync-server',
    description: 'Bidirectional file sync',
    icon: 'folder',
  },
  {
    name: 'gate',
    packageName: '@lamalibre/gate-server',
    description: 'VPN tunnel management',
    icon: 'shield',
  },
  {
    name: 'caravana',
    packageName: '@lamalibre/caravana-server',
    description: 'Autonomous feature development — backlog to branch via VM + Claude',
    icon: 'rocket',
  },
  {
    name: 'nerd',
    packageName: '@lamalibre/nerd-server',
    description: 'Code analysis and codebase understanding',
    icon: 'search',
  },
  {
    name: 'rodeo',
    packageName: '@lamalibre/rodeo-serverd',
    description: 'Shared e2e test execution with tiered VM snapshots',
    icon: 'flask-conical',
  },
  {
    name: 'shepherd',
    packageName: '@lamalibre/shepherd-server',
    description: 'Skill registry and scope manager for Claude Code workflows',
    icon: 'book-open',
  },
  {
    name: 'spit',
    packageName: '@lamalibre/spit-server',
    description: 'End-to-end encrypted chat with store-and-forward delivery',
    icon: 'message-circle',
  },
] as const;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Maximum number of plugins per registry (agent or local).
 */
export const MAX_PLUGINS_PER_REGISTRY = 20;

/**
 * Cache TTL (ms) for the disabled-plugin set in plugin routers.
 */
export const DISABLED_PLUGIN_CACHE_TTL_MS = 5000;

/**
 * Cache TTL (ms) for panel bundle responses.
 */
export const PANEL_BUNDLE_CACHE_SECONDS = 3600;
