/**
 * Shared TypeScript interfaces for the Lamaste ecosystem.
 *
 * These types are consumed by lamaste-server-ui, lamaste-agent-ui,
 * desktop, and backend packages alike.
 */

import type { PluginHosting, PluginMode } from './constants.js';
import type { HostEligibility } from './host-eligibility.js';
import type { AudienceChange, NormalizedIdentityBlock } from './identity.js';
import type { SettingsField, SettingsValue } from './plugin-settings.js';
import type { AgentBlock } from './schemas.js';

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
  readonly hosting: PluginHosting;
  /** The agent half of an agent-hosted plugin; absent for identity-only and server plugins. */
  readonly agent?: AgentBlock;
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
  /** Absent in entries written before 4.2 — those are server plugins. */
  readonly hosting?: PluginHosting;
  /** The agent half of an agent-hosted plugin (4.3); absent otherwise. */
  readonly agent?: AgentBlock;
  status: PluginStatus;
  readonly installedAt: string;
  enabledAt?: string;
  updatedAt?: string;
}

export interface PluginRegistry {
  plugins: PluginRegistryEntry[];
}

/**
 * What an agent keeps of an agent half Lamaste removed without purge (an
 * unhost, an uninstall, a rolled-back install): its data directory and its
 * account, recorded on the relay by the name of the plugin it belonged to —
 * so it can be purged, or its record forgotten, after the plugin is gone.
 */
export interface RetainedAgentData {
  readonly agentLabel: string;
  readonly route: string;
  /** The plugin it belonged to — possibly no longer installed. */
  readonly plugin: string;
  /** The agent package whose data it is. */
  readonly package: string;
  /** Since when the agent keeps it. */
  readonly since: string;
  /** The operation that removed the agent half, when one did. */
  readonly operation: string | null;
  /** What a purge deletes on the agent: the data directory… */
  readonly dataDir: string;
  /** …and the account (user and group) the agent half ran as. */
  readonly serviceUser: string;
}

// ---------------------------------------------------------------------------
// Users, the user directory and plugin audiences (4.5, slice 6)
// ---------------------------------------------------------------------------

/**
 * What a users change could not complete beside the change itself (a
 * session epoch, registry tokens, Gatekeeper's cleanup, an erasure): a
 * sentence, or the step and what went wrong. The change itself is done.
 */
export type AdminWarning = string | { readonly step: string; readonly message: string };

/** A user as `GET /api/users` lists them: Authelia's record with the directory's id. */
export interface AdminUser {
  readonly username: string;
  readonly displayname: string;
  readonly email: string;
  readonly groups: readonly string[];
  /** Authelia's `disabled: true` — the user cannot sign in. */
  readonly disabled: boolean;
  /** The directory's id (UUID v4); null until the directory has seen the user (within a minute). */
  readonly userId: string | null;
  readonly status: 'active' | 'disabled';
}

/**
 * A user as the directory keeps them — removed and erased users too. A
 * removed user keeps the username, name and address they last had until
 * erased; an erased one keeps the id alone.
 */
export interface DirectoryUserView {
  readonly userId: string;
  /** Null once erased. */
  readonly username: string | null;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly status: 'active' | 'disabled' | 'removed';
  /** `deleted`: through Lamaste; `deleted-outside`: gone from users.yml without it. */
  readonly removedReason: 'deleted' | 'deleted-outside' | null;
  readonly removedAt: string | null;
  readonly erasedAt: string | null;
  /**
   * When Gatekeeper dropped the grants and group memberships under the
   * username — null on a removed user while that cleanup is pending.
   */
  readonly principalClearedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Who erased the user, and when. */
  readonly erasure: { readonly requestedAt: string; readonly requestedBy: string } | null;
  /** The plugins whose agent half has not acknowledged the user's erasure yet. */
  readonly pendingErasures: readonly string[];
}

/** Why users cannot reach an agent-hosted plugin's `/app` yet; null when they can. */
export type IdentityReadinessReason =
  | 'not_installed'
  | 'no_identity'
  | 'not_approved'
  | 'not_hosted'
  | 'not_answered';

/**
 * An agent-hosted plugin's settings as the panel shows them
 * (`GET /api/plugins/:name/settings`): each non-secret field's effective
 * value, each secret only as set or not — never its value. `source` says
 * whether they were read from the agent half now (`live`), from the
 * relay's cache (`cache`) or never (`none`).
 */
