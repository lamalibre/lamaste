/**
 * @lamalibre/lamaste/server — Server domain logic
 *
 * Server plugin lifecycle, tunnel/site workflows, mTLS management,
 * access control sync, provisioning orchestrator.
 *
 * Operates on /etc/lamalibre/lamaste/ directory.
 * All exports are pure functions — no Fastify dependency.
 */

// --- Plugins ---
export {
  ManifestSchema,
  PluginError,
  validateManifest,
  readPlugins,
  writePlugins,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  getEnabledPlugins,
  getPluginCapabilities,
} from './plugins.js';
export type {
  PluginManifest,
  PluginEntry,
  PluginRegistry,
  PluginLogger,
  ExecFn as PluginExecFn,
  InstallPluginOptions,
  UninstallPluginOptions,
  TogglePluginOptions,
} from './plugins.js';

// --- mTLS ---
export {
  MtlsError,
  readCertExpiry,
  getMtlsCerts,
  getP12Path,
  loadAgentRegistry,
  saveAgentRegistry,
  getAgentP12Path,
  getValidCapabilities,
  filterLiveCapabilities,
  generateAgentCert,
  listAgentCerts,
  getAgentCapabilities,
  getAgentCapabilitiesLive,
  updateAgentCapabilities,
  getAgentAllowedSites,
  updateAgentAllowedSites,
  revokeAgentCert,
  revokePluginCapabilitiesFromAgents,
} from './mtls.js';
export type {
  CertExpiry,
  MtlsCertInfo,
  AgentCertResult,
  AgentCertEntry,
  AgentRegistry,
  AgentCertListEntry,
  MtlsLogger,
  ExecFn as MtlsExecFn,
  AddToRevocationListFn,
  GenerateAgentCertOptions,
  RevokeAgentCertOptions,
} from './mtls.js';

// --- Tunnels ---
export {
  RESERVED_SUBDOMAINS,
  TunnelError,
  derivePluginRoute,
  createTunnel,
  deleteTunnel,
  toggleTunnel,
  assignTunnel,
  reconfigureTunnel,
  updateTunnel,
  releaseAgentTunnels,
  withTunnelLock,
  TUNNEL_MAX_BODY_MB,
  tunnelsCarriedBy,
  bindUnownedTunnels,
  isInternalTunnel,
  tunnelLabel,
  assignInternalPluginPort,
} from './tunnels.js';
export type {
  TunnelType,
  TunnelExposure,
  AccessMode,
  TunnelEntry,
  TunnelLogger,
  CertResult,
  NginxDeps,
  CertbotDeps,
  ChiselDeps,
  TunnelStateDeps,
  TunnelAgentDeps,
  CreateTunnelOptions,
  DeleteTunnelOptions,
  ToggleTunnelOptions,
  AssignTunnelOptions,
  ReconfigureTunnelOptions,
  VhostOptions,
  BindUnownedResult,
  UpdateTunnelOptions,
  AuthorizeTunnel,
  ReleaseAgentTunnelsOptions,
  ReleaseAgentTunnelsResult,
} from './tunnels.js';

// --- Sites ---
export { SiteError, createSite, deleteSite, updateSite, verifyDns } from './sites.js';
export type {
  SiteType,
  SiteEntry,
  SiteLogger,
  CertResult as SiteCertResult,
  SiteNginxDeps,
  SiteCertbotDeps,
  SiteFilesDeps,
  SiteStateDeps,
  TunnelReadDeps,
  AutheliaDeps as SiteAutheliaDeps,
  CreateSiteOptions,
  CreateSiteResult,
  DeleteSiteOptions,
  UpdateSiteOptions,
  UpdateSiteResult,
  VerifyDnsOptions,
  VerifyDnsResult,
} from './sites.js';

// --- Access Control ---
export { syncAllAccessControl } from './access-control.js';
export type {
  SiteEntry as AccessControlSiteEntry,
  PluginTunnelGrant,
  TunnelEntry as AccessControlTunnelEntry,
  AccessControlLogger,
  AutheliaDeps as AccessControlAutheliaDeps,
  GrantStateDeps,
  TunnelStateDeps as AccessControlTunnelStateDeps,
  SiteStateDeps as AccessControlSiteStateDeps,
  SyncAccessControlOptions,
} from './access-control.js';

// --- Files (static site filesystem helpers) ---
export {
  SITES_ROOT,
  ALLOWED_EXTENSIONS,
  validateFileExtension,
  validatePath,
  getSiteRoot,
  createSiteDirectory,
  removeSiteDirectory,
  listFiles,
  saveUploadedFile,
  deleteFile,
  getSiteSize,
} from './files.js';
export type { SiteListEntry } from './files.js';

