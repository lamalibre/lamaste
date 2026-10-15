/**
 * @lamalibre/lamaste/agent — Agent domain logic
 *
 * Platform paths, registry CRUD, config I/O, service lifecycle,
 * plugin management, service discovery, server registry, mode management.
 *
 * Operates on ~/.lamalibre/lamaste/ directory.
 */

// Platform paths and detection
export {
  LAMASTE_DIR,
  CHISEL_BIN_DIR,
  CHISEL_BIN_PATH,
  LOGS_DIR,
  LEGACY_CONFIG_PATH,
  AGENTS_REGISTRY_PATH,
  agentsRegistryPathIn,
  SERVERS_REGISTRY_PATH,
  STORAGE_SERVERS_REGISTRY_PATH,
  SERVICES_REGISTRY_PATH,
  TMP_DIR,
  tmpDir,
  adminTmpDir,
  agentTmpDir,
  LEGACY_PLIST_LABEL,
  LEGACY_PLIST_PATH,
  LEGACY_LOG_FILE,
  LEGACY_ERROR_LOG_FILE,
  LEGACY_SYSTEMD_UNIT_PATH,
  LEGACY_SERVICE_CONFIG_PATH,
  LOCAL_DIR,
  agentsDir,
  agentDataDir,
  agentConfigPath,
  agentLogsDir,
  agentLogFile,
  agentErrorLogFile,
  plistLabel,
  plistPath,
  systemdUnitName,
  systemdUnitPath,
  serviceConfigPath,
  agentPluginsFile,
  agentPluginsDir,
  panelLogFile,
  panelErrorLogFile,
  panelPlistLabel,
  panelPlistPath,
  panelSystemdUnitName,
  panelSystemdUnitPath,
  panelServiceConfigPath,
  localDir,
  localPluginsFile,
  localPluginsDir,
  localHostLogsDir,
  localHostLogFile,
  localHostErrorLogFile,
  localHostPlistLabel,
  localHostPlistPath,
  localHostSystemdUnitName,
  localHostSystemdUnitPath,
  localHostServiceConfigPath,
  serverDataDir,
  serverAdminP12Path,
  isDarwin,
  isLinux,
  assertSupportedPlatform,
  detectArch,
} from './platform.js';

// Agent registry
export {
  AGENT_LABEL_RE,
  validateLabel,
  deriveLabel,
  loadRegistry,
  saveRegistry,
  getAgent,
  addAgent,
  upsertAgent,
  removeAgent,
  setCurrentAgent,
  listAgents,
  getCurrentLabel,
  resolveLabel,
  migrateFromLegacy,
} from './registry.js';
export type { AgentRegistryEntry, AgentRegistry } from './registry.js';

// Agent config
export { loadAgentConfig, saveAgentConfig, requireAgentConfig } from './config.js';
export type { AgentConfig } from './config.js';

// Service lifecycle (unified dispatch)
export {
  isAgentLoaded,
  isAgentEnabled,
  getAgentPid,
  loadAgent,
  unloadAgent,
  restartAgent,
  isPanelServiceLoaded,
  loadPanelService,
  unloadPanelService,
  restartPanelService,
  panelRestartCommand,
  DETACHED_SPAWN_OPTIONS,
  listLoadedAgents,
  listLoadedAgentsCached,
  clearLoadedAgentsCache,
} from './service.js';
export type { LoadedAgentState } from './service.js';

// macOS launchctl (direct access when needed)
export {
  isAgentLoaded as macIsAgentLoaded,
  getAgentPid as macGetAgentPid,
  loadAgent as macLoadAgent,
  unloadAgent as macUnloadAgent,
} from './launchctl.js';

// Linux systemd (direct access when needed)
export {
  isAgentActive as linuxIsAgentActive,
  getAgentPid as linuxGetAgentPid,
  startAgent as linuxStartAgent,
  stopAgent as linuxStopAgent,
} from './systemd.js';

