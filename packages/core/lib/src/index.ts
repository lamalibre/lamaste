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
  OIDC_CLIENT_ID_RE,
  OIDC_CLIENT_ID_MAX_LENGTH,
  isOidcClientId,
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
  DomainRenderingView,
  AutheliaVersionsView,
  DomainUsage,
  DomainMemberView,
  DomainMembership,
  DomainMembershipInput,
  OidcClientGrantView,
  SiteGrantView,
  PluginOidcClientView,
  DomainDnsCheck,
  DomainDnsRecord,
  DomainBrandingAssetView,
  DomainBrandingView,
  DomainBrandingInput,
  DomainBrandingChange,
  DomainBrandingFieldError,
  DomainBrandingPreview,
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
  PluginRemovalOptions,
  PeerShelfScopes,
  PeerShelfEdge,
  PeersView,
  AdminClient,
  TrustedScopesView,
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
  invitingRoles,
  grantableRoles,
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
  AGENT_HALF_PEER_PREFIX,
  isAgentHalfPeerPath,
  isUnderAgentHalfPeer,
  isUserSurfaceRoute,
  isUserSurfaceUrl,
  DELEGATED_INVITATIONS_API_PREFIX,
  DELEGATED_INVITATIONS_PAGE_PREFIX,
  delegatedInvitationsApiPath,
  isDelegatedInvitationsUrl,
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

// Peers: calls and events between agent-hosted app plugins — the manifest
// block, the endpoint matcher, the protocol's paths, headers and limits,
// what an update changes and breaks (design: slice 8)
export {
  PEER_PROTOCOL_VERSION,
  AGENT_HALF_PEERS_PREFIX,
  AGENT_HALF_PEERS_PATH,
  AGENT_HALF_PEERS_ATTACH_PATH,
  AGENT_HALF_PEERS_EVENTS_PULL_PATH,
  PEER_CHANNEL_UPGRADE,
  PEER_CHANNEL_RELAY_PREFIX,
  PEER_CHANNEL_EVENTS_PATH,
  PEER_SCOPE_HEADER,
  PEER_HOPS_HEADER,
  PEER_TIMEOUT_HEADER,
  PEER_DELEGATION_HEADER,
  PEER_RELAY_HEADER,
  PEER_RELAY_CODES,
  PEER_UNAVAILABLE_REASONS,
  PEER_GAP_REASONS,
  PEER_MAX_HOPS,
  PEER_CALL_TIMEOUT_DEFAULT_MS,
  PEER_CALL_TIMEOUT_MAX_MS,
  PEER_CHANNEL_MAX_STREAMS,
  PEER_CHANNEL_MAX_HEADER_LIST_BYTES,
  PEER_CHANNEL_PING_INTERVAL_MS,
  PEER_CHANNEL_PING_TIMEOUT_MS,
  PEER_ATTACH_WAIT_MS,
  PEER_REATTACH_MIN_MS,
  PEER_REATTACH_MAX_MS,
  PEER_EVENT_DATA_MAX_BYTES,
  PEER_EVENTS_PULL_MAX,
  PEER_EVENTS_PULL_MAX_BYTES,
  PEER_EVENTS_WAIT_MAX_MS,
  PEER_OUTBOX_RETENTION_DEFAULT_DAYS,
  PEER_SCOPE_RE,
  PEER_EVENT_TYPE_RE,
  PEER_EVENT_TYPE_MAX_LENGTH,
  PEER_ENDPOINT_METHODS,
  PEER_ENDPOINT_PATH_MAX_LENGTH,
  PEER_PROVIDED_SCOPES_MAX,
  PEER_CONSUMED_SCOPES_MAX,
  PEER_ENDPOINTS_MAX,
  PEER_EVENTS_MAX,
  PEER_MAJOR_MAX,
  PEER_MAJORS_MAX,
  isPeerScope,
  isPeerEventType,
  isPeerMajor,
  isPeerRoute,
  peerScopeProvider,
  parsePeerEndpointPath,
  PeerEndpointSchema,
  PeerProvidedScopeSchema,
  PeerConsumedScopeSchema,
  PeersBlockSchema,
  peersRouteIssues,
  peerEndpointKey,
  parsePeerEndpointKey,
  matchPeerEndpoint,
  peerEndpointAdmitsRoute,
  normalizePeersBlock,
  peersDiff,
  peersBreaks,
} from './peers.js';
export type {
  PeerEndpointMethod,
  PeerRelayCode,
  PeerUnavailableReason,
  PeerGapReason,
  PeerPatternSegment,
  PeersBlockInput,
  PeersBlock,
  PeerProvidedScope,
  PeerConsumedScope,
  PeerEndpoint,
  PeerServedEndpoint,
  PeerScopedEvent,
  PeersDiff,
  PeerUsedEdge,
  PeerBreak,
} from './peers.js';

