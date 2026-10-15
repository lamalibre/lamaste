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
  AGENT_LABEL_REGEX,
  RESERVED_TUNNEL_PORTS,
  isTunnelPortAllowed,
  INTERNAL_PLUGIN_PORT_RANGE,
  isInternalPluginPort,
  PLUGIN_HOST_ACTION,
  pluginHostCapability,
  hasAgentHalf,
  CORE_SUBDOMAINS,
  LETSENCRYPT_EMAIL_REGEX,
  CHISEL_RELEASE,
  chiselAssetUrl,
  AUTHELIA_RELEASE,
  autheliaAssetUrl,
  DEFAULT_AGENT_CAPABILITY,
  PLUGIN_AGENT_CN_PREFIX,
  PLUGIN_MODES,
  DEFAULT_PLUGIN_MODES,
  PLUGIN_HOSTINGS,
  DEFAULT_PLUGIN_HOSTING,
  isAgentHostedPlugin,
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
  PluginHosting,
  CuratedPlugin,
  ChiselArch,
  AutheliaArch,
} from './constants.js';

// Verified downloads of the pinned chisel / Authelia releases
export {
  curlDownloadArgs,
  normaliseChiselVersion,
  isPinnedChiselVersion,
  downloadVerifiedChisel,
  downloadVerifiedAuthelia,
  normaliseAutheliaVersion,
} from './chisel-download.js';

export type { FetchToFile } from './chisel-download.js';

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
  RetainedAgentData,
  AdminClient,
  AgentClient,
} from './types.js';

// Schemas
export {
  CapabilityStringSchema,
  PanelPageSchema,
  ManifestSchema,
  LamaPackageNameSchema,
  ManifestValidationError,
  validateManifest,
  AgentRequiresSchema,
  AgentBlockSchema,
  AgentServiceSchema,
  AGENT_HALF_OS,
  HostFactsSchema,
  OidcClientSchema,
  OIDC_GRANT_TYPES,
  OIDC_ACCESS_TOKEN_CLAIMS,
  OIDC_ACCESS_TOKEN_CLAIM_SCOPES,
  HooksBlockSchema,
  RequestHookSchema,
  RoutePatternSchema,
  SecretScanConfigSchema,
} from './schemas.js';

export type {
  ParsedManifest,
  AgentBlock,
  AgentRequires,
  HostFacts,
  HooksBlock,
  RequestHookDeclaration,
  OidcClientDeclaration,
  OidcGrantType,
  OidcAccessTokenClaim,
} from './schemas.js';

// Hook sets (lifecycle hooks of agent-hosted plugins; the contract itself is
// `@lamalibre/lamaste/hooks`)
export {
  HOOK_SET_DIGEST_VERSION,
  approvalDigest,
  agentHookSetOf,
  hookEntrySha256,
  relayHookSetDigest,
  relayHookSetNeedsEntry,
  relayHookSetOf,
  relayHookSetPackVersions,
  relayHookSetPreview,
} from './hook-set.js';

export type {
  AgentHookSet,
  AgentStageHook,
  ApprovalSubject,
  RelayHookSet,
  RelayHookSetPreview,
  RelayStageHook,
  RequestHook,
} from './hook-set.js';

// Agent halves Lamaste installs onto an agent (slice 3): the manifest's
// declaration, the pinned spec, the names and paths the agent's root helper
// derives, and which agents can host a plugin
export {
  APPHOST_PATHS,
  APPHOST_PROTOCOL_VERSION,
  APPHOST_ROUTE_RE,
  APP_SERVICE_USER_MAX,
  AGENT_HALF_INTEGRITY_RE,
  AgentHalfPackageNameSchema,
  AgentHalfSpecSchema,
  AgentHalfVersionSchema,
  AgentServiceEntrySchema,
  AgentServiceMemoryMaxSchema,
  SystemPackageNameSchema,
  agentHalfOf,
  agentHalfPreview,
  appServiceUser,
  appUnitName,
} from './agent-half.js';

export type { AgentHalfDeclaration, AgentHalfPreview, AgentHalfSpec } from './agent-half.js';

export { hostEligibility } from './host-eligibility.js';
export type { HostEligibility, HostEligibilityRelay } from './host-eligibility.js';

