/**
 * Shared TypeScript interfaces for the Lamaste ecosystem.
 *
 * These types are consumed by lamaste-server-ui, lamaste-agent-ui,
 * desktop, and backend packages alike.
 */

import type { PluginMode } from './constants.js';

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

export interface PluginPanelPage {
  readonly path: string;
  readonly title: string;
  readonly icon?: string;
  readonly description?: string;
}

/** Flat (single-page) panel declaration. */
export interface PluginPanelFlat {
  readonly label?: string;
  readonly icon?: string;
  readonly route?: string;
}

/** Multi-page panel declaration. */
export interface PluginPanelMulti {
  readonly pages: readonly PluginPanelPage[];
  readonly apiPrefix?: string;
}

export type PluginPanel = PluginPanelFlat | PluginPanelMulti;

export interface PluginConfigEntry {
  readonly type: 'string' | 'number' | 'boolean';
  readonly default?: string | number | boolean;
  readonly description?: string;
  readonly enum?: readonly (string | number)[];
}

export interface PluginManifest {
  readonly name: string;
  readonly displayName?: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly packages: {
    readonly server?: string;
    readonly agent?: string;
  };
  readonly panel: PluginPanel;
  readonly config: Readonly<Record<string, PluginConfigEntry>>;
  readonly modes: readonly PluginMode[];
}

// ---------------------------------------------------------------------------
// Plugin registry entry
// ---------------------------------------------------------------------------

export type PluginStatus = 'enabled' | 'disabled';

export interface PluginRegistryEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly packageName: string;
  readonly version: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly packages: {
    readonly server?: string;
    readonly agent?: string;
  };
  readonly panel: PluginPanel;
  readonly config: Readonly<Record<string, PluginConfigEntry>>;
  readonly modes: readonly PluginMode[];
  status: PluginStatus;
  readonly installedAt: string;
  enabledAt?: string;
  updatedAt?: string;
}

export interface PluginRegistry {
  plugins: PluginRegistryEntry[];
}

// ---------------------------------------------------------------------------
// AdminClient interface
// ---------------------------------------------------------------------------

/**
 * AdminClient — the data layer abstraction for the admin panel.
 *
 * Each host (web panel, desktop app) provides its own implementation:
 * - Web panel: uses apiFetch() with browser mTLS
 * - Desktop app: uses Tauri invoke() -> Rust -> curl + P12
 */
export interface AdminClient {
  // Users
  getUsers(): Promise<{ users: unknown[] }>;
  createUser(data: {
    username: string;
    displayname: string;
    email: string;
    password: string;
    groups?: string[];
  }): Promise<{ ok: boolean; user: unknown }>;
  updateUser(
    username: string,
    data: {
      displayname?: string;
      email?: string;
      password?: string;
      groups?: string[];
    },
  ): Promise<{ ok: boolean; user: unknown }>;
  deleteUser(username: string): Promise<{ ok: boolean }>;
  resetTotp(username: string): Promise<{ ok: boolean; totpUri: string }>;

  // Invitations
  getInvitations(): Promise<{ invitations: unknown[] }>;
  createInvitation(data: {
    username: string;
    email: string;
    groups?: string[];
    expiresInDays?: number;
  }): Promise<{ ok: boolean; invitation: unknown; token: string }>;
  revokeInvitation(id: string): Promise<{ ok: boolean }>;

  // Sites
  getSites(): Promise<{ sites: unknown[] }>;
  createSite(data: {
    name: string;
    type: string;
    customDomain?: string;
    spaMode?: boolean;
    autheliaProtected?: boolean;
  }): Promise<{ ok: boolean; site: unknown }>;
  deleteSite(id: string): Promise<{ ok: boolean }>;
  updateSite(
    id: string,
    data: {
      spaMode?: boolean;
      autheliaProtected?: boolean;
      allowedUsers?: string[];
    },
  ): Promise<{ ok: boolean; site: unknown }>;
  getSiteFiles(id: string, path?: string): Promise<{ files: unknown[]; path: string }>;
  uploadSiteFiles(id: string, path: string, files: unknown): Promise<unknown>;
  deleteSiteFile(id: string, filePath: string): Promise<{ ok: boolean }>;
  verifySiteDns(id: string): Promise<unknown>;

