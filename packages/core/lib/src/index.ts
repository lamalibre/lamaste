/**
 * @lamalibre/lamaste — Core library
 *
 * Shared types, constants, schemas, plugin host Fastify plugin, and file helpers.
 *
 * Subpath exports:
 *   @lamalibre/lamaste/agent  — agent domain logic (~/.lamalibre/lamaste/)
 *   @lamalibre/lamaste/server — server domain logic (/etc/lamalibre/lamaste/)
 */

// Constants
export {
  RESERVED_API_PREFIXES,
  RESERVED_NAV_LABELS,
  BASE_CAPABILITIES,
  CORE_CAPABILITY_NAMESPACES,
  PLUGIN_CAPABILITY_NAMESPACE,
  PLUGIN_CAPABILITY_REGEX,
  pluginCapabilityRegexFor,
  derivePluginRoute,
  DEFAULT_AGENT_CAPABILITY,
  PLUGIN_AGENT_CN_PREFIX,
  PLUGIN_MODES,
  DEFAULT_PLUGIN_MODES,
  CURATED_PLUGINS,
  MAX_PLUGINS_PER_REGISTRY,
  DISABLED_PLUGIN_CACHE_TTL_MS,
  PANEL_BUNDLE_CACHE_SECONDS,
} from './constants.js';

export type {
  ReservedApiPrefix,
  BaseCapability,
  CoreCapabilityNamespace,
  PluginMode,
  CuratedPlugin,
} from './constants.js';

// Types
export type {
  PluginPanelPage,
  PluginPanelFlat,
  PluginPanelMulti,
  PluginPanel,
  PluginConfigEntry,
  PluginManifest,
  PluginStatus,
  PluginRegistryEntry,
  PluginRegistry,
  AdminClient,
  AgentClient,
} from './types.js';

// Schemas
export {
  CapabilityStringSchema,
  PanelPageSchema,
  ManifestSchema,
  LamaPackageNameSchema,
  validateManifest,
} from './schemas.js';

export type { ParsedManifest } from './schemas.js';

// File helpers
export {
  PromiseChainMutex,
  KeyedPromiseChainMutex,
  atomicWriteJSON,
  readJSONFile,
} from './file-helpers.js';

export type { AtomicWriteOptions } from './file-helpers.js';

// Plugin host
export { pluginHostPlugin, invalidatePluginHostCache } from './plugin-host.js';

export type {
  PluginHostAuthStrategy,
  PluginHostOptions,
} from './plugin-host.js';

// Branding primitives
export * from './branding.js';
