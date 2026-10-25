/**
 * Desktop data client for the shared admin panel.
 * Implements the AdminClient interface using Tauri invoke() → Rust → curl + P12.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { settingsErrorsOf } from '@lamalibre/lamaste-server-ui/lib/pluginSettings.js';

/**
 * Invoke a command whose refusal the panel UI explains: one that starts a
 * plugin operation (hosting, removing a hosting, uninstalling, updating,
 * approving an update, purging retained data), settles one's leftovers
 * (forgetting retained data), reads or changes a plugin's settings or its
 * people (identity, audience, entitlements, sync), disables, enables,
 * deletes or erases a user, binds a tunnel as a user surface, or reads,
 * creates, moves or deletes a plugin's web surface. It rejects with the
 * panel's refusal — `{ error, status?, code?, reasons?, operationId?,
 * errors? }` — which is rethrown as the Error the web client throws for it,
 * so the panel UI can explain it (an ineligible agent's reasons, closed push
 * install, a stale settings revision, a message per setting, the last
 * enabled administrator, a route served elsewhere, a hostname taken). The
 * panel's messages never contain a setting's value.
 */
async function invokeRefusable(command, args) {
  try {
    return await invoke(command, args);
  } catch (rejection) {
    if (
      rejection !== null &&
      typeof rejection === 'object' &&
      typeof rejection.error === 'string'
    ) {
      const errors = settingsErrorsOf(rejection);
      throw Object.assign(new Error(rejection.error), {
        ...(Number.isInteger(rejection.status) ? { status: rejection.status } : {}),
        ...(typeof rejection.code === 'string' ? { code: rejection.code } : {}),
        ...(Array.isArray(rejection.reasons) ? { reasons: rejection.reasons } : {}),
        ...(rejection.usedBy && typeof rejection.usedBy === 'object'
          ? { usedBy: rejection.usedBy }
          : {}),
        ...(typeof rejection.operationId === 'string'
          ? { operationId: rejection.operationId }
          : {}),
        ...(errors ? { errors } : {}),
      });
    }
    throw rejection;
  }
}

/**
 * The arguments of uninstalling a plugin or removing its hosting: `force`
 * lets failing pre-teardown hooks pass, `purge` deletes the data and service
 * account of an agent half Lamaste installed.
 */
function removalArgs(name, options) {
  return { name, force: options.force === true, purge: options.purge === true };
}