export interface PluginSettingsView {
  readonly schemaVersion: number;
  readonly fields: SettingsField[];
  readonly values: Record<string, SettingsValue | { set: true; setAt: string } | { set: false }>;
  readonly configured: boolean;
  readonly missing: string[];
  readonly revision: number | null;
  readonly source: 'live' | 'cache' | 'none';
  readonly syncedAt: string | null;
  readonly hosting: {
    readonly agentLabel: string;
    readonly phase: string;
    readonly state: string;
    readonly reason: string | null;
    readonly since: string | null;
    readonly agentLastSeenAt: string | null;
  } | null;
}

/**
 * What the panel knows about an agent-hosted plugin's users: the identity
 * block its installed version declares, whether users can reach it, the
 * feed to its agent half, its audience in numbers and the erasures its half
 * has not acknowledged.
 */
export interface PluginIdentityView {
  /** The installed version's identity block, normalized; null: it declares none. */
  readonly declared: NormalizedIdentityBlock | null;
  readonly readiness: {
    readonly ready: boolean;
    readonly declared: boolean;
    readonly approved: boolean;
    readonly hostingActive: boolean;
    readonly version: string | null;
    /** The version whose agent half last answered the feed's protocol 1. */
    readonly readyVersion: string | null;
    readonly reason: IdentityReadinessReason | null;
  };
  /** Null for a plugin that declares no identity. */
  readonly sync: {
    readonly directoryId: string;
    /** The directory the agent half follows, as it last answered. */
    readonly halfDirectoryId: string | null;
    /** The seq the agent half has applied up to, as it last answered. */
    readonly cursor: number | null;
    /** The highest seq of the plugin's audience. */
    readonly head: number;
    /** How many audience rows the agent half has not applied. */
    readonly behind: number;
    readonly readyVersion: string | null;
    readonly lastSyncAt: string | null;
    readonly lastReconcileAt: string | null;
    /** What the last daily reconcile found out of step (non-zero: a feed bug, audited). */
    readonly lastMismatches: number | null;
    /** Why the last sync did not finish, or was not tried. */
    readonly lastError: string | null;
  } | null;
  readonly audience: {
    readonly active: number;
    readonly disabled: number;
    readonly removed: number;
    readonly erased: number;
  } | null;
  /** User ids whose erasure the agent half has not acknowledged. */
  readonly pendingErasures: readonly string[];
  readonly approval: {
    readonly approved: boolean;
    readonly state: 'not-required' | 'approved' | 'pending';
  };
}

/** `Omit` applied to each member of a union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An audience change as the panel stores it — the feed's change without its `seq`. */
export type StoredAudienceChange = DistributiveOmit<AudienceChange, 'seq'>;

/** One row of a plugin's audience: a member, or a user who left it (a tombstone). */
export interface PluginAudienceRow {
  readonly userId: string;
  readonly seq: number;
  readonly version: number;
  readonly updatedAt: string;
  /** Null when the stored row is not a change the panel can read. */
  readonly change: StoredAudienceChange | null;
}

/**
 * An entitlement: a Gatekeeper grant giving a user or a Lamaste group
 * roles on an agent-hosted plugin.
 */
export interface PluginEntitlement {
  readonly grantId: string;
  readonly principalType: 'user' | 'group';
  /** A username or a Lamaste group name. */
  readonly principalId: string;
  /** The directory id of a user principal (null for a group, or a user the directory lacks). */
  readonly userId: string | null;
  readonly roles: readonly string[];
  /** Roles the grant carries that the installed version no longer declares (they count for nothing). */
  readonly unknownRoles: readonly string[];
  readonly createdAt: string;
}

/** The principal of an entitlement. */
export interface EntitlementPrincipal {
  readonly principalType: 'user' | 'group';
  readonly principalId: string;
}

/** The outcome of one sync of a plugin's audience to its agent half. */
export interface IdentitySyncResult {
  readonly status: 'synced' | 'up-to-date' | 'skipped' | 'failed';
  /** Why it was skipped. */
  readonly reason?: string;
  /** Why it failed (or was skipped). */
  readonly error?: string;
  /** Where the agent half is now. */
  readonly cursor?: number;
  /** Whether everything was sent from 0. */
  readonly replay?: boolean;
  /** What a reconcile found out of step. */
  readonly mismatches?: number;
}

/**
 * How a route bound to a tunnel as a plugin's user surface is served: its
 * host carries the route's locations only while the plugin's installed,
 * approved version declares identity.
 */
