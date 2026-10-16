import { createContext, useContext } from 'react';

/**
 * AdminClientContext — the data layer abstraction for the admin panel.
 *
 * Each host (web panel, desktop app) provides its own implementation:
 * - Web panel: uses apiFetch() with browser mTLS
 * - Desktop app: uses Tauri invoke() → Rust → curl + P12
 *
 * All methods return promises. The page components call useAdminClient()
 * and are completely host-agnostic. A refused plugin operation rejects with
 * an Error carrying the panel's message and, when the panel sent them, its
 * `code`, `reasons` and `operationId` (see `lib/errorMessage.js` refusalOf);
 * a refused settings update also carries the per-field `errors` (see
 * `lib/pluginSettings.js` settingsErrorsOf).
 */
const AdminClientContext = createContext(null);

/**
 * @returns {AdminClient} The admin client provided by the host.
 * @throws If used outside an AdminClientProvider.
 *
 * @typedef {Object} AdminClient
 *
 * Users:
 * @property {() => Promise<{users: Array}>} getUsers
 * @property {(data: {username, displayname, email, password, groups?}) => Promise<{ok, user}>} createUser
 * @property {(username: string, data: {displayname?, email?, password?, groups?}) => Promise<{ok, user}>} updateUser
 * @property {(username: string) => Promise<{ok}>} deleteUser
 * @property {(username: string) => Promise<{ok, totpUri}>} resetTotp
 *
 * Invitations:
 * @property {() => Promise<{invitations: Array}>} getInvitations
 * @property {(data: {username, email, groups?, expiresInDays?}) => Promise<{ok, invitation, token}>} createInvitation
 * @property {(id: string) => Promise<{ok}>} revokeInvitation
 *
 * Sites:
 * @property {() => Promise<{sites: Array}>} getSites
 * @property {(data: {name, type, customDomain?, spaMode?, autheliaProtected?}) => Promise<{ok, site}>} createSite
 * @property {(id: string) => Promise<{ok}>} deleteSite
 * @property {(id: string, data: {spaMode?, autheliaProtected?, allowedUsers?}) => Promise<{ok, site}>} updateSite
 * @property {(id: string, path?: string) => Promise<{files, path}>} getSiteFiles
 * @property {(id: string, path: string, files: any) => Promise<any>} uploadSiteFiles
 * @property {(id: string, filePath: string) => Promise<{ok}>} deleteSiteFile
 * @property {(id: string) => Promise<any>} verifySiteDns
 *
 * Certificates:
 * @property {() => Promise<{certs: Array}>} getCerts
 * @property {(domain: string) => Promise<any>} renewCert
 * @property {() => Promise<any>} rotateMtls
 * @property {() => Promise<any>} downloadMtls — returns a download trigger (host-specific)
 * @property {() => Promise<{adminAuthMode: string}>} getAuthMode
 * @property {() => Promise<{active, nextRun?, lastRun?}>} getAutoRenewStatus
 * @property {() => Promise<{agents: Array}>} getAgentCerts
 * @property {(data: {label, capabilities?, allowedSites?}) => Promise<any>} generateAgentCert
 * @property {(label: string) => Promise<{ok}>} revokeAgentCert
 * @property {(data: {label, capabilities?, allowedSites?}) => Promise<{ok, enrollmentToken, expiresAt}>} createEnrollmentToken
 * @property {(label: string) => Promise<{ok}>} revokeEnrollmentToken
 * @property {(label: string, capabilities: string[]) => Promise<any>} updateAgentCapabilities
 * @property {(label: string, allowedSites: string[]) => Promise<any>} updateAgentAllowedSites
 * @property {(label: string) => Promise<any>} downloadAgentCert — returns a download trigger (host-specific)
 *
 * Services + System:
 * @property {() => Promise<{services: Array}>} getServices
 * @property {(name: string, action: string) => Promise<any>} serviceAction
 * @property {() => Promise<Object>} getSystemStats
 * @property {(data: {version: string}) => Promise<{ok, message}>} triggerPanelUpdate
 *
 * Logs:
 * @property {(service: string, onLine: (line: {timestamp, message}) => void) => (() => void)} startLogStream — returns a stop function
 *
 * Tickets:
 * @property {() => Promise<{scopes: Array}>} getTicketScopes
 * @property {(data: Object) => Promise<any>} createTicketScope
 * @property {(name: string) => Promise<{ok}>} deleteTicketScope
 * @property {() => Promise<{instances: Array}>} getTicketInstances
 * @property {(id: string) => Promise<{ok}>} deleteTicketInstance
 * @property {() => Promise<{assignments: Array}>} getTicketAssignments
 * @property {(data: {agentLabel, instanceScope}) => Promise<{ok}>} createTicketAssignment
 * @property {(agentLabel: string, instanceScope: string) => Promise<{ok}>} deleteTicketAssignment
 * @property {() => Promise<{tickets: Array}>} getTickets
 * @property {(id: string) => Promise<{ok}>} revokeTicket
 * @property {() => Promise<{sessions: Array}>} getTicketSessions
 * @property {(id: string) => Promise<{ok}>} killTicketSession
 *
 * Plugins:
 * @property {() => Promise<{plugins: Array, retainedData: Array}>} getPlugins — each plugin with the data agents keep of its agent half (`retainedData`), its hosting (`agentHosting`, with `health` and the hosting agent's last sync `agentLastSeenAt`) and, when its manifest declares settings, `settings: {configured, missing, syncedAt}` (no values); the top-level `retainedData` covers uninstalled plugins too
 * @property {(packageName: string) => Promise<any>} installPlugin
 * @property {(name: string) => Promise<{ok}>} enablePlugin
 * @property {(name: string) => Promise<{ok}>} disablePlugin
 * @property {(name: string, options?: {force?: boolean, purge?: boolean}) => Promise<{ok, operation?}>} uninstallPlugin — a hosted plugin's hosting goes first (an operation); `purge` deletes the data of an agent half Lamaste installed
 * @property {(name: string) => Promise<string>} fetchPluginBundle — returns JS source text
 * @property {(name: string) => Promise<{hosting}>} getPluginHosting
 * @property {(name: string) => Promise<{agents: Array<{label, eligible, reasons}>}>} getPluginHostingEligibility — which machine agents can host the plugin, and why the others cannot
 * @property {(name: string, agentLabel: string) => Promise<{ok, operation}>} setPluginHosting — refused with `code` agent_not_eligible (`reasons`), push_install_refused or hooks_not_approved
 * @property {(name: string, options?: {force?: boolean, purge?: boolean}) => Promise<{ok, operation}>} clearPluginHosting
 * @property {(name: string) => Promise<{ok, hosting}>} rotatePluginHostingSecret
 * @property {(name: string) => Promise<{retainedData: Array<{agentLabel, route, plugin, package, since, operation, dataDir, serviceUser}>}>} getPluginRetainedData — what agents keep of the plugin's agent half, by its name (after an uninstall too)
 * @property {(name: string, agentLabel: string) => Promise<{ok, operation}>} purgePluginRetainedData — an operation (kind purge-data); refused with `code` push_install_refused, retained_data_in_use or agent_not_enrolled
 * @property {(name: string, agentLabel: string) => Promise<{ok, forgotten}>} forgetPluginRetainedData — drops the relay's record only; the data stays on the agent
 * @property {(name: string) => Promise<{fields, values, configured, missing, revision, source, syncedAt, hosting}>} getPluginSettings — the settings of a plugin whose manifest declares them: field definitions, the effective non-secret values and, for a secret, only `{set, setAt?}` (never a value); `source` live (read from the agent half while its hosting is up) | cache | none; `hosting: {agentLabel, state, reason, since, agentLastSeenAt}` or null; refused with `code` no_settings for a plugin without settings
 * @property {(name: string, body: {revision: number, values?: Object, secrets?: Object}) => Promise<Object>} updatePluginSettings — a partial update (`null` clears an optional field), answered with the new settings view. The body carries secrets: a host sends it only as the request body — never in a URL, a process argument, a log line or any store. Refused with `code` revision_mismatch, schema_mismatch, hosting_offline, settings_unsupported, and with `errors` (field key, or `_`, to message) for invalid values
 * @property {(name: string) => Promise<{operations: Array}>} getPluginOperations
 * @property {(name: string, id: string) => Promise<{operation}>} getPluginOperation
 * @property {(name: string) => Promise<{hooks}>} getPluginHooks — relay hook set, agent hooks, agent half, approval (`approval.digest` is what to approve), pending update
 * @property {(name: string, digest: string) => Promise<{ok, hooks?, operation?}>} approvePluginHooks
 * @property {(name: string, enabled: boolean) => Promise<{ok, autoApprove}>} setPluginHooksAutoApprove
 * @property {(name: string, version?: string) => Promise<{ok, upToDate?, pendingUpdate?, operation?}>} updatePlugin
 * @property {(name: string) => Promise<{ok}>} discardPluginUpdate
 * @property {() => Promise<{enabled, defaultPolicy, policies, windowMinutes: {min, max}}>} getPushInstallConfig
 * @property {(data: {enabled?, defaultPolicy?}) => Promise<any>} updatePushInstallConfig
 * @property {() => Promise<{policies: Array}>} getPushInstallPolicies
 * @property {(data: Object) => Promise<any>} createPushInstallPolicy
 * @property {(id: string) => Promise<{ok}>} deletePushInstallPolicy
 * @property {(id: string, data: {name?, description?, allowedIps?, deniedIps?, allowedPlugins?, allowedActions?}) => Promise<{ok, policy}>} updatePushInstallPolicy
 * @property {(label: string, data: {durationMinutes, policyId?}) => Promise<{ok, label, pushInstallEnabledUntil, pushInstallPolicy}>} enablePushInstall — durationMinutes within the config's windowMinutes
 * @property {(label: string) => Promise<{ok}>} disablePushInstall
 * @property {(label: string, data: {action, packageName?}) => Promise<any>} pushInstallCommand
 * @property {() => Promise<{sessions: Array}>} getPushInstallSessions
 *
 * 2FA:
 * @property {() => Promise<{enabled, setupComplete}>} get2faStatus
 * @property {() => Promise<{uri, manualKey}>} setup2fa
 * @property {(code: string) => Promise<{enabled}>} confirm2fa
 * @property {(code: string) => Promise<{verified}>} verify2fa
 * @property {(code: string) => Promise<{enabled}>} disable2fa
 *
 * Storage:
 * @property {(data: {id, label, provider, region, bucket, endpoint, accessKey, secretKey}) => Promise<Object>} registerStorageServer
 * @property {() => Promise<{servers: Array}>} getStorageServers
 * @property {(id: string) => Promise<{ok}>} deleteStorageServer
 * @property {(data: {pluginName, storageServerId}) => Promise<Object>} createStorageBinding
 * @property {() => Promise<{bindings: Array}>} getStorageBindings
 * @property {(pluginName: string) => Promise<Object>} getStorageBinding
 * @property {(pluginName: string) => Promise<{ok}>} deleteStorageBinding
 *
 * Identity:
 * @property {() => Promise<{username, displayName, email, groups}>} getIdentitySelf
 * @property {() => Promise<{users: Array}>} getIdentityUsers
 * @property {(username: string) => Promise<{user: Object}>} getIdentityUser
 * @property {() => Promise<{groups: Array<string>}>} getIdentityGroups
 *
 * Agents:
 * @property {() => Promise<{agents: Array}>} getAgents
 *
 * User Plugin Access:
 * @property {() => Promise<{grants: Array}>} getUserAccessGrants
 * @property {(data: {username, pluginName, target?}) => Promise<{ok, grant}>} createUserAccessGrant
 * @property {(grantId: string) => Promise<{ok}>} revokeUserAccessGrant
 *
 * Tunnels:
 * @property {() => Promise<{tunnels: Array}>} getTunnels
 * @property {(data: {subdomain, port, description?, type?, pluginName?, agentLabel?, accessMode?, maxBodySizeMb?}) => Promise<{ok, tunnel}>} createTunnel
 * @property {(id: string, data: {enabled?, agentLabel?, accessMode?, maxBodySizeMb?}) => Promise<{ok, tunnel}>} updateTunnel
 * @property {(id: string) => Promise<{ok}>} deleteTunnel
 * @property {() => Promise<Object>} getTunnelAgentConfig
 *
 * Gatekeeper Groups:
 * @property {() => Promise<{groups: Array}>} getGatekeeperGroups
 * @property {(data: {name, description?, createdBy?}) => Promise<{ok, group}>} createGatekeeperGroup
 * @property {(name: string, data: {name?, description?}) => Promise<{ok, group}>} updateGatekeeperGroup
 * @property {(name: string) => Promise<{ok, deletedGrants}>} deleteGatekeeperGroup
 * @property {(name: string, data: {usernames: string[]}) => Promise<{ok, group}>} addGatekeeperGroupMembers
 * @property {(name: string, username: string) => Promise<{ok, group}>} removeGatekeeperGroupMember
 *
 * Gatekeeper Grants:
 * @property {(filter?) => Promise<{grants: Array}>} getGatekeeperGrants
 * @property {(data: {principalType, principalId, resourceType, resourceId, context?}) => Promise<{ok, grant}>} createGatekeeperGrant
 * @property {(grantId: string) => Promise<{ok, grant}>} revokeGatekeeperGrant
 *
 * Gatekeeper Diagnostics:
 * @property {(username: string, resourceType: string, resourceId: string) => Promise<Object>} checkGatekeeperAccess
 * @property {() => Promise<void>} bustGatekeeperCache
 *
 * Gatekeeper Settings:
 * @property {() => Promise<{settings: Object}>} getGatekeeperSettings
 * @property {(data: Object) => Promise<{ok, settings}>} updateGatekeeperSettings
 *
 * Gatekeeper Access Log:
 * @property {(limit?, offset?) => Promise<{entries: Array, total: number}>} getAccessRequestLog
 * @property {() => Promise<{ok}>} clearAccessRequestLog
 */
export function useAdminClient() {
  const ctx = useContext(AdminClientContext);
  if (!ctx) throw new Error('useAdminClient must be used within an AdminClientProvider');
  return ctx;
}

/**
 * Wrap your admin pages with this provider, supplying the host-specific client.
 *
 * @param {{ client: AdminClient, children: React.ReactNode }} props
 */
export function AdminClientProvider({ client, children }) {
  return <AdminClientContext.Provider value={client}>{children}</AdminClientContext.Provider>;
}

export default AdminClientContext;