// Chisel client service — the single implementation for CLI and daemon
export {
  parseChiselArgs,
  chiselClientArgs,
  chiselEnvFilePath,
  renderChiselPlist,
  renderChiselSystemdUnit,
  writeChiselService,
  secureAgentDataDir,
  relayServerUrl,
  assertRelayServerUrl,
  CHISEL_MAX_RETRY_INTERVAL,
  userLingerStatus,
  enableLingerCommand,
} from './chisel-service.js';
export type { ChiselClientSpec, ChiselCredential } from './chisel-service.js';
export {
  chiselCredentialPath,
  loadChiselCredential,
  saveChiselCredential,
} from './chisel-credential.js';
export type { StoredChiselCredential } from './chisel-credential.js';
export { ensureAgentChiselBinary, installedAgentChiselVersion } from './chisel-binary.js';
export type { AgentChiselBinaryResult } from './chisel-binary.js';
export { convergeChiselService, setAgentTunnelsStopped, updateAgentConfig } from './converge.js';
export { withAgentLock } from './agent-lock.js';

// App plugins (hosting an agent-hosted plugin's agent half on this agent)
export {
  appPluginsDir,
  appPluginConfigPath,
  readAppPluginConfigFile,
  loadAppPluginConfig,
  saveAppPluginConfig,
  removeAppPluginConfig,
  listAppPluginConfigs,
  parseAppPluginAssignments,
  syncAppPluginConfigs,
  createCallerAssertionVerifier,
} from './app-plugins.js';
export type {
  AgentAppPluginConfig,
  AppPluginAssignment,
  IssuedAppPluginConfig,
  AppPluginPanelCalls,
  AppPluginSyncResult,
  CallerAssertionVerifierOptions,
  CallerAssertionVerifier,
} from './app-plugins.js';
export {
  PANEL_LOSS_DOWN_AFTER_MS,
  parseAgentJobs,
  runAgentJobs,
  parseTunnelHookAssignments,
  syncAgentTunnelHooks,
  agentTunnelHooksOnPanelLoss,
  createAgentHookHandler,
} from './app-plugin-hooks.js';
export type {
  AgentJob,
  AgentHookJob,
  AgentAppJob,
  AgentAppInstallJob,
  AgentAppActivateJob,
  AgentAppRemoveJob,
  AgentRefusedAppJob,
  AgentAppJobHandlers,
  AgentAppJobOutcome,
  AgentJobDeferral,
  AgentJobRunOptions,
  AgentJobResult,
  AgentJobReporter,
  AgentJobRunResult,
  AgentTunnelHookDecl,
  TunnelHookAssignment,
  AgentHookRequest,
  AgentHookResponse,
  AgentHookHandlerOptions,
} from './app-plugin-hooks.js';
// App host helper (slice 3): running lamaste-apphost, the record of the agent
// halves it installed here, and the host facts the relay checks hosting against
export { appServiceAccountComment } from '../agent-half.js';
export {
  APPHOST_EXIT_NOT_INSTALLED,
  APPHOST_EXIT_NOT_OWNER,
  APPHOST_EXIT_UNSIGNED,
  RELAY_PIN_VERSION,
  relayPinJson,
  parseRelayPin,
  readRelayPin,
  pinnedRelayKid,
  appHostInvocation,
  runAppHost,
  appHostFailure,
  isAppHostEnabled,
  appHostHelperKey,
  parseAppHostStatus,
  parseAppHostOutcome,
  appHostStatus,
} from './apphost.js';
export type {
  AppHostRunOptions,
  AppHostRun,
  AppHostStatus,
  AppHostOutcome,
  AppHostAvailability,
  RelayPin,
  RelayPinState,
  ReadRelayPinOptions,
} from './apphost.js';
export {
  appHostStatePath,
  readAppHostState,
  appHostRoutes,
  recordAppHostApp,
  forgetAppHostApp,
  appHostRouteRecordedElsewhere,
  rebuildAppHostState,
} from './apphost-state.js';
export type { AppHostAppRecord, AppHostState } from './apphost-state.js';
export {
  HOST_FACTS_REFRESH_MS,
  parseOsRelease,
  probeAppHost,
  gatherHostFacts,
  hostFactsHash,
  hostFactsStatePath,
  syncHostFacts,
} from './host-facts.js';
export type {
  AppHostProbe,
  HostFactsSources,
  HostFactsPanelCalls,
  HostFactsSyncOptions,
  HostFactsSyncResult,
} from './host-facts.js';
export type {
  AgentConfigResponse,
  IssuedChiselCredential,
  ConvergePanelCalls,
  ConvergeOptions,
  ConvergeState,
  ConvergeResult,
} from './converge.js';
export {
  SYNC_INTERVAL_SECONDS,
  syncPlistLabel,
  syncPlistPath,
  syncSystemdServiceName,
  syncSystemdTimerName,
  syncLogFile,
  syncStateFile,
  resolveInstalledAgentCli,
  renderSyncPlist,
  renderSyncSystemdService,
  renderSyncSystemdTimer,
  installSyncService,
  removeSyncService,
  isSyncServiceLoaded,
  isSyncServiceInstalled,
  readSyncState,
  writeSyncState,
  isSyncStale,
} from './sync-service.js';
export type { AgentCliProgram, SyncState } from './sync-service.js';