// Peer events: the wire contract of the outbox, the relay and the inbox
export {
  PEER_EVENTS_REQUEST_MAX_BYTES,
  PEER_EVENTS_ANSWER_MAX_BYTES,
  isPeerStreamId,
  isPeerEpoch,
  peerSubscriptionEpoch,
  parsePeerEvent,
  parsePeerEventsPullRequest,
  parsePeerEventsPullAnswer,
  parsePeerEventsRequest,
  parsePeerEventsChannelAnswer,
} from './peer-events.js';
export type {
  PeerEvent,
  PeerEventsPullRequest,
  PeerEventsPullAnswer,
  PeerEventsRequest,
  PeerEventsGap,
  PeerEventsChannelAnswer,
} from './peer-events.js';

// Peer delegations: a plugin calling another on behalf of a person it serves
export {
  PEER_DELEGATION_VERSION,
  PEER_DELEGATION_TYPE,
  PEER_DELEGATION_LIFETIME_MS,
  PEER_DELEGATION_MAX_DEPTH,
  PEER_DELEGATION_CLOCK_SKEW_MS,
  isPeerDelegationKey,
  generatePeerDelegationKey,
  signPeerDelegation,
  verifyPeerDelegation,
  onwardPeerDelegation,
} from './peer-delegation.js';
export type {
  PeerDelegationKey,
  PeerDelegationPayload,
  PeerDelegationRejection,
  VerifyPeerDelegationResult,
  SignPeerDelegationInput,
  VerifyPeerDelegationOptions,
} from './peer-delegation.js';

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
  MEMBERSHIP_KINDS,
  domainLanguageOfHost,
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
export type {
  DomainRecord,
  DomainStatus,
  DomainsIndex,
  DomainsProjection,
  DomainsProjectionDomain,
  MembershipKind,
} from './domains.js';

// The Authelia groups Lamaste owns: who is named where, written into
// users.yml so a change needs no Authelia restart (external members)
export {
  ADMIN_GROUP_NAME_RE,
  DOMAIN_GROUP_KEY_RE,
  OWNED_GROUP_PREFIX,
  externalGroup,
  foldGroupName,
  isAssignableGroupName,
  isDomainGroupKey,
  isLamasteOwnedGroup,
  memberGroup,
  mergeOwnedGroups,
  oidcClientGroup,
  reachedOidcClients,
  renderOwnedGroups,
  siteGroup,
} from './owned-groups.js';
export type {
  DeviceCodeClient,
  GroupsHolder,
  MergeOwnedGroupsOptions,
  OwnedGroupsClient,
  OwnedGroupsDomain,
  OwnedGroupsHost,
  OwnedGroupsInput,
  OwnedGroupsSite,
} from './owned-groups.js';

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
  APPHOST_MIN_PROTOCOL_VERSION,
  APPHOST_SCOPED_PROTOCOL_VERSION,
  apphostProtocolFor,
  APPHOST_ROUTE_RE,
  APP_SERVICE_USER_MAX,
  AGENT_HALF_INTEGRITY_RE,
  AGENT_HALF_MAX_BODY_MB,
  AgentHalfMaxBodySizeSchema,
  AgentHalfPackageNameSchema,
  AgentHalfSpecSchema,
  AgentHalfVersionSchema,
  AgentServiceEntrySchema,
  AgentServiceMemoryMaxSchema,
  SystemPackageNameSchema,
  agentHalfMaxBodyMb,
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
  PeerCallerIdentity,
  PeerCallerUser,
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
  isRelayInvitationsTarget,
  isRelayUserSurfaceTarget,
} from './relay-assertion.js';

