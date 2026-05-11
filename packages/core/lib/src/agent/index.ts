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
  getAgentPid,
  loadAgent,
  unloadAgent,
  restartAgent,
  isPanelServiceLoaded,
  loadPanelService,
  unloadPanelService,
  restartPanelService,
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
} from './plugins.js';
export type {
  PluginRegistryEntry,
  PluginRegistry,
  PluginUpdateInfo,
  PluginLifecycleConfig,
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
