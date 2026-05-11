/**
 * Cloud provider types for Lamaste server provisioning.
 */

// ---------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------

export interface Region {
  readonly slug: string;
  readonly name: string;
  readonly available: boolean;
}

export interface RegionWithLatency extends Region {
  readonly latencyMs: number;
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

export interface TokenValidation {
  readonly valid: boolean;
  readonly email: string;
  readonly missingScopes: readonly string[];
  readonly excessScopes: readonly string[];
  readonly hasDnsAccess: boolean;
}

// ---------------------------------------------------------------------------
// DNS (DigitalOcean managed domains)
// ---------------------------------------------------------------------------

export interface DODomain {
  readonly name: string;
  readonly ttl: number;
}

export interface DODomainRecord {
  readonly id: number;
  readonly type: string;
  readonly name: string;
  readonly data: string;
  readonly ttl: number;
}

export interface DnsSetupResult {
  readonly domain: string;
  readonly aRecordCreated: boolean;
  readonly wildcardCreated: boolean;
  readonly conflictWarning?: string | undefined;
  readonly createdRecordIds: readonly number[];
}

// ---------------------------------------------------------------------------
// Droplet size
// ---------------------------------------------------------------------------

export interface DropletSize {
  readonly slug: string;
  readonly memory: number;
  readonly vcpus: number;
  readonly disk: number;
  readonly priceMonthly: number;
  readonly available: boolean;
}

// ---------------------------------------------------------------------------
// SSH key
// ---------------------------------------------------------------------------

export interface SSHKey {
  readonly id: string;
  readonly name: string;
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export type ServerStatus = 'new' | 'active' | 'off' | 'archive';

export interface Server {
  readonly id: string;
  readonly name: string;
  readonly status: ServerStatus;
  readonly ip: string | null;
  readonly region: string;
  readonly createdAt: string;
  readonly tags: readonly string[];
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoveredServer {
  readonly dropletId: string;
  readonly name: string;
  readonly status: string;
  readonly ip: string | null;
  readonly region: string;
  readonly createdAt: string;
  readonly domains: readonly string[];
  readonly panelUrl: string | null;
}

export interface CreateServerOptions {
  readonly region: string;
  readonly sshKeyId: string;
  readonly name: string;
  readonly size?: string | undefined;
  readonly tags?: readonly string[];
}

// ---------------------------------------------------------------------------
// Server registry (local)
// ---------------------------------------------------------------------------

export interface ServerEntry {
  readonly id: string;
  readonly label: string;
  readonly panelUrl: string;
  readonly ip: string;
  readonly domain?: string | undefined;
  readonly provider?: string | undefined;
  readonly providerId?: string | undefined;
  readonly region?: string | undefined;
  readonly createdAt: string;
  readonly active: boolean;
  readonly authMethod: 'p12' | 'keychain';
  readonly keychainIdentity?: string | undefined;
  readonly p12Path?: string | undefined;
  readonly p12Password?: string | undefined;
}

// ---------------------------------------------------------------------------
// Provisioning progress (NDJSON protocol)
// ---------------------------------------------------------------------------

export type ProvisionStep =
  | 'validate_token'
  | 'generate_ssh_key'
  | 'upload_ssh_key'
  | 'create_droplet'
  | 'wait_droplet'
  | 'setup_dns'
  | 'wait_ssh'
  | 'install_lamaste'
  | 'retrieve_credentials'
  | 'enroll_admin'
  | 'save_registry'
  | 'cleanup';

export type StepStatus = 'running' | 'done' | 'failed';

export interface StepEvent {
  readonly event: 'step';
  readonly step: ProvisionStep;
  readonly status: StepStatus;
  readonly data?: Record<string, unknown>;
}

export interface ErrorEvent {
  readonly event: 'error';
  readonly step: ProvisionStep;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface CleanupFailedEvent {
  readonly event: 'cleanup-failed';
  readonly resources: ReadonlyArray<{ readonly label: string; readonly message: string }>;
}

export interface CompleteEvent {
  readonly event: 'complete';
  readonly server: ServerEntry;
}

export type ProgressEvent = StepEvent | ErrorEvent | CleanupFailedEvent | CompleteEvent;

// ---------------------------------------------------------------------------
// Provisioner options
// ---------------------------------------------------------------------------

export interface ProvisionOptions {
  readonly provider: string;
  readonly token: string;
  readonly region: string;
  readonly label: string;
  readonly size?: string | undefined;
  readonly domain?: string | undefined;
  readonly email?: string | undefined;
  readonly platform: 'darwin' | 'linux';
  readonly doDomain?: string | undefined;
  readonly doSubdomain?: string | undefined;
  readonly overrideDns?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Storage provider
// ---------------------------------------------------------------------------

export type StorageProviderName = 'spaces';

/** S3 bucket naming: 3-63 chars, lowercase alphanumeric and hyphens. */
export const BUCKET_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export interface StorageRegion {
  readonly slug: string;
  readonly name: string;
  readonly endpoint: string;
}

// ---------------------------------------------------------------------------
// Storage server registry (local)
// ---------------------------------------------------------------------------

export interface StorageServerEntry {
  readonly id: string;
  readonly label: string;
  readonly provider: StorageProviderName;
  readonly region: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Storage provisioning progress (NDJSON protocol)
// ---------------------------------------------------------------------------

export type StorageProvisionStep =
  | 'validate_credentials'
  | 'create_bucket'
  | 'save_registry';

export interface StorageStepEvent {
  readonly event: 'step';
  readonly step: StorageProvisionStep;
  readonly status: StepStatus;
  readonly data?: Record<string, unknown>;
}

export interface StorageErrorEvent {
  readonly event: 'error';
  readonly step: StorageProvisionStep;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface StorageCleanupFailedEvent {
  readonly event: 'cleanup-failed';
  readonly resources: ReadonlyArray<{ readonly label: string; readonly message: string }>;
}

export interface StorageCompleteEvent {
  readonly event: 'complete';
  readonly storageServer: StorageServerEntry;
}

export type StorageProgressEvent =
  | StorageStepEvent
  | StorageErrorEvent
  | StorageCleanupFailedEvent
  | StorageCompleteEvent;

// ---------------------------------------------------------------------------
// Storage provisioner options
// ---------------------------------------------------------------------------

export interface StorageProvisionOptions {
  readonly provider: StorageProviderName;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly region: string;
  readonly label: string;
  readonly bucket?: string | undefined;
}

// ---------------------------------------------------------------------------
// Panel update progress (NDJSON protocol)
// ---------------------------------------------------------------------------

export type UpdateStep =
  | 'generate_ssh_key'
  | 'upload_ssh_key'
  | 'wait_ssh'
  | 'update_panel'
  | 'verify_health'
  | 'cleanup';

export interface UpdateStepEvent {
  readonly event: 'step';
  readonly step: UpdateStep;
  readonly status: StepStatus;
  readonly data?: Record<string, unknown>;
}

export interface UpdateErrorEvent {
  readonly event: 'error';
  readonly step: UpdateStep;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface UpdateCleanupFailedEvent {
  readonly event: 'cleanup-failed';
  readonly resources: ReadonlyArray<{ readonly label: string; readonly message: string }>;
}

export interface UpdateCompleteEvent {
  readonly event: 'complete';
  readonly version: string;
}

export type UpdateProgressEvent =
  | UpdateStepEvent
  | UpdateErrorEvent
  | UpdateCleanupFailedEvent
  | UpdateCompleteEvent;

// ---------------------------------------------------------------------------
// Panel update options
// ---------------------------------------------------------------------------

export interface UpdateOptions {
  readonly token: string;
  readonly serverId: string;
  readonly version: string;
}
