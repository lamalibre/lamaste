/**
 * Cloud provider types for Portlama server provisioning.
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
  | 'install_portlama'
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

export interface CompleteEvent {
  readonly event: 'complete';
  readonly server: ServerEntry;
}

export type ProgressEvent = StepEvent | ErrorEvent | CompleteEvent;

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
