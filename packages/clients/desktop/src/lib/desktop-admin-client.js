/**
 * Desktop data client for the shared admin panel.
 * Implements the AdminClient interface using Tauri invoke() → Rust → curl + P12.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const desktopAdminClient = {
  // --- Users ---
  getUsers: () => invoke('admin_get_users'),
  createUser: (data) => invoke('admin_create_user', { data }),
  updateUser: (username, data) => invoke('admin_update_user', { username, data }),
  deleteUser: (username) => invoke('admin_delete_user', { username }),
  resetTotp: (username) => invoke('admin_reset_totp', { username }),

  // --- Invitations ---
  getInvitations: () => invoke('admin_get_invitations'),
  createInvitation: (data) => invoke('admin_create_invitation', { data }),
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
  uninstallPlugin: (name) => invoke('admin_uninstall_plugin', { name }),
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
  toggleTunnel: (id, data) => invoke('admin_toggle_tunnel', { id, data }),
  deleteTunnel: (id) => invoke('admin_delete_tunnel', { id }),
  getTunnelAgentConfig: () => invoke('admin_get_tunnel_agent_config'),
  getMacPlist: (format) => invoke('admin_get_mac_plist', { format }),

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
  addGatekeeperGroupMembers: (name, data) => invoke('admin_add_gatekeeper_group_members', { name, data }),
  removeGatekeeperGroupMember: (name, username) => invoke('admin_remove_gatekeeper_group_member', { name, username }),

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