export type {
  RelayCaller,
  RelaySessionUser,
  RelayPanelUser,
  RelayTarget,
  RelayUserSurfaceTarget,
  RelayInvitationsTarget,
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

// Static site upload limits and batching (the panel, its vhosts, every uploader)
export {
  SITE_UPLOAD_MAX_FILE_BYTES,
  SITE_UPLOAD_MAX_REQUEST_MIB,
  SITE_UPLOAD_MAX_REQUEST_BYTES,
  planSiteUploadBatches,
  oversizedSiteUploads,
} from './site-upload.js';

// Branding primitives
// Trusted publisher scopes — which npm scopes' plugin packages may install and run
export {
  BUILTIN_TRUSTED_SCOPE,
  MAX_ADDITIONAL_TRUSTED_SCOPES,
  NPM_SCOPE_RE,
  SCOPED_PACKAGE_NAME_RE,
  SCOPED_PACKAGE_SPEC_RE,
  NpmScopeSchema,
  ScopedPackageNameSchema,
  AdditionalTrustedScopesSchema,
  effectiveTrustedScopes,
  isNpmScope,
  packageScope,
  isTrustedPackage,
  assertTrustedPackage,
  assertManifestPackagesTrusted,
  UntrustedScopeError,
} from './trusted-scopes.js';
export type { ManifestPackageRefs } from './trusted-scopes.js';

export * from './branding.js';

// Where @lamalibre packages install from (the hosted Feria unless npm's
// configuration names another registry) — pure; the npm-reading half is in
// the agent and server subpaths (npm-registry-config.ts)
export {
  LAMALIBRE_REGISTRY_CONFIG_KEY,
  LAMALIBRE_REGISTRY_ENV,
  PUBLIC_NPM_REGISTRY_HOSTS,
  isPublicNpmRegistry,
  LamalibreRegistryError,
  chooseLamalibreRegistry,
  lamalibreRegistryArg,
  lamalibreRegistryEnv,
} from './lamalibre-registry.js';

// Per-domain branding of the auth pages: the brand record's rules, the
// image checks and the rendering (browser-safe; the relay's side is in /server)
export {
  AUTH_BRANDING_THEMES,
  AUTH_BRANDING_NAME_MAX_LENGTH,
  AUTH_BRANDING_TAGLINE_MAX_LENGTH,
  AUTH_BRANDING_SUPPORT_URL_MAX_LENGTH,
  AUTH_BRANDING_LOGO_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_DIMENSION,
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_FAVICON_MAX_DIMENSION,
  AUTH_BRANDING_ACCENT_RE,
  AUTH_BRANDING_WEB_ROOT,
  AUTH_BRANDING_FILES,
  AUTH_BRANDING_LOCALES_DIR,
  AUTHELIA_LOCALE_RE,
  AUTHELIA_LOCALE_NAMESPACE_RE,
  AUTHELIA_NAME_PLACEHOLDER,
  BRAND_FIELD_NAMES,
  BRAND_CSS_ACCENT_PROPERTIES,
  BRAND_CSS_FOOTER_SELECTOR,
  brandTextProblem,
  brandSupportUrlProblem,
  validateBrandFields,
  inspectBrandLogo,
  inspectBrandFavicon,
  authBrandingLocaleFile,
  renderBrandLocale,
  accentForeground,
  renderBrandCss,
  renderBrandJson,
  BrandJsonSchema,
  AUTH_PAGE_DARK_PALETTE,
  AUTH_PAGE_LIGHT_PALETTE,
  AUTH_PAGE_DEFAULT_ACCENT,
  AUTH_PAGE_DEFAULT_ACCENT_LIGHT,
  AUTH_PAGE_PROPERTY_PREFIX,
  renderAuthPageThemeCss,
  BRAND_CSS_LANGUAGE_MENU_RULE,
  renderDomainCss,
} from './auth-branding.js';

export type {
  BrandTheme,
  BrandFields,
  BrandFieldName,
  BrandFieldError,
  BrandFieldsValidation,
  BrandImageInspection,
  BrandImageRefusal,
  RenderedBrand,
  BrandJson,
  AuthPagePalette,
} from './auth-branding.js';

// The pages' language: the catalogue (browser-safe; also the subpath
// ./page-messages) and Authelia's portal forced into a domain's language
// (page-language-design.md)
export {
  PAGE_LANGUAGES,
  PAGE_LANGUAGE_NAMES,
  isPageLanguage,
  PAGE_MESSAGES_EN,
  PAGE_MESSAGES_TR,
  PAGE_MESSAGES,
  PAGE_MESSAGE_KEYS,
  PAGE_MESSAGE_DROPPED_PLACEHOLDERS,
  INVITE_PAGE_KEYS,
  INVITATIONS_PAGE_KEYS,
  UNAVAILABLE_PAGE_KEYS,
  FORBIDDEN_PAGE_KEYS,
  ACCESS_REQUEST_PAGE_KEYS,
  DOMAIN_REFUSAL_PAGE_KEYS,
  pageMessage,
  pageMessagesFor,
  messagePlaceholders,
  formatMessage,
  formatMessageHtml,
  pluralKey,
  htmlAsciiReferences,
  pageMessagesJson,
} from './page-messages.js';
export type { PageLanguage, PageMessageKey, HtmlMessageValue } from './page-messages.js';
export {
  AUTHELIA_FORCED_NAMESPACES,
  AUTHELIA_LANGUAGE_DETECTION_ORDER,
  AUTHELIA_LANGUAGE_MENU_SELECTOR,
  AUTHELIA_INDEX_LANG_LITERAL,
  AUTHELIA_NOSCRIPT_TEXT,
  AUTHELIA_NOSCRIPT_TRANSLATIONS,
  AUTHELIA_LOCALE_OF_LANGUAGE,
  AUTHELIA_FORCED_LOCALES_DIR,
  AUTHELIA_SUPPLEMENT,
  AUTHELIA_CORRECTIONS,
  forcedAutheliaLocaleFile,
  autheliaIndexLanguageFilters,
  renderForcedAutheliaLocale,
} from './authelia-locales.js';
export type {
  AutheliaNamespace,
  AutheliaMessages,
  ForcedAutheliaLocale,
} from './authelia-locales.js';

// Delegated invitations: a plugin user with an inviting role invites
// colleagues into that plugin (delegated-invitations-design.md)
export {
  DEFAULT_INVITATION_POLICY,
  DELEGATED_INVITATIONS_BODY_LIMIT,
  AdminAcceptanceSchema,
  DelegatedAcceptanceSchema,
  DelegatedInvitationRequestSchema,
  InvitationLookupSchema,
  INVITATIONS_PER_INVITER_PER_HOUR,
  INVITATION_ACCEPTING_STALE_MS,
  INVITATION_GRANT_RESERVE,
  INVITATION_KINDS,
  INVITATION_MAX_FAILED_ATTEMPTS,
  INVITATION_POLICY_LIMITS,
  INVITATION_POLICY_MAX_EMAIL_DOMAINS,
  INVITATION_REPAIR_WINDOW_MS,
  INVITATION_RETENTION_DAYS,
  INVITATION_REVOKE_REASONS,
  INVITATION_REVOKE_REASON_TEXT,
  INVITATION_STATUSES,
  INVITATION_TOKEN_BYTES,
  INVITATION_TOKEN_RE,
  InvitationPolicyInputSchema,
  emailDomainOf,
  refusedField,
  suggestedUsername,
} from './invitations.js';
export type {
  AdminAcceptance,
  DelegatedAcceptance,
  DelegatedInvitationRequest,
  InvitationAdminView,
  InvitationInviterView,
  InvitationListFilter,
  InvitationLookup,
  InvitationPolicyView,
  InviterOverview,
  InvitationKind,
  InvitationPolicy,
  InvitationPolicyInput,
  InvitationRevokeReason,
  InvitationStatus,
} from './invitations.js';