export interface UserSurfaceRouteStatus {
  readonly route: string;
  readonly served: boolean;
  readonly reason: 'not_installed' | 'no_identity' | 'not_approved' | null;
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
  // Users — Authelia's users.yml, each with the directory's `userId` and `status`
  getUsers(): Promise<{ users: AdminUser[] }>;
  createUser(data: {
    username: string;
    displayname: string;
    email: string;
    password: string;
    groups?: string[];
  }): Promise<{ ok: boolean; user: AdminUser; warnings?: AdminWarning[] }>;
  updateUser(
    username: string,
    data: {
      displayname?: string;
      email?: string;
      password?: string;
      groups?: string[];
      disabled?: boolean;
    },
  ): Promise<{ ok: boolean; user: AdminUser; warnings?: AdminWarning[] }>;
  /**
   * Disable a user — the one offboarding action: they cannot sign in, every
   * plugin audience shows them disabled, the user surface refuses them, and
   * their desktop sessions and registry tokens end. Refused (`code`
   * `last_admin`) for the last enabled administrator.
   */
  disableUser(
    username: string,
  ): Promise<{ ok: boolean; user: AdminUser; warnings?: AdminWarning[] }>;
  enableUser(
    username: string,
  ): Promise<{ ok: boolean; user: AdminUser; warnings?: AdminWarning[] }>;
  /**
   * Delete a user: the directory keeps a tombstone (the id and the last
   * known name and address) so plugins' history stays readable; `erase`
   * scrubs it at once. `principalCleared`: Gatekeeper dropped the grants
   * and group memberships under the username (false: the cleanup is
   * pending, and nothing is given to the username until it is done).
   */
  deleteUser(
    username: string,
    options?: { erase?: boolean },
  ): Promise<{
    ok: boolean;
    userId: string | null;
    principalCleared: boolean;
    erased?: boolean;
    warnings?: AdminWarning[];
  }>;
  resetTotp(username: string): Promise<{ ok: boolean; totpUri: string }>;

  // User directory — every user it knows, removed and erased ones too
  getUserDirectory(): Promise<{ directoryId: string; users: DirectoryUserView[] }>;
  /**
   * Erase a removed user: the tombstone is scrubbed to the bare id, their
   * invitations and Gatekeeper's access-request log rows go, and every
   * plugin that had them is sent the erasure. Refused with `code`
   * `user_not_found`, `user_not_removed`, `already_erased` or
   * `gatekeeper_unavailable` (nothing erased).
   */
  eraseDirectoryUser(userId: string): Promise<{
    ok: boolean;
    userId: string;
    erasedAt: string;
    invitationsPurged: number;
    accessLogPurged: number;
  }>;

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
    aliases?: string[];
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
      aliases?: string[];
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
  deleteTicketAssignment(agentLabel: string, instanceScope: string): Promise<{ ok: boolean }>;
  getTickets(): Promise<{ tickets: unknown[] }>;
  revokeTicket(id: string): Promise<{ ok: boolean }>;
  getTicketSessions(): Promise<{ sessions: unknown[] }>;
  killTicketSession(id: string): Promise<{ ok: boolean }>;

