import { createContext, useContext } from 'react';

/**
 * AdminClientContext — the data layer abstraction for the admin panel.
 *
 * Each host (web panel, desktop app) provides its own implementation:
 * - Web panel: uses apiFetch() with browser mTLS
 * - Desktop app: uses Tauri invoke() → Rust → curl + P12
 *
 * All methods return promises. The page components call useAdminClient()
 * and are completely host-agnostic.
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
 * @property {() => Promise<{plugins: Array}>} getPlugins
 * @property {(packageName: string) => Promise<any>} installPlugin
 * @property {(name: string) => Promise<{ok}>} enablePlugin
 * @property {(name: string) => Promise<{ok}>} disablePlugin
 * @property {(name: string) => Promise<{ok}>} uninstallPlugin
 * @property {(name: string) => Promise<string>} fetchPluginBundle — returns JS source text
 * @property {() => Promise<Object>} getPushInstallConfig
 * @property {(data: Object) => Promise<any>} updatePushInstallConfig
 * @property {() => Promise<{policies: Array}>} getPushInstallPolicies
 * @property {(data: Object) => Promise<any>} createPushInstallPolicy
 * @property {(id: string) => Promise<{ok}>} deletePushInstallPolicy
 * @property {(id: string, data: {name?, description?, allowedIps?, deniedIps?, allowedPlugins?, allowedActions?}) => Promise<{ok, policy}>} updatePushInstallPolicy
 * @property {(label: string, data: {durationMinutes, policyId?}) => Promise<any>} enablePushInstall
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
 * @property {(data: {subdomain, port, description?, type?, pluginName?, agentLabel?}) => Promise<{ok, tunnel}>} createTunnel
 * @property {(id: string, data: {enabled}) => Promise<{ok, tunnel}>} toggleTunnel
 * @property {(id: string) => Promise<{ok}>} deleteTunnel
 * @property {() => Promise<Object>} getTunnelAgentConfig
 * @property {(format?: string) => Promise<any>} getMacPlist
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
  return (
    <AdminClientContext.Provider value={client}>
      {children}
    </AdminClientContext.Provider>
  );
}

export default AdminClientContext;