  // Certificates
  getCerts(): Promise<{ certs: unknown[] }>;
  renewCert(domain: string): Promise<unknown>;
  rotateMtls(): Promise<unknown>;
  downloadMtls(): Promise<unknown>;
  getAuthMode(): Promise<{ adminAuthMode: string }>;
  getAutoRenewStatus(): Promise<{ active: boolean; nextRun?: string; lastRun?: string }>;
  getAgentCerts(): Promise<{ agents: unknown[] }>;
  generateAgentCert(data: {
    label: string;
    capabilities?: string[];
    allowedSites?: string[];
  }): Promise<unknown>;
  revokeAgentCert(label: string): Promise<{ ok: boolean }>;
  createEnrollmentToken(data: {
    label: string;
    capabilities?: string[];
    allowedSites?: string[];
  }): Promise<{ ok: boolean; enrollmentToken: string; expiresAt: string }>;
  revokeEnrollmentToken(label: string): Promise<{ ok: boolean }>;
  updateAgentCapabilities(label: string, capabilities: string[]): Promise<unknown>;
  updateAgentAllowedSites(label: string, allowedSites: string[]): Promise<unknown>;
  downloadAgentCert(label: string): Promise<unknown>;

  // Services + System
  getServices(): Promise<{ services: unknown[] }>;
  serviceAction(name: string, action: string): Promise<unknown>;
  getSystemStats(): Promise<Record<string, unknown>>;
  triggerPanelUpdate(data: { version: string }): Promise<{ ok: boolean; message: string }>;

  // Logs
  startLogStream(
    service: string,
    onLine: (line: { timestamp: string; message: string }) => void,
  ): () => void;

  // Tickets
  getTicketScopes(): Promise<{ scopes: unknown[] }>;
  createTicketScope(data: Record<string, unknown>): Promise<unknown>;
  deleteTicketScope(name: string): Promise<{ ok: boolean }>;
  getTicketInstances(): Promise<{ instances: unknown[] }>;
  deleteTicketInstance(id: string): Promise<{ ok: boolean }>;
  getTicketAssignments(): Promise<{ assignments: unknown[] }>;
  createTicketAssignment(data: {
    agentLabel: string;
    instanceScope: string;
  }): Promise<{ ok: boolean }>;
  deleteTicketAssignment(
    agentLabel: string,
    instanceScope: string,
  ): Promise<{ ok: boolean }>;
  getTickets(): Promise<{ tickets: unknown[] }>;
  revokeTicket(id: string): Promise<{ ok: boolean }>;
  getTicketSessions(): Promise<{ sessions: unknown[] }>;
  killTicketSession(id: string): Promise<{ ok: boolean }>;

  // Plugins
  getPlugins(): Promise<{ plugins: unknown[] }>;
  installPlugin(packageName: string): Promise<unknown>;
  enablePlugin(name: string): Promise<{ ok: boolean }>;
  disablePlugin(name: string): Promise<{ ok: boolean }>;
  uninstallPlugin(name: string): Promise<{ ok: boolean }>;
  fetchPluginBundle(name: string): Promise<string>;
  getPushInstallConfig(): Promise<Record<string, unknown>>;
  updatePushInstallConfig(data: Record<string, unknown>): Promise<unknown>;
  getPushInstallPolicies(): Promise<{ policies: unknown[] }>;
  createPushInstallPolicy(data: Record<string, unknown>): Promise<unknown>;
  deletePushInstallPolicy(id: string): Promise<{ ok: boolean }>;
  updatePushInstallPolicy(
    id: string,
    data: {
      name?: string;
      description?: string;
      allowedIps?: string[];
      deniedIps?: string[];
      allowedPlugins?: string[];
      allowedActions?: string[];
    },
  ): Promise<{ ok: boolean; policy: unknown }>;
  enablePushInstall(
    label: string,
    data: { durationMinutes: number; policyId?: string },
  ): Promise<unknown>;
  disablePushInstall(label: string): Promise<{ ok: boolean }>;
  pushInstallCommand(
    label: string,
    data: { action: string; packageName?: string },
  ): Promise<unknown>;
  getPushInstallSessions(): Promise<{ sessions: unknown[] }>;