  // Plugins
  /**
   * The installed plugins — each with the data agents keep of its agent
   * half (`retainedData`) — and, as the top-level `retainedData`, what every
   * agent keeps, of uninstalled plugins too.
   */
  getPlugins(): Promise<{ plugins: unknown[]; retainedData: RetainedAgentData[] }>;
  installPlugin(packageName: string): Promise<unknown>;
  enablePlugin(name: string): Promise<{ ok: boolean }>;
  disablePlugin(name: string): Promise<{ ok: boolean }>;
  /**
   * Uninstall (the plugin must be disabled). A hosted plugin is removed by
   * an operation (202 `{ operation }`) that runs its uninstall pipeline;
   * `force` lets failing pre-teardown hooks pass, `purge` deletes the data
   * directory and service account of the agent half Lamaste installed
   * (kept by default; refused when it installed none).
   */
  uninstallPlugin(
    name: string,
    options?: { force?: boolean; purge?: boolean },
  ): Promise<{ ok: boolean; operation?: unknown }>;
  fetchPluginBundle(name: string): Promise<string>;
  // Agent-hosted plugins with an agent half: which agent hosts the plugin.
  // Hosting and clearing it run the install / uninstall pipelines as
  // operations (202 `{ operation }`). A refused operation rejects with an
  // Error carrying the panel's message and, when it sent them, `code`
  // (`agent_not_eligible`, `push_install_refused`, `hooks_not_approved`),
  // `reasons` (why the agent cannot host the plugin) and `operationId`.
  getPluginHosting(name: string): Promise<{ hosting: unknown }>;
  /**
   * The enrolled machine agents, each eligible to host the plugin or not
   * with the reasons — its `agent.requires` and, when Lamaste installs the
   * agent half, what installing it needs, against the agent's host facts.
   */
  getPluginHostingEligibility(
    name: string,
  ): Promise<{ agents: Array<HostEligibility & { readonly label: string }> }>;
  setPluginHosting(name: string, agentLabel: string): Promise<{ ok: boolean; operation: unknown }>;
  /** `force` and `purge` as for {@link AdminClient.uninstallPlugin}. */
  clearPluginHosting(
    name: string,
    options?: { force?: boolean; purge?: boolean },
  ): Promise<{ ok: boolean; operation: unknown }>;
  rotatePluginHostingSecret(name: string): Promise<{ ok: boolean; hosting: unknown }>;
  // Retained data: what agents keep of the plugin's agent half after it was
  // removed without purge — by the plugin's name, so after it is uninstalled
  // too.
  getPluginRetainedData(name: string): Promise<{ retainedData: RetainedAgentData[] }>;
  /**
   * Purge what agent `agentLabel` keeps of the plugin's agent half — its
   * data directory and account — through the agent's app host helper: an
   * operation (kind `purge-data`), push-install gated as `uninstall`. A
   * refusal rejects as for {@link AdminClient.setPluginHosting}, with `code`
   * `push_install_refused`, `retained_data_in_use` or `agent_not_enrolled`.
   */
  purgePluginRetainedData(
    name: string,
    agentLabel: string,
  ): Promise<{ ok: boolean; operation: unknown }>;
  /**
   * Drop only the relay's record of what agent `agentLabel` keeps; the agent
   * is not touched and the data stays on the machine — for an agent that is
   * gone, or data removed there by hand.
   */
  forgetPluginRetainedData(
    name: string,
    agentLabel: string,
  ): Promise<{ ok: boolean; forgotten: RetainedAgentData }>;
  getPluginOperations(name: string): Promise<{ operations: unknown[] }>;
  getPluginOperation(name: string, id: string): Promise<{ operation: unknown }>;
  // Lifecycle hooks and what needs approval — the relay hook set and the
  // agent half Lamaste installs (`hooks.approval.digest` is what to approve)
  // — auto-approve
  getPluginHooks(name: string): Promise<{ hooks: unknown }>;
  // A pending update is approved by its digest, its version, or both; an
  // update with no relay hooks or agent half has no digest (`null`).
  approvePluginHooks(
    name: string,
    digest: string | null,
    version?: string,
  ): Promise<{ ok: boolean; hooks?: unknown; operation?: unknown }>;
  setPluginHooksAutoApprove(
    name: string,
    enabled: boolean,
  ): Promise<{ ok: boolean; autoApprove: boolean }>;
  // Updating an agent-hosted plugin in place
  updatePlugin(
    name: string,
    version?: string,
  ): Promise<{
    ok: boolean;
    upToDate?: boolean;
    pendingUpdate?: unknown;
    operation?: unknown;
  }>;
  discardPluginUpdate(name: string): Promise<{ ok: boolean }>;
  // Settings of an agent-hosted plugin, kept by its agent half: a partial
  // change against the `revision` they were read at; `null` puts a field
  // back to its default or clears a secret. Secrets travel in the body only.
  getPluginSettings(name: string): Promise<PluginSettingsView>;
  updatePluginSettings(
    name: string,
    body: {
      revision: number;
      values?: Record<string, SettingsValue | null>;
      secrets?: Record<string, string | null>;
    },
  ): Promise<PluginSettingsView>;
  // People of an agent-hosted plugin that declares identity (4.5): its
  // block and readiness, audience, entitlements (Gatekeeper plugin grants
  // with roles) and the feed to its agent half. Refused with `code`
  // `no_identity` for a plugin that declares none (the identity view
  // answers it with `declared: null` instead).
  getPluginIdentity(name: string): Promise<{ identity: PluginIdentityView }>;
  /** Members and tombstones, in seq order; `head` is the highest seq. */
  getPluginAudience(name: string): Promise<{ head: number; audience: PluginAudienceRow[] }>;
  /** Role grants on the plugin, and how many of its grants carry no roles (they never count). */
  getPluginEntitlements(
    name: string,
  ): Promise<{ entitlements: PluginEntitlement[]; roleless: number }>;
  /**
   * Give a user or a Lamaste group exactly `roles` on the plugin (replacing
   * the roles it had). Refused with `code` `unknown_roles` (the installed
   * version declares no such role), `user_not_found`, `group_not_found` or
   * `gatekeeper_unavailable`.
   */
  setPluginEntitlement(
    name: string,
    entitlement: EntitlementPrincipal & { roles: string[] },
  ): Promise<{
    ok: boolean;
    entitlement: PluginEntitlement;
    changed: boolean;
    warnings?: AdminWarning[];
  }>;
  /** Revoke every role grant the principal holds on the plugin (`entitlement_not_found` when none). */
  removePluginEntitlement(
    name: string,
    principal: EntitlementPrincipal,
  ): Promise<{ ok: boolean; revoked: number; warnings?: AdminWarning[] }>;
  /** Sync the audience to the agent half now; `reconcile` replays everything and counts mismatches. */
  syncPluginIdentity(
    name: string,
    options?: { reconcile?: boolean },
  ): Promise<{ ok: boolean; result: IdentitySyncResult; sync: PluginIdentityView['sync'] }>;
  // Push install: what lets the panel install, update and remove what
  // Lamaste installs on an agent while that agent's window is open.
  getPushInstallConfig(): Promise<{
    enabled: boolean;
    defaultPolicy: string;
    policies: unknown[];
    /** How long an agent's window may be opened for, in minutes. */
    windowMinutes: { min: number; max: number };
  }>;
  updatePushInstallConfig(data: { enabled?: boolean; defaultPolicy?: string }): Promise<unknown>;
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
  /** Open (or reopen) agent `label`'s window for `durationMinutes`, within `windowMinutes`. */
  enablePushInstall(
    label: string,
    data: { durationMinutes: number; policyId?: string },
  ): Promise<{
    ok: boolean;
    label: string;
    pushInstallEnabledUntil: string;
    pushInstallPolicy: string;
  }>;
  disablePushInstall(label: string): Promise<{ ok: boolean }>;
  pushInstallCommand(
    label: string,
    data: { action: string; packageName?: string },
  ): Promise<unknown>;
  getPushInstallSessions(): Promise<{ sessions: unknown[] }>;

