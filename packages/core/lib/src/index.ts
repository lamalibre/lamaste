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
  USERNAME_REGEX,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  isLamasteUsername,
  RESERVED_TUNNEL_PORTS,
  isTunnelPortAllowed,
  INTERNAL_PLUGIN_PORT_RANGE,
  isInternalPluginPort,
  PLUGIN_HOST_ACTION,
  pluginHostCapability,
  hasAgentHalf,
  CORE_SUBDOMAINS,
  RESERVED_SUBDOMAINS,
  AGENT_PANEL_SUBDOMAIN_PREFIX,
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
  OIDC_USER_FACTORS,
  HOSTNAME_REGEX,
  DNS_WILDCARD_PROBE_LABEL,
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
  OidcUserFactor,
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
  AdminWarning,
  AdminUser,
  DirectoryUserView,
  DomainView,
  DomainUsage,
  DomainMemberView,
  DomainDnsCheck,
  DomainDnsRecord,
  IdentityReadinessReason,
  PluginIdentityView,
  PluginWebSurfaceView,
  WebSurfaceNotServedReason,
  PluginSettingsView,
  StoredAudienceChange,
  PluginAudienceRow,
  PluginEntitlement,
  EntitlementPrincipal,
  IdentitySyncResult,
  UserSurfaceRouteStatus,
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
  validateInstalledManifest,
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

// Plugin settings (agent-hosted plugins): the manifest's settings block,
// update validation, and the wire contract between the relay and the agent
// half, which stores the values (`createSettingsStore` in /agent)
export {
  SETTINGS_FIELD_TYPES,
  SETTINGS_MAX_FIELDS,
  SETTINGS_KEY_RE,
  SETTINGS_STRING_MAX_LENGTH,
  SETTINGS_DEFAULT_MAX_LENGTH,
  SETTINGS_PATTERN_MAX_LENGTH,
  SETTINGS_ENUM_MAX_OPTIONS,
  AGENT_HALF_SETTINGS_PATH,
  AGENT_HALF_SETTINGS_RELOAD_PATH,
  AGENT_HALF_SETTINGS_MAX_BYTES,
  SettingsFieldSchema,
  SettingsBlockSchema,
  validateSettingsUpdate,
  settingsStatus,
  effectiveSettingsValues,
  settingsSchemaDiff,
  normalizeSettingsErrorMessage,
  parseAgentHalfSettingsState,
  parseAgentHalfSettingsUpdate,
} from './plugin-settings.js';

export type {
  SettingsFieldType,
  SettingsField,
  SettingsBlock,
  SettingsValue,
  SettingsValues,
  SettingsCheckOptions,
  SettingsUpdateInput,
  SettingsUpdateValidation,
  SettingsStatus,
  SettingsSchemaDiff,
  SettingsFieldRef,
  SettingsFieldRetype,
  AgentHalfSettingsState,
  AgentHalfSettingsUpdate,
} from './plugin-settings.js';

// Identity (agent-hosted plugins): the manifest's identity block, its
// approval diff, and the feed contract between the panel and the agent half,
// which keeps the projection (`createIdentityProjection` in /agent)
export {
  IDENTITY_PROTOCOL_VERSION,
  AGENT_HALF_IDENTITY_PREFIX,
  AGENT_HALF_IDENTITY_NOTIFY_PATH,
  AGENT_HALF_IDENTITY_CHANGES_PATH,
  IDENTITY_BATCH_MAX_CHANGES,
  IDENTITY_BATCH_MAX_BYTES,
  IDENTITY_ANSWER_MAX_BYTES,
  IDENTITY_ROLE_ID_REGEX,
  IDENTITY_ROLES_MAX,
  IDENTITY_UUID_REGEX,
  IDENTITY_ATTRIBUTES,
  DEFAULT_IDENTITY_ATTRIBUTES,
  AUDIENCE_REMOVE_REASONS,
  IDENTITY_DISPLAY_NAME_MAX_LENGTH,
  IDENTITY_EMAIL_MAX_LENGTH,
  IDENTITY_CURSOR_MISMATCH,
  isIdentityUuid,
  isIdentityRoleList,
  IdentityRoleSchema,
  IdentityBlockSchema,
  normalizeIdentityBlock,
  identityDiff,
  identityChangeNeedsApproval,
  AudienceMemberSchema,
  AudienceLastKnownSchema,
  AudienceChangeSchema,
  IdentityNotifyRequestSchema,
  IdentityNotifyAnswerSchema,
  IdentityChangesRequestSchema,
  IdentityChangesAnswerSchema,
  IdentityCursorConflictSchema,
  parseIdentityNotifyRequest,
  parseIdentityNotifyAnswer,
  parseIdentityChangesRequest,
  parseIdentityChangesAnswer,
  parseIdentityCursorConflict,
  parseIdentityChangesWire,
} from './identity.js';