  // 2FA
  get2faStatus(): Promise<{ enabled: boolean; setupComplete: boolean }>;
  setup2fa(): Promise<{ uri: string; manualKey: string }>;
  confirm2fa(code: string): Promise<{ enabled: boolean }>;
  verify2fa(code: string): Promise<{ verified: boolean }>;
  disable2fa(code: string): Promise<{ enabled: boolean }>;

  // Storage
  registerStorageServer(data: {
    id: string;
    label: string;
    provider: string;
    region: string;
    bucket: string;
    endpoint: string;
    accessKey: string;
    secretKey: string;
  }): Promise<Record<string, unknown>>;
  getStorageServers(): Promise<{ servers: unknown[] }>;
  deleteStorageServer(id: string): Promise<{ ok: boolean }>;
  createStorageBinding(data: {
    pluginName: string;
    storageServerId: string;
  }): Promise<Record<string, unknown>>;
  getStorageBindings(): Promise<{ bindings: unknown[] }>;
  getStorageBinding(pluginName: string): Promise<Record<string, unknown>>;
  deleteStorageBinding(pluginName: string): Promise<{ ok: boolean }>;

  // Identity
  getIdentitySelf(): Promise<{
    username: string;
    displayName: string;
    email: string;
    groups: string[];
  }>;
  getIdentityUsers(): Promise<{ users: unknown[] }>;
  getIdentityUser(username: string): Promise<{ user: Record<string, unknown> }>;
  getIdentityGroups(): Promise<{ groups: string[] }>;

  // Agents
  getAgents(): Promise<{ agents: unknown[] }>;

  // User Plugin Access
  getUserAccessGrants(): Promise<{ grants: unknown[] }>;
  createUserAccessGrant(data: {
    username: string;
    pluginName: string;
    target?: string;
  }): Promise<{ ok: boolean; grant: unknown }>;
  revokeUserAccessGrant(grantId: string): Promise<{ ok: boolean }>;

  // Tunnels
  getTunnels(): Promise<{ tunnels: unknown[] }>;
  createTunnel(data: {
    subdomain: string;
    port: number;
    description?: string;
    type?: string;
    pluginName?: string;
    agentLabel?: string;
    accessMode?: string;
  }): Promise<{ ok: boolean; tunnel: unknown }>;
  toggleTunnel(id: string, data: { enabled: boolean }): Promise<{ ok: boolean; tunnel: unknown }>;
  deleteTunnel(id: string): Promise<{ ok: boolean }>;
  getTunnelAgentConfig(): Promise<Record<string, unknown>>;
  getMacPlist(format?: string): Promise<unknown>;

  // Gatekeeper Groups
  getGatekeeperGroups(): Promise<{ groups: unknown[] }>;
  createGatekeeperGroup(data: {
    name: string;
    description?: string;
    createdBy?: string;
  }): Promise<{ ok: boolean; group: unknown }>;
  updateGatekeeperGroup(
    name: string,
    data: { name?: string; description?: string },
  ): Promise<{ ok: boolean; group: unknown }>;
  deleteGatekeeperGroup(name: string): Promise<{ ok: boolean; deletedGrants: number }>;
  addGatekeeperGroupMembers(
    name: string,
    data: { usernames: string[] },
  ): Promise<{ ok: boolean; group: unknown }>;
  removeGatekeeperGroupMember(
    name: string,
    username: string,
  ): Promise<{ ok: boolean; group: unknown }>;