// --- Certbot ---
export {
  issueCert,
  issueCoreCerts,
  issueAppCert,
  listCerts,
  renewCert,
  renewAll,
  setupAutoRenew,
  hasWildcardCert,
  issueTunnelCert,
  getCertPath,
  isCertValid,
  certNames,
  issueSiteCert,
  readLetsEncryptExpiry,
  CERTBOT_WRAPPER,
  CERT_INFO_WRAPPER,
} from './certbot.js';
export type {
  IssueSiteCertOptions,
  IssueCertResult,
  CertInfo,
  RenewCertOptions,
  TunnelCertResult,
  CertValidity,
  ExecFn as CertbotExecFn,
} from './certbot.js';

// --- Authelia ---
export {
  AUTHELIA_BIN,
  AUTHELIA_SERVICE,
  AUTHELIA_CONFIG_DIR,
  AUTHELIA_CONFIG,
  AUTHELIA_USERS,
  AUTHELIA_SECRETS,
  AUTHELIA_LOG_DIR,
  isAutheliaInstalled,
  writeAutheliaConfig,
  createUser as createAutheliaUser,
  readUsers as readAutheliaUsers,
  writeUsers as writeAutheliaUsers,
  readUsersRaw as readAutheliaUsersRaw,
  hashPassword as hashAutheliaPassword,
  startAuthelia,
  reloadAuthelia,
  isAutheliaRunning,
  updateAccessControl as updateAutheliaAccessControl,
  updateOidcProvider as updateAutheliaOidcProvider,
  isOidcIssuerKeyProvisioned as isAutheliaOidcIssuerKeyProvisioned,
  renderOidcClient,
  renderOidcClaimsPolicies,
  buildOidcProviderSection,
  oidcIssuerKeyTemplateLine,
  sentinelizeAutheliaConfig,
  renderAutheliaConfigTemplate,
  AUTHELIA_OIDC_KEY,
  AUTHELIA_OIDC_KEY_ID,
  OIDC_KEY_TEMPLATE_SENTINEL,
  createUserFromInvitation,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  writeTotpToDatabase,
} from './authelia.js';
export type {
  AutheliaSecrets,
  AutheliaUser,
  UsersYamlEntry,
  UsersYamlFile,
  ProtectedSiteRule,
  BcryptHashFn,
  ExecFn as AutheliaExecFn,
  AutheliaOidcClient,
  OidcClientSecretDigests,
  OidcScopeDefinitions,
  OidcProviderOptions,
} from './authelia.js';

// --- OIDC client secrets (confidential clients) ---
export {
  OIDC_CLIENTS_FILENAME,
  OIDC_SECRET_PBKDF2_ITERATIONS,
  adaptedBase64Encode,
  adaptedBase64Decode,
  encodePbkdf2Sha512Digest,
  verifyPbkdf2Sha512Digest,
  generateClientSecret,
  oidcClientsPath,
  listOidcClientSecrets,
  readOidcClientSecret,
  readOidcClientSecretDigests,
  reconcileOidcClientSecrets,
  rotateOidcClientSecret,
  clearOidcClientSecrets,
} from './oidc-clients.js';
export type {
  OidcClientSecretRecord,
  OidcClientsFile,
  OidcClientSecretMetadata,
  DesiredOidcClientSecret,
  OidcClientSecretsReconciliation,
} from './oidc-clients.js';

// --- Storage (S3-compatible server registry + credential encryption) ---
export {
  StorageError,
  encryptCredential,
  decryptCredential,
  registerStorageServer,
  removeStorageServer,
  listStorageServers,
  bindPluginStorage,
  unbindPluginStorage,
  listBindings,
  getBinding,
  getPluginStorageConfig,
} from './storage.js';
export type {
  StorageServerRegistration,
  StorageServerPublic,
  PluginStorageBinding,
  PluginStorageBindingWithServer,
  PluginStorageConfig,
} from './storage.js';

// --- Chisel (tunnel server lifecycle) ---
export {
  CHISEL_BIN,
  CHISEL_SERVICE,
  getInstalledChiselVersion,
  ensureChiselKey,
  startChisel,
  reloadChisel,
  stopChisel,
  isChiselRunning,
  getChiselStatus,
} from './chisel.js';
export type {
  ServiceActiveStatus as ChiselServiceActiveStatus,
  ServiceStatus as ChiselServiceStatus,
  ExecFn as ChiselExecFn,
} from './chisel.js';

// --- Chisel args (client argument builder) ---
export { buildChiselArgs } from './chisel-args.js';
export type { ChiselTunnel } from './chisel-args.js';

// --- Chisel users (authfile credential management) ---
export {
  addChiselCredential,
  removeChiselCredential,
  rotateChiselCredential,
  getChiselCredential,
  getChiselCredentialIssuedAt,
  reloadChiselAuth,
  authfileRevokes,
  CHISEL_AUTHFILE_GROUP,
  migrateChiselCredentialsIfNeeded,
  loadChiselCredentials,
  syncChiselAuthfile,
  chiselGrants,
  grantedTunnelsFor,
  withheldTunnels,
  renderAuthfile as renderChiselAuthfile,
} from './chisel-users.js';
export type {
  ChiselCredential,
  ChiselCredentialStore,
  ChiselPaths,
  ChiselCredentialResult,
  RemoveCredentialResult,
  AuthfileChange as ChiselAuthfileChange,
  MigrationResult as ChiselMigrationResult,
  AgentRegistrySnapshot as ChiselAgentRegistrySnapshot,
  ChiselLogger,
  ChiselGrantTunnel,
  LoadGrantTunnels,
} from './chisel-users.js';