// The feed's changes sealed to one request (installation-secret key,
// domain-separated from the settings secrets').
export {
  IDENTITY_CHANGES_SEAL_VERSION,
  sealIdentityChanges,
  openIdentityChanges,
  parseSealedIdentityChanges,
} from './identity-seal.js';
export type {
  SealedIdentityChanges,
  IdentityChangesEnvelope,
  IdentityChangesSealContext,
} from './identity-seal.js';

export type {
  IdentityAttribute,
  AudienceRemoveReason,
  IdentityBlockInput,
  IdentityBlock,
  IdentityRole,
  NormalizedIdentityBlock,
  IdentityDiff,
  AudienceMember,
  AudienceLastKnown,
  AudienceChange,
  IdentityNotifyRequest,
  IdentityNotifyAnswer,
  IdentityChangesRequest,
  IdentityChangesAnswer,
  IdentityCursorConflict,
  IdentityChangesWire,
} from './identity.js';

// The user surface: /api/<route>/app/* on the relay, /app/* on the agent
// half — the path rules every check of it shares, how a host's binding to
// it is read, and which bound routes a host serves (its agent hosts them)
export {
  AGENT_HALF_APP_PREFIX,
  USER_SURFACE_API_PREFIX,
  USER_SURFACE_MAX_ROUTES_PER_HOST,
  USER_SURFACE_MAX_RESPONSE_SECONDS,
  hasUnsafePathSegments,
  isAgentHalfAppPath,
  isUnderAgentHalfApp,
  isUserSurfaceRoute,
  isUserSurfaceUrl,
  siteUserSurfaceRoute,
  tunnelUserSurfaceRoutes,
  tunnelServedUserSurfaceRoutes,
  userSurfaceApiPath,
  userSurfaceHostByFqdn,
  userSurfaceHostServing,
  userSurfaceHostingAgent,
  userSurfaceHosts,
} from './user-surface.js';
export type { UserSurfaceHost } from './user-surface.js';

// The web surface of an agent-hosted plugin (`userSurface.web`): the
// manifest block, and the rules and digest of the web tree its server
// package ships
export {
  DEFAULT_WEB_SURFACE_ROOT,
  UserSurfaceBlockSchema,
  WEB_SURFACE_ACCESS_MODES,
  WEB_TREE_DIGEST_VERSION,
  WEB_TREE_CONTENT_TYPES,
  WEB_TREE_EXTENSIONS,
  WEB_TREE_INDEX,
  WEB_TREE_LIMITS,
  WebSurfaceBlockSchema,
  WebTreeError,
  isWebSurfaceSubdomain,
  isWebTreeSegment,
  webTreeDigest,
  webTreeFileSha256,
  webTreeLimitError,
  webTreeManifest,
  webTreePathProblem,
} from './web-surface.js';
export type {
  UserSurfaceBlock,
  WebSurfaceAccessMode,
  WebSurfaceBlock,
  WebTreeErrorCode,
  WebTreeFile,
  WebTreeManifest,
} from './web-surface.js';