  // Gatekeeper Grants
  getGatekeeperGrants(filter?: unknown): Promise<{ grants: unknown[] }>;
  createGatekeeperGrant(data: {
    principalType: string;
    principalId: string;
    resourceType: string;
    resourceId: string;
    context?: Record<string, unknown>;
  }): Promise<{ ok: boolean; grant: unknown }>;
  revokeGatekeeperGrant(grantId: string): Promise<{ ok: boolean; grant: unknown }>;

  // Gatekeeper Diagnostics
  checkGatekeeperAccess(
    username: string,
    resourceType: string,
    resourceId: string,
  ): Promise<Record<string, unknown>>;
  bustGatekeeperCache(): Promise<void>;

  // Gatekeeper Settings
  getGatekeeperSettings(): Promise<{ settings: Record<string, unknown> }>;
  updateGatekeeperSettings(
    data: Record<string, unknown>,
  ): Promise<{ ok: boolean; settings: Record<string, unknown> }>;

  // Gatekeeper Access Log
  getAccessRequestLog(
    limit?: number,
    offset?: number,
  ): Promise<{ entries: unknown[]; total: number }>;
  clearAccessRequestLog(): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// AgentClient interface
// ---------------------------------------------------------------------------

/**
 * AgentClient — the data layer abstraction for the agent panel.
 *
 * Each host (desktop app, web agent panel) provides its own implementation:
 * - Desktop app: uses Tauri invoke() -> Rust subprocess calls
 * - Web agent panel: uses apiFetch() with HTTP requests
 */
export interface AgentClient {
  // Status & Control
  getStatus(): Promise<{
    running: boolean;
    pid?: number;
    chiselVersion?: string;
    installed?: boolean;
  }>;
  startAgent(): Promise<unknown>;
  stopAgent(): Promise<unknown>;
  restartAgent(): Promise<unknown>;
  updateAgent(): Promise<unknown>;

  // Tunnels
  getTunnels(): Promise<unknown[]>;
  createTunnel(data: {
    subdomain: string;
    port: number;
    description?: string;
  }): Promise<unknown>;
  toggleTunnel(id: string, data: { enabled: boolean }): Promise<unknown>;
  deleteTunnel(id: string): Promise<unknown>;

  // Services
  scanServices(): Promise<{ services: unknown[]; dockerContainers: unknown[] }>;
  getServiceRegistry(): Promise<{ services: unknown[] }>;
  addCustomService(data: {
    name: string;
    port: number;
    binary?: string;
    processName?: string;
    category: string;
    description: string;
  }): Promise<unknown>;
  removeCustomService(id: string): Promise<unknown>;

  // Logs
  getLogs(): Promise<string>;

  // Configuration
  getConfig(): Promise<Record<string, unknown>>;
  getPanelUrl(): Promise<string>;

  // Certificate
  rotateCertificate(): Promise<unknown>;
  downloadCertificate(): Promise<unknown>;

  // Web Panel
  getPanelExposeStatus(): Promise<{
    enabled: boolean;
    fqdn?: string;
    port?: number;
    running?: boolean;
  }>;
  togglePanelExpose(enabled: boolean): Promise<unknown>;
  startAgentPanel(): Promise<unknown>;
  stopAgentPanel(): Promise<unknown>;

  // Lifecycle
  uninstallAgent(): Promise<unknown>;

  // Plugins
  getAgentPlugins(): Promise<{ plugins: unknown[] }>;
  installAgentPlugin(packageName: string): Promise<{ ok: boolean; plugin: unknown }>;
  enableAgentPlugin(name: string): Promise<unknown>;
  disableAgentPlugin(name: string): Promise<unknown>;
  uninstallAgentPlugin(name: string): Promise<unknown>;
  updateAgentPlugin(name: string): Promise<unknown>;
  fetchAgentPluginBundle(name: string): Promise<{ type: string; source: string }>;
  checkAgentPluginUpdate(name: string): Promise<{
    name: string;
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
  }>;

  // External links (host-specific)
  openExternal(url: string): Promise<void>;
}