// Relay-signed app jobs: what the agent's root helper verifies before it
// installs, switches or removes an agent half
export {
  APP_JOB_ENVELOPE_MAX_CHARS,
  APP_JOB_KINDS,
  APP_JOB_SIGNATURE_CLOCK_SKEW_MS,
  APP_JOB_SIGNATURE_MAX_LIFETIME_MS,
  APP_JOB_SIGNATURE_TYPE,
  APP_JOB_SIGNATURE_VERSION,
  appJobEnvelopeMatches,
  appJobPayload,
  canonicalJson,
  decodeAppJobSignature,
  isAppJobKind,
  parseAppJobEnvelope,
  signAppJob,
  verifyAppJobSignature,
} from './app-job-signature.js';

export type {
  AppActivatePayload,
  AppInstallPayload,
  AppJobEnvelope,
  AppJobExpectation,
  AppJobKind,
  AppJobPayloads,
  AppJobSignature,
  AppJobSignatureRejection,
  AppJobSigningInput,
  AppRemovePayload,
  DecodedAppJobSignature,
  VerifyAppJobSignatureOptions,
  VerifyAppJobSignatureResult,
} from './app-job-signature.js';

// Agent jobs (relay -> agent work through agent-config; results both ends validate)
export {
  AGENT_APP_JOB_TIMEOUTS,
  AGENT_JOB_ERROR_MAX_CHARS,
  APP_UNIT_STATES,
  AgentAppJobResultSchema,
  AgentHookJobResultSchema,
  AgentJobResultSchema,
  agentJobError,
} from './agent-jobs.js';

export type {
  AgentAppJobResult,
  AgentHookJobResult,
  AgentJobResult,
  AppUnitState,
} from './agent-jobs.js';

// File helpers
export {
  PromiseChainMutex,
  KeyedPromiseChainMutex,
  atomicWriteJSON,
  readJSONFile,
} from './file-helpers.js';

export type { AtomicWriteOptions } from './file-helpers.js';

// Caller assertions (relay forwarder → agent half of an agent-hosted plugin)
export {
  CALLER_ASSERTION_HEADER,
  CALLER_ASSERTION_MAX_AGE_MS,
  CALLER_ASSERTION_CLOCK_SKEW_MS,
  CALLER_ASSERTION_VERSION,
  HOSTING_SECRET_BYTES,
  generateHostingSecret,
  assertHostingSecret,
  signCallerAssertion,
  verifyCallerAssertion,
  NonceStore,
} from './caller-assertion.js';

export type {
  CallerIdentity,
  CallerAssertionPayload,
  CallerAssertionRejection,
  VerifyCallerAssertionResult,
  VerifyCallerAssertionOptions,
} from './caller-assertion.js';

// Agent hook calls (relay through the tunnel; agent sync on its loopback)
export { callAgentHalfHook } from './agent-hook-call.js';
export type {
  AgentHookCallFailure,
  AgentHookCallOptions,
  AgentHookCallResult,
} from './agent-hook-call.js';

// Relay assertions (relay vhosts → lamaste-agentd on the agent's loopback)
export {
  RELAY_ASSERTION_HEADER,
  RELAY_ASSERTION_MAX_AGE_MS,
  RELAY_ASSERTION_CLOCK_SKEW_MS,
  RELAY_ASSERTION_VERSION,
  RELAY_SIGNING_KEY_FILE,
  relayKeyId,
  relayVerifyKeyOf,
  parseRelayVerifyKey,
  parseRelayKeysResponse,
  relayPublicKeySpki,
  createRelaySigner,
  signRelayAssertion,
  verifyRelayAssertion,
  urlIsUnderRoute,
} from './relay-assertion.js';

export type {
  RelayCaller,
  RelayTarget,
  RelayAssertionPayload,
  RelaySigningKey,
  RelayVerifyKey,
  RelayKeysAnswer,
  RelaySigner,
  RelaySignerOptions,
  RelayAssertionRejection,
  VerifyRelayAssertionResult,
  VerifyRelayAssertionOptions,
} from './relay-assertion.js';

// Plugin host
export { pluginHostPlugin, invalidatePluginHostCache } from './plugin-host.js';

export type { PluginHostAuthStrategy, PluginHostOptions } from './plugin-host.js';

// Branding primitives
export * from './branding.js';