// Linux user-systemd helpers — make `systemctl --user` work in non-PAM root
// shells (multipass exec, cron, npx-from-installer).
export { userSystemdEnv, runUserSystemctl } from './user-systemd-env.js';

// Plugin lifecycle (unified for agent + local)
export {
  readPluginRegistry,
  writePluginRegistry,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  updatePlugin,
  checkPluginUpdate,
  readPluginBundle,
  agentPluginConfig,
  localPluginConfig,
  withInstallNpmrc,
  renderInstallNpmrc,
  npmNerfDart,
} from './plugins.js';
export type {
  PluginRegistryEntry,
  PluginRegistry,
  PluginUpdateInfo,
  PluginLifecycleConfig,
  InstallNpmrc,
  PluginInstallOptions,
} from './plugins.js';

// Local plugin host service
export {
  generateLocalHostServiceConfig,
  writeLocalHostServiceConfig,
  isLocalHostLoaded,
  loadLocalHost,
  unloadLocalHost,
  restartLocalHost,
  removeLocalHostServiceConfig,
} from './local-host-service.js';

// Service discovery
export {
  sanitizeId,
  tcpProbe,
  findProcessPid,
  findListeningPort,
  isBinaryInstalled,
  detectService,
  parseDockerPorts,
  scanDocker,
  matchTunnels,
  scanServices,
  loadServiceRegistry,
  saveServiceRegistry,
  addCustomService,
  removeCustomService,
} from './service-discovery.js';
export type {
  DetectConfig,
  ServiceDefinition,
  ServiceRegistry,
  DetectedService,
  DockerPort,
  DockerContainer,
  ScanResult,
  TunnelInfo,
  ServiceCategory,
} from './service-discovery.js';

// Server registry
export {
  validateServerLabel,
  validatePanelUrl,
  loadServersRegistry,
  saveServersRegistry,
  getServers,
  getServer,
  setActiveServer,
  addServer,
  removeServer,
  updateServer,
  loadStorageServersRegistry,
  saveStorageServersRegistry,
  getStorageServers,
  getStorageServer,
  addStorageServer,
  removeStorageServer,
} from './server-registry.js';
export type { AdminAuth, ServerEntry, StorageServerEntry } from './server-registry.js';

// Mode management
export {
  setServerMode,
  getServerMode,
  hasAdminCert,
  getAdminCertPath,
  getActiveServerId,
  importAdminCert,
  removeAdminCert,
} from './mode.js';
export type { ServerMode } from './mode.js';

// Branding primitives (ORG / PROJECT are also re-exported from platform.js above)
export {
  ecosystemBundleId,
  productBundleId,
  ecosystemUnit,
  productUnit,
  userEcosystemRoot,
  userProductRoot,
  etcEcosystemRoot,
  etcProductRoot,
} from '../branding.js';