  // Audit log and panel notifications
  getAuditLog(query?: {
    plugin?: string;
    action?: string;
    before?: number;
    limit?: number;
  }): Promise<{ entries: unknown[] }>;
  getNotifications(query?: {
    unread?: boolean;
    before?: number;
    limit?: number;
  }): Promise<{ notifications: unknown[]; unread: number }>;
  markNotificationsRead(
    target: { ids: number[] } | { all: true },
  ): Promise<{ ok: boolean; changed: number }>;

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
    maxBodySizeMb?: number;
  }): Promise<{ ok: boolean; tunnel: unknown }>;
  /** Enable/disable, move to another carrying agent, change access mode or body limit. */
  updateTunnel(
    id: string,
    data: { enabled?: boolean; agentLabel?: string; accessMode?: string; maxBodySizeMb?: number },
  ): Promise<{ ok: boolean; tunnel: unknown }>;
  deleteTunnel(id: string): Promise<{ ok: boolean }>;
  getTunnelAgentConfig(): Promise<Record<string, unknown>>;
  /**
   * Serve plugin `route`'s user surface (`/api/<route>/app/*`) on the
   * tunnel's host — an enabled, agent-carried app tunnel that is
   * `authenticated` or `restricted`; a route on one host at most (`code`
   * `user_surface_conflict`). The answer's tunnel carries
   * `userSurfaceStatus` (`UserSurfaceRouteStatus` per bound route).
   */
  bindTunnelUserSurface(
    id: string,
    route: string,
  ): Promise<{ ok: boolean; changed: boolean; tunnel: unknown }>;
  /** Stop serving it there: requests for the route go down the tunnel again. */
  unbindTunnelUserSurface(id: string, route: string): Promise<{ ok: boolean; tunnel: unknown }>;

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
  createTunnel(data: { subdomain: string; port: number; description?: string }): Promise<unknown>;
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