export const desktopAdminClient = {
  // --- Users ---
  getUsers: () => invoke('admin_get_users'),
  // Refusable: a relay with two domains answers `domains_required` when none are named.
  createUser: (data) => invokeRefusable('admin_create_user', { data }),
  updateUser: (username, data) => invoke('admin_update_user', { username, data }),
  disableUser: (username) => invokeRefusable('admin_disable_user', { username }),
  enableUser: (username) => invokeRefusable('admin_enable_user', { username }),
  deleteUser: (username, { erase = false } = {}) =>
    invokeRefusable('admin_delete_user', { username, erase: erase === true }),
  resetTotp: (username) => invoke('admin_reset_totp', { username }),

  // --- User directory ---
  getUserDirectory: () => invoke('admin_get_user_directory'),
  eraseDirectoryUser: (userId) => invokeRefusable('admin_erase_directory_user', { userId }),

  // --- Domains (the relay's base domains and their members) ---
  getDomains: () => invokeRefusable('admin_get_domains'),
  addDomain: (name) => invokeRefusable('admin_add_domain', { name }),
  verifyDomainDns: (name) => invokeRefusable('admin_verify_domain_dns', { name }),
  activateDomain: (name) => invokeRefusable('admin_activate_domain', { name }),
  removeDomain: (name) => invokeRefusable('admin_remove_domain', { name }),
  getDomainMembers: (name) => invokeRefusable('admin_get_domain_members', { name }),
  addDomainMember: (name, user) => invokeRefusable('admin_add_domain_member', { name, user }),
  removeDomainMember: (name, user) => invokeRefusable('admin_remove_domain_member', { name, user }),
  setPluginDomain: (name, domain) => invokeRefusable('admin_set_plugin_domain', { name, domain }),

  // --- Invitations ---
  getInvitations: () => invoke('admin_get_invitations'),
  createInvitation: (data) => invokeRefusable('admin_create_invitation', { data }),
  revokeInvitation: (id) => invoke('admin_revoke_invitation', { id }),

  // --- Sites ---
  getSites: () => invoke('admin_get_sites'),
  createSite: (data) => invoke('admin_create_site', { data }),
  deleteSite: (id) => invoke('admin_delete_site', { id }),
  updateSite: (id, data) => invoke('admin_update_site', { id, data }),
  getSiteFiles: (id, path) => invoke('admin_get_site_files', { siteId: id, path }),
  uploadSiteFiles: async (id, path, files) => {
    // Desktop: files come from Tauri file dialog as string paths
    // If files are File objects (drag-and-drop), we need to extract paths
    const filePaths = Array.isArray(files)
      ? files.map((f) => (typeof f === 'string' ? f : f.path || f.name))
      : [];
    return invoke('admin_upload_site_files', { siteId: id, path, filePaths });
  },
  deleteSiteFile: (id, filePath) => invoke('admin_delete_site_file', { siteId: id, filePath }),
  verifySiteDns: (id) => invoke('admin_verify_site_dns', { id }),

  // --- Certificates ---
  getCerts: () => invoke('admin_get_certs'),
  renewCert: (domain) => invoke('admin_renew_cert', { domain }),
  rotateMtls: () => invoke('admin_rotate_mtls'),
  downloadMtls: () => invoke('admin_download_mtls'),
  getAuthMode: () => invoke('admin_get_auth_mode'),
  getAutoRenewStatus: () => invoke('admin_get_auto_renew_status'),
  getAgentCerts: () => invoke('admin_get_agent_certs'),
  generateAgentCert: (data) => invoke('admin_generate_agent_cert', { data }),
  revokeAgentCert: (label) => invoke('admin_revoke_agent_cert', { label }),
  createEnrollmentToken: (data) => invoke('admin_create_enrollment_token', { data }),
  revokeEnrollmentToken: (label) => invoke('admin_revoke_enrollment_token', { label }),
  updateAgentCapabilities: (label, capabilities) =>
    invoke('admin_update_agent_capabilities', { label, capabilities }),
  updateAgentAllowedSites: (label, allowedSites) =>
    invoke('admin_update_agent_allowed_sites', { label, allowedSites: allowedSites }),
  downloadAgentCert: (label) => invoke('admin_download_agent_cert', { label }),

  // --- Services + System ---
  getServices: () => invoke('admin_get_services'),
  serviceAction: (name, action) => invoke('admin_service_action', { name, action }),
  getSystemStats: () => invoke('admin_get_system_stats'),
  triggerPanelUpdate: (data) => invoke('admin_trigger_panel_update', { data }),

  // --- Logs ---
  startLogStream: (service, onLine) => {
    let stopped = false;
    const unlistenPromise = listen('admin-log-line', (event) => {
      if (event.payload.service === service) {
        onLine(event.payload);
      }
    });
    // Start stream after listener is set up to avoid missing events
    unlistenPromise.then(() => {
      if (!stopped) {
        invoke('admin_start_log_stream', { serviceName: service }).catch(() => {});
      }
    });
    return () => {
      stopped = true;
      invoke('admin_stop_log_stream', { serviceName: service }).catch(() => {});
      unlistenPromise.then((fn) => fn());
    };
  },

  // --- Tickets ---
  getTicketScopes: () => invoke('admin_get_ticket_scopes'),
  createTicketScope: (data) => invoke('admin_create_ticket_scope', { data }),
  deleteTicketScope: (name) => invoke('admin_delete_ticket_scope', { name }),
  getTicketInstances: () => invoke('admin_get_ticket_instances'),
  deleteTicketInstance: (id) => invoke('admin_delete_ticket_instance', { id }),
  getTicketAssignments: () => invoke('admin_get_ticket_assignments'),
  createTicketAssignment: (data) => invoke('admin_create_ticket_assignment', { data }),
  deleteTicketAssignment: (agentLabel, instanceScope) =>
    invoke('admin_delete_ticket_assignment', { agentLabel, instanceScope }),
  getTickets: () => invoke('admin_get_tickets'),
  revokeTicket: (id) => invoke('admin_revoke_ticket', { id }),
  getTicketSessions: () => invoke('admin_get_ticket_sessions'),
  killTicketSession: (id) => invoke('admin_kill_ticket_session', { id }),

  // --- Plugins ---
  getPlugins: () => invoke('admin_get_plugins'),
  installPlugin: (packageName) => invoke('admin_install_plugin', { packageName }),
  enablePlugin: (name) => invoke('admin_enable_plugin', { name }),
  disablePlugin: (name) => invoke('admin_disable_plugin', { name }),
  uninstallPlugin: (name, options = {}) =>
    invokeRefusable('admin_uninstall_plugin', removalArgs(name, options)),
  getPluginHosting: (name) => invoke('admin_get_plugin_hosting', { name }),
  getPluginHostingEligibility: (name) => invoke('admin_get_plugin_hosting_eligibility', { name }),
  setPluginHosting: (name, agentLabel) =>
    invokeRefusable('admin_set_plugin_hosting', { name, agentLabel }),
  clearPluginHosting: (name, options = {}) =>
    invokeRefusable('admin_clear_plugin_hosting', removalArgs(name, options)),
  rotatePluginHostingSecret: (name) => invoke('admin_rotate_plugin_hosting_secret', { name }),
  getPluginRetainedData: (name) => invoke('admin_get_plugin_retained_data', { name }),
  purgePluginRetainedData: (name, agentLabel) =>
    invokeRefusable('admin_purge_plugin_retained_data', { name, agentLabel }),
  forgetPluginRetainedData: (name, agentLabel) =>
    invokeRefusable('admin_forget_plugin_retained_data', { name, agentLabel }),
  getPluginOperations: (name) => invoke('admin_get_plugin_operations', { name }),
  getPluginOperation: (name, id) => invoke('admin_get_plugin_operation', { name, id }),
  getPluginHooks: (name) => invoke('admin_get_plugin_hooks', { name }),
  approvePluginHooks: (name, digest, version) =>
    invokeRefusable('admin_approve_plugin_hooks', {
      name,
      digest: digest ?? null,
      version: version ?? null,
    }),
  setPluginHooksAutoApprove: (name, enabled) =>
    invoke('admin_set_plugin_hooks_auto_approve', { name, enabled }),
  updatePlugin: (name, version) =>
    invokeRefusable('admin_update_plugin', { name, version: version ?? null }),
  discardPluginUpdate: (name) => invoke('admin_discard_plugin_update', { name }),
  getPluginIdentity: (name) => invokeRefusable('admin_get_plugin_identity', { name }),
  getPluginAudience: (name) => invokeRefusable('admin_get_plugin_audience', { name }),
  getPluginEntitlements: (name) => invokeRefusable('admin_get_plugin_entitlements', { name }),
  setPluginEntitlement: (name, { principalType, principalId, roles }) =>
    invokeRefusable('admin_set_plugin_entitlement', {
      name,
      data: { principalType, principalId, roles },
    }),
  removePluginEntitlement: (name, { principalType, principalId }) =>
    invokeRefusable('admin_remove_plugin_entitlement', { name, principalType, principalId }),
  syncPluginIdentity: (name, { reconcile = false } = {}) =>
    invokeRefusable('admin_sync_plugin_identity', { name, reconcile: reconcile === true }),
  getPluginWebSurface: (name) => invokeRefusable('admin_get_plugin_web_surface', { name }),
  createPluginWebSurface: (name, { subdomain, accessMode } = {}) =>
    invokeRefusable('admin_create_plugin_web_surface', {
      name,
      subdomain: subdomain || null,
      accessMode: accessMode || null,
    }),
  movePluginWebSurface: (name, tunnelId) =>
    invokeRefusable('admin_move_plugin_web_surface', { name, tunnelId }),
  deletePluginWebSurface: (name) => invokeRefusable('admin_delete_plugin_web_surface', { name }),
  getPluginSettings: (name) => invokeRefusable('admin_get_plugin_settings', { name }),
  // The body carries secrets: it goes to the Rust command and on to curl's
  // stdin as the request body, and nowhere else.
  updatePluginSettings: (name, body) =>
    invokeRefusable('admin_update_plugin_settings', { name, data: body }),
  fetchPluginBundle: (name) => invoke('admin_fetch_plugin_bundle', { name }),
  getPushInstallConfig: () => invoke('admin_get_push_install_config'),
  updatePushInstallConfig: (data) => invoke('admin_update_push_install_config', { data }),
  getPushInstallPolicies: () => invoke('admin_get_push_install_policies'),
  createPushInstallPolicy: (data) => invoke('admin_create_push_install_policy', { data }),
  deletePushInstallPolicy: (id) => invoke('admin_delete_push_install_policy', { id }),
  updatePushInstallPolicy: (id, data) => invoke('admin_update_push_install_policy', { id, data }),
  enablePushInstall: (label, data) => invoke('admin_enable_push_install', { label, data }),
  disablePushInstall: (label) => invoke('admin_disable_push_install', { label }),
  pushInstallCommand: (label, data) => invoke('admin_push_install_command', { label, data }),
  getPushInstallSessions: () => invoke('admin_get_push_install_sessions'),

  // --- Audit log and notifications ---
  getAuditLog: (query = {}) => invoke('admin_get_audit_log', { query }),
  getNotifications: (query = {}) => invoke('admin_get_notifications', { query }),
  markNotificationsRead: (target) => invoke('admin_mark_notifications_read', { target }),

  // --- Storage ---
  registerStorageServer: (data) => invoke('admin_register_storage_server', { data }),
  getStorageServers: () => invoke('admin_get_storage_servers'),
  deleteStorageServer: (id) => invoke('admin_delete_storage_server', { id }),
  createStorageBinding: (data) => invoke('admin_create_storage_binding', { data }),
  getStorageBindings: () => invoke('admin_get_storage_bindings'),
  getStorageBinding: (pluginName) => invoke('admin_get_storage_binding', { pluginName }),
  deleteStorageBinding: (pluginName) => invoke('admin_delete_storage_binding', { pluginName }),

  // --- Identity ---
  getIdentitySelf: () => invoke('admin_get_identity_self'),
  getIdentityUsers: () => invoke('admin_get_identity_users'),
  getIdentityUser: (username) => invoke('admin_get_identity_user', { username }),
  getIdentityGroups: () => invoke('admin_get_identity_groups'),

  // --- 2FA ---
  get2faStatus: () => invoke('admin_2fa_status'),
  setup2fa: () => invoke('admin_2fa_setup'),
  confirm2fa: (code) => invoke('admin_2fa_confirm', { code }),
  verify2fa: (code) => invoke('admin_2fa_verify', { code }),
  disable2fa: (code) => invoke('admin_2fa_disable', { code }),

  // --- Tunnels ---
  getTunnels: () => invoke('admin_get_tunnels'),
  createTunnel: (data) => invoke('admin_create_tunnel', { data }),
  updateTunnel: (id, data) => invoke('admin_update_tunnel', { id, data }),
  deleteTunnel: (id) => invoke('admin_delete_tunnel', { id }),
  getTunnelAgentConfig: () => invoke('admin_get_tunnel_agent_config'),
  bindTunnelUserSurface: (id, route) =>
    invokeRefusable('admin_bind_tunnel_user_surface', { id, route }),
  unbindTunnelUserSurface: (id, route) =>
    invokeRefusable('admin_unbind_tunnel_user_surface', { id, route }),

  // --- Agents ---
  getAgents: () => invoke('admin_get_agent_certs'),

  // --- User Plugin Access ---
  getUserAccessGrants: () => invoke('admin_get_user_access_grants'),
  createUserAccessGrant: (data) => invoke('admin_create_user_access_grant', { data }),
  revokeUserAccessGrant: (grantId) => invoke('admin_revoke_user_access_grant', { grantId }),

  // --- Gatekeeper Groups ---
  getGatekeeperGroups: () => invoke('admin_get_gatekeeper_groups'),
  createGatekeeperGroup: (data) => invoke('admin_create_gatekeeper_group', { data }),
  updateGatekeeperGroup: (name, data) => invoke('admin_update_gatekeeper_group', { name, data }),
  deleteGatekeeperGroup: (name) => invoke('admin_delete_gatekeeper_group', { name }),
  addGatekeeperGroupMembers: (name, data) =>
    invoke('admin_add_gatekeeper_group_members', { name, data }),
  removeGatekeeperGroupMember: (name, username) =>
    invoke('admin_remove_gatekeeper_group_member', { name, username }),

  // --- Gatekeeper Grants ---
  getGatekeeperGrants: (filter) => invoke('admin_get_gatekeeper_grants', { filter }),
  createGatekeeperGrant: (data) => invoke('admin_create_gatekeeper_grant', { data }),
  revokeGatekeeperGrant: (grantId) => invoke('admin_revoke_gatekeeper_grant', { grantId }),

  // --- Gatekeeper Diagnostics ---
  checkGatekeeperAccess: (username, resourceType, resourceId) =>
    invoke('admin_check_gatekeeper_access', { username, resourceType, resourceId }),
  bustGatekeeperCache: () => invoke('admin_bust_gatekeeper_cache'),

  // --- Gatekeeper Settings ---
  getGatekeeperSettings: () => invoke('admin_get_gatekeeper_settings'),
  updateGatekeeperSettings: (data) => invoke('admin_update_gatekeeper_settings', { data }),

  // --- Gatekeeper Access Log ---
  getAccessRequestLog: (limit, offset) => invoke('admin_get_access_request_log', { limit, offset }),
  clearAccessRequestLog: () => invoke('admin_clear_access_request_log'),
};