// --- User plugin access ---
export {
  UserAccessError,
  createGrant,
  listGrants,
  listGrantsForUser,
  revokeGrant,
  removeGrantsForUser,
  consumeGrant,
  createOTP,
  validateAndConsumeOTP,
} from './user-access.js';
export type {
  UserAccessLogger,
  UserAccessGrant,
  OtpToken,
  UserAccessState,
  CreateGrantOptions,
  CreatedGrant,
} from './user-access.js';

// --- Plugin hosting (agent-hosted plugins with an agent half) ---
export {
  PLUGIN_HOSTINGS_FILENAME,
  PluginHostingError,
  pluginHostingsPath,
  readPluginHostings,
  getPluginHosting,
  createPluginHosting,
  removePluginHosting,
  rotatePluginHostingSecret,
  acknowledgePluginHostingSecret,
  updatePluginHostingHealth,
  signingSecretFor,
  pluginHostingView,
  agentPluginConfigFor,
  agentPluginAssignments,
} from './plugin-hosting.js';
export type {
  PluginHostingSecret,
  PluginHostingHealthState,
  PluginHostingHealth,
  PluginHostingRecord,
  PluginHostingStore,
  PluginHostingView,
  AgentPluginConfig,
  AgentPluginAssignment,
  CreatePluginHostingInput,
} from './plugin-hosting.js';

// --- Agent forwarder (the panel's /api/<route>/* for hosted plugins) ---
export {
  AGENT_HALF_ADMIN_PREFIX,
  AGENT_FORWARD_DEFAULTS,
  agentForwarderPlugin,
  forwardToAgentHalf,
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  agentHalfPath,
} from './agent-forwarder.js';
export type {
  AgentForwardTarget,
  AgentForwardRefusal,
  AgentForwardResolution,
  AgentForwarderOptions,
  AgentForwarderLogger,
} from './agent-forwarder.js';

// --- Health monitor for hosted plugins ---
export {
  PLUGIN_HEALTH_DEFAULTS,
  AGENT_HALF_HEALTH_PATH,
  probePluginHosting,
  applyProbe,
  startPluginHealthMonitor,
} from './plugin-health.js';
export type {
  PluginProbeResult,
  PluginProbeTarget,
  PluginProbeOptions,
  PluginHealthTracker,
  MonitoredHosting,
  PluginHealthMonitorOptions,
  PluginHealthMonitor,
} from './plugin-health.js';

// --- Branding ---
export * from '../branding.js';

// --- Provisioning ---
export { TASK_DEFINITIONS, provisionServer } from './provisioning.js';
export type {
  TaskStatus,
  TaskDefinition,
  TaskState,
  ProvisioningProgress,
  ProvisioningResult,
  ProvisioningState,
  ProvisioningLogger,
  ChiselProvDeps,
  AutoeliaProvDeps,
  CertbotProvDeps,
  NginxProvDeps,
  InvitePageDeps,
  ConfigDeps,
  HealthCheckDeps,
  ProvisionServerOptions,
} from './provisioning.js';

// Registry credential brokering (Feria) — see registry-credential.ts
export {
  REGISTRY_CREDENTIAL_FILENAME,
  FERIA_GROUP_PREFIX,
  AGENT_REGISTRY_TOKEN_LIFETIME,
  LAMASTE_SERVER_OIDC_CLIENT_ID,
  LAMASTE_REGISTRY_OIDC_SCOPE,
  LAMASTE_REGISTRY_OIDC_SCOPES,
  AUTHELIA_LOCAL_TOKEN_ENDPOINT,
  TOKEN_REFRESH_MARGIN_MS,
  RegistryAuthSchema,
  RegistryCredentialConfigSchema,
  RegistryCredentialError,
  RegistryServiceTokenCache,
  AgentTokenBroker,
  registryCredentialPath,
  migrateRegistryCredentialConfig,
  readRegistryCredentialConfig,
  writeRegistryCredentialConfig,
  clearRegistryCredentialConfig,
  summariseRegistryCredential,
  registryAudience,
  autheliaIssuer,
  lamasteServerOidcClient,
  requestClientCredentialsToken,
  loginToRegistry,
  obtainRegistryServiceToken,
  verifyRegistryCredential,
  brokerAgentRegistryToken,
  revokeRegistryTokensForOwner,
  lostFeriaGroups,
} from './registry-credential.js';
export type {
  RegistryAuth,
  RegistryCredentialConfig,
  RegistryCredentialSummary,
  AgentRegistryCredential,
  RegistryServiceToken,
  OidcBrokerDeps,
  RegistryServiceTokenDeps,
  ClientCredentialsRequest,
  RegistryCallDeps,
  AgentTokenBrokerOptions,
  AgentTokenAcquisition,
} from './registry-credential.js';
