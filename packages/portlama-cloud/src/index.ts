/**
 * @lamalibre/portlama-cloud
 *
 * Cloud provider abstraction for Portlama server provisioning.
 * Starting with DigitalOcean, architecture supports all major providers.
 */

// Types
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
  CompleteEvent,
  ProgressEvent,
  ProvisionOptions,
  DODomain,
  DODomainRecord,
  DnsSetupResult,
} from './types.js';

// Errors
export { CloudHttpError, TokenScopeError, CloudError } from './errors.js';

// Provider interface
export type { CloudProvider } from './provider.js';

// DigitalOcean provider
export { DigitalOceanProvider } from './digitalocean/index.js';
export { validateDOToken, assertValidDOToken, REQUIRED_SCOPES } from './digitalocean/scopes.js';
export { probeRegionLatencies } from './digitalocean/latency.js';
export { listDomains, createDomain, listDomainRecords, deleteDomainRecord, setupDnsRecords } from './digitalocean/dns.js';

// Provisioner
export { provision } from './provisioner.js';

// SSH utilities (only safe functions exported; sshExec/scpDownload are internal
// because their command/path parameters are shell-interpreted on the remote host)
export {
  generateKeyPair,
  waitForSSH,
  secureDelete,
  cleanupKeyPair,
} from './ssh.js';

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
