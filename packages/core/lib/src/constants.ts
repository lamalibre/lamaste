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
  return new RegExp(
    `^plugin:${route}:[a-z0-9]([a-z0-9-]*[a-z0-9])?$`,
  );
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
  return pluginNameOrPackage
    .replace(/^@lamalibre\//, '')
    .replace(/-(server|agent)$/, '');
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
