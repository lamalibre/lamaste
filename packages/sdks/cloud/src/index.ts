/**
 * @lamalibre/lamaste-cloud
 *
 * Cloud provider abstraction for Lamaste server provisioning.
 * Starting with DigitalOcean, architecture supports all major providers.
 */

// Types — compute
export type {
  Region,
  RegionWithLatency,
  DropletSize,
  TokenValidation,
  SSHKey,
  Server,
  ServerStatus,
  CreateServerOptions,
  ServerEntry,
  ProvisionStep,
  StepStatus,
  StepEvent,
  ErrorEvent,
  CleanupFailedEvent,
  CompleteEvent,
  ProgressEvent,
  ProvisionOptions,
  DODomain,
  DODomainRecord,
  DnsSetupResult,
} from './types.js';

// Types — update
export type {
  UpdateStep,
  UpdateStepEvent,
  UpdateErrorEvent,
  UpdateCleanupFailedEvent,
  UpdateCompleteEvent,
  UpdateProgressEvent,
  UpdateOptions,
} from './types.js';

// Types — storage
export { BUCKET_NAME_REGEX } from './types.js';
export type {
  StorageProviderName,
  StorageRegion,
  StorageServerEntry,
  StorageProvisionStep,
  StorageStepEvent,
  StorageErrorEvent,
  StorageCleanupFailedEvent,
  StorageCompleteEvent,
  StorageProgressEvent,
  StorageProvisionOptions,
} from './types.js';

// Errors
export { CloudHttpError, TokenScopeError, CloudError } from './errors.js';

// Provider interfaces
export type { CloudProvider } from './provider.js';
export type { StorageProvider } from './storage-provider.js';

// DigitalOcean provider
export { DigitalOceanProvider } from './digitalocean/index.js';
export { validateDOToken, assertValidDOToken, REQUIRED_SCOPES } from './digitalocean/scopes.js';
export { probeRegionLatencies } from './digitalocean/latency.js';
export {
  listDomains,
  createDomain,
  listDomainRecords,
  deleteDomainRecord,
  updateARecord,
  setupDnsRecords,
} from './digitalocean/dns.js';
export { DigitalOceanSpacesProvider } from './digitalocean/spaces.js';

// Discovery
export type { DiscoveredServer } from './types.js';
export { discover } from './discover.js';

// SSH recovery
export type { RecoveryKeyPair, RecoveryResult } from './recover.js';
export {
  generateRecoveryKeyPair,
  testRecoverySSH,
  recoverAdmin,
  cleanupRecovery,
} from './recover.js';

// Provisioners
export { provision } from './provisioner.js';
export { provisionStorage } from './storage-provisioner.js';
export { update } from './updater.js';

// SSH utilities (only safe functions exported; sshExec/scpDownload are internal
// because their command/path parameters are shell-interpreted on the remote host)
export { generateKeyPair, waitForSSH, secureDelete, cleanupKeyPair } from './ssh.js';

// Server registry
export {
  loadServers,
  saveServers,
  addServer,
  removeServer,
  setActiveServer,
  getActiveServer,
  migrateFromAgentConfig,
  registryPath,
} from './registry.js';

// Storage server registry
export {
  loadStorageServers,
  saveStorageServers,
  addStorageServer,
  removeStorageServer,
  getStorageServer,
  storageRegistryPath,
} from './storage-registry.js';