// The relay's base domains: names, overlap, the domain of a hostname, reserved
// labels (the multi-domain relay)
export {
  DOMAINS_PROJECTION_FILE,
  DOMAIN_STATUSES,
  DomainError,
  DomainNameSchema,
  domainMembership,
  indexDomainsProjection,
  labelUnder,
  parseDomainsProjection,
  assertDomainAddable,
  assertDomainName,
  domainOfHost,
  domainsOverlap,
  isRelayHost,
  isReservedLabel,
} from './domains.js';
export type { DomainRecord, DomainStatus, DomainsIndex, DomainsProjection } from './domains.js';

// Authelia's session cookie: its name, how Gatekeeper reads it, and the
// nginx map that keeps it from every tunnel and agent backend
export {
  AUTHELIA_SESSION_COOKIE,
  BACKEND_COOKIE_MAP_FILE,
  BACKEND_COOKIE_STRIP_ROUNDS,
  BACKEND_COOKIE_VARIABLE,
  autheliaSessionCookies,
  renderBackendCookieMap,
} from './authelia-session.js';

// Settings secrets on the wire: sealed by the relay to the one request that
// carries them, opened by the agent half with the verified request
export {
  SETTINGS_SECRET_ENCRYPTION_VERSION,
  encryptSettingsSecret,
  decryptSettingsSecret,
} from './settings-secrets.js';
export type { EncryptedSettingsSecret, SettingsSecretContext } from './settings-secrets.js';

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

// The hash of an agent's host facts, which the agent and the relay compare
// (the relay's agent-config answer carries the hash of the facts it stores)
export { HOST_FACTS_HASH_RE, hostFactsHash } from './host-facts.js';

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
  atomicWriteJSONIfChanged,
  readJSONFile,
} from './file-helpers.js';

export type { AtomicWriteOptions } from './file-helpers.js';

// Caller assertions (relay → agent half of an agent-hosted plugin) and the
// responder signatures the agent half authenticates its answers with
export {
  CALLER_ASSERTION_HEADER,
  CALLER_ASSERTION_MAX_AGE_MS,
  CALLER_ASSERTION_CLOCK_SKEW_MS,
  CALLER_ASSERTION_VERSION,
  HOSTING_SECRET_BYTES,
  RESPONDER_HEADER,
  generateHostingSecret,
  generateCallerAssertionNonce,
  assertHostingSecret,
  bodySha256Hex,
  isOriginFormPath,
  parseCallerIdentity,
  signCallerAssertion,
  verifyCallerAssertion,
  signResponder,
  verifyResponder,
  NonceStore,
} from './caller-assertion.js';

export type {
  CallerIdentity,
  UserCallerIdentity,
  CallerAssertionInput,
  CallerAssertionPayload,
  CallerAssertionRejection,
  ResponderInput,
  VerifiedCallerAssertion,
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

// Lamaste's own calls to an agent half's admin surface (settings and health
// through the tunnel)
export { AGENT_HALF_HEALTH_PATH, callAgentHalf } from './agent-half-call.js';
export type {
  AgentHalfCallFailure,
  AgentHalfCallMethod,
  AgentHalfCallOptions,
  AgentHalfCallResult,
} from './agent-half-call.js';

// Relay assertions (relay vhosts → lamaste-agentd on the agent's loopback;
// Gatekeeper → the panel for a plugin's user surface)
export {
  RELAY_ASSERTION_HEADER,
  RELAY_ASSERTION_MAX_AGE_MS,
  RELAY_ASSERTION_CLOCK_SKEW_MS,
  RELAY_ASSERTION_VERSION,
  RELAY_SIGNING_KEY_FILE,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
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
  RelaySessionUser,
  RelayPanelUser,
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

// Request logging without personal data (the panel, Gatekeeper)
export { logRequestMetadata, UNMATCHED_ROUTE } from './request-log.js';
export type { RequestMetadataLogOptions } from './request-log.js';

// Branding primitives
export * from './branding.js';
