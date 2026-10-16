/**
 * Web data client for the shared admin panel.
 * Implements the AdminClient interface using apiFetch() (browser mTLS).
 */

import { apiFetch } from './api.js';

function jsonPost(url, data) {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function jsonPut(url, data) {
  return apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function jsonPatch(url, data) {
  return apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function jsonDelete(url, data) {
  const opts = { method: 'DELETE' };
  if (data) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(data);
  }
  return apiFetch(url, opts);
}

/** `?a=1&b=x` from the defined values of `query` (empty when none). */
function toQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * `?force=true&purge=true` for removing a plugin's hosting: `force` lets
 * failing pre-teardown hooks pass, `purge` deletes the data and service
 * account of an agent half Lamaste installed. Only the flags that are set.
 */
function removalQuery({ force = false, purge = false } = {}) {
  return toQuery({ force: force ? 'true' : undefined, purge: purge ? 'true' : undefined });
}

export const webAdminClient = {
  // --- Users ---
  getUsers: () => apiFetch('/api/users'),
  createUser: (data) => jsonPost('/api/users', data),
  updateUser: (username, data) => jsonPut(`/api/users/${encodeURIComponent(username)}`, data),
  deleteUser: (username) => jsonDelete(`/api/users/${encodeURIComponent(username)}`),
  resetTotp: (username) => jsonPost(`/api/users/${encodeURIComponent(username)}/reset-totp`),

  // --- Invitations ---
  getInvitations: () => apiFetch('/api/invitations'),
  createInvitation: (data) => jsonPost('/api/invitations', data),
  revokeInvitation: (id) => jsonDelete(`/api/invitations/${encodeURIComponent(id)}`),

  // --- Sites ---
  getSites: () => apiFetch('/api/sites'),
  createSite: (data) => jsonPost('/api/sites', data),
  deleteSite: (id) => jsonDelete(`/api/sites/${encodeURIComponent(id)}`),
  updateSite: (id, data) => jsonPatch(`/api/sites/${encodeURIComponent(id)}`, data),
  getSiteFiles: (id, path) => {
    const params = path && path !== '.' ? `?path=${encodeURIComponent(path)}` : '';
    return apiFetch(`/api/sites/${encodeURIComponent(id)}/files${params}`);
  },
  uploadSiteFiles: (id, path, files) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    const params = path && path !== '.' ? `?path=${encodeURIComponent(path)}` : '';
    return apiFetch(`/api/sites/${encodeURIComponent(id)}/files${params}`, {
      method: 'POST',
      body: formData,
    });
  },
  deleteSiteFile: (id, filePath) =>
    jsonDelete(`/api/sites/${encodeURIComponent(id)}/files`, { path: filePath }),
  verifySiteDns: (id) => jsonPost(`/api/sites/${encodeURIComponent(id)}/verify-dns`),

  // --- Certificates ---
  getCerts: () => apiFetch('/api/certs'),
  renewCert: (domain) => jsonPost(`/api/certs/${encodeURIComponent(domain)}/renew`),
  rotateMtls: () => jsonPost('/api/certs/mtls/rotate'),
  downloadMtls: async () => {
    const res = await fetch('/api/certs/mtls/download', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'client.p12';
    a.click();
    URL.revokeObjectURL(url);
  },
  getAuthMode: () => apiFetch('/api/certs/admin/auth-mode'),
  getAutoRenewStatus: () => apiFetch('/api/certs/auto-renew-status'),
  getAgentCerts: () => apiFetch('/api/certs/agent'),
  generateAgentCert: (data) => jsonPost('/api/certs/agent', data),
  revokeAgentCert: (label) => jsonDelete(`/api/certs/agent/${encodeURIComponent(label)}`),
  createEnrollmentToken: (data) => jsonPost('/api/certs/agent/enroll', data),
  revokeEnrollmentToken: (label) =>
    jsonDelete(`/api/certs/agent/enroll/${encodeURIComponent(label)}`),
  updateAgentCapabilities: (label, capabilities) =>
    jsonPatch(`/api/certs/agent/${encodeURIComponent(label)}/capabilities`, { capabilities }),
  updateAgentAllowedSites: (label, allowedSites) =>
    jsonPatch(`/api/certs/agent/${encodeURIComponent(label)}/allowed-sites`, { allowedSites }),
  downloadAgentCert: async (label) => {
    const res = await fetch(`/api/certs/agent/${encodeURIComponent(label)}/download`, {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${label}.p12`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // --- Services + System ---
  getServices: () => apiFetch('/api/services'),
  serviceAction: (name, action) =>
    jsonPost(`/api/services/${encodeURIComponent(name)}/${encodeURIComponent(action)}`),
  getSystemStats: () => apiFetch('/api/system/stats'),
  triggerPanelUpdate: (data) => jsonPost('/api/system/update', data),

  // --- Logs ---
  startLogStream: (service, onLine) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/services/${encodeURIComponent(service)}/logs`;
    const ws = new WebSocket(url);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onLine(data);
      } catch {
        onLine({ message: event.data, timestamp: new Date().toISOString() });
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {};
    return () => ws.close();
  },

  // --- Tickets ---
  getTicketScopes: () => apiFetch('/api/tickets/scopes'),
  createTicketScope: (data) => jsonPost('/api/tickets/scopes', data),
  deleteTicketScope: (name) => jsonDelete(`/api/tickets/scopes/${encodeURIComponent(name)}`),
  getTicketInstances: () => apiFetch('/api/tickets/instances'),
  deleteTicketInstance: (id) => jsonDelete(`/api/tickets/instances/${encodeURIComponent(id)}`),
  getTicketAssignments: () => apiFetch('/api/tickets/assignments'),
  createTicketAssignment: (data) => jsonPost('/api/tickets/assignments', data),
  deleteTicketAssignment: (agentLabel, instanceScope) =>
    jsonDelete(
      `/api/tickets/assignments/${encodeURIComponent(agentLabel)}/${encodeURIComponent(instanceScope)}`,
    ),
  getTickets: () => apiFetch('/api/tickets'),
  revokeTicket: (id) => jsonDelete(`/api/tickets/${encodeURIComponent(id)}`),
  getTicketSessions: () => apiFetch('/api/tickets/sessions'),
  killTicketSession: (id) => jsonDelete(`/api/tickets/sessions/${encodeURIComponent(id)}`),

  // --- Plugins ---
  getPlugins: () => apiFetch('/api/plugins'),
  installPlugin: (packageName) => jsonPost('/api/plugins/install', { packageName }),
  enablePlugin: (name) => jsonPost(`/api/plugins/${encodeURIComponent(name)}/enable`),
  disablePlugin: (name) => jsonPost(`/api/plugins/${encodeURIComponent(name)}/disable`),
  uninstallPlugin: (name, options = {}) =>
    jsonDelete(`/api/plugins/${encodeURIComponent(name)}${removalQuery(options)}`),
  getPluginHosting: (name) => apiFetch(`/api/plugins/${encodeURIComponent(name)}/hosting`),
  getPluginHostingEligibility: (name) =>
    apiFetch(`/api/plugins/${encodeURIComponent(name)}/hosting/eligibility`),
  setPluginHosting: (name, agentLabel) =>
    jsonPost(`/api/plugins/${encodeURIComponent(name)}/hosting`, { agentLabel }),
  clearPluginHosting: (name, options = {}) =>
    jsonDelete(`/api/plugins/${encodeURIComponent(name)}/hosting${removalQuery(options)}`),
  rotatePluginHostingSecret: (name) =>
    jsonPost(`/api/plugins/${encodeURIComponent(name)}/hosting/rotate-secret`),
  getPluginRetainedData: (name) =>
    apiFetch(`/api/plugins/${encodeURIComponent(name)}/retained-data`),
  purgePluginRetainedData: (name, agentLabel) =>
    jsonDelete(`/api/plugins/${encodeURIComponent(name)}/retained-data${toQuery({ agentLabel })}`),
  forgetPluginRetainedData: (name, agentLabel) =>
    jsonDelete(
      `/api/plugins/${encodeURIComponent(name)}/retained-data${toQuery({ agentLabel, forget: 'true' })}`,
    ),
  getPluginSettings: (name) => apiFetch(`/api/plugins/${encodeURIComponent(name)}/settings`),
  // The body carries the secrets the administrator typed: it goes in the
  // request body only, never into the URL.
  updatePluginSettings: (name, body) =>
    jsonPut(`/api/plugins/${encodeURIComponent(name)}/settings`, body),
  getPluginOperations: (name) => apiFetch(`/api/plugins/${encodeURIComponent(name)}/operations`),
  getPluginOperation: (name, id) =>
    apiFetch(`/api/plugins/${encodeURIComponent(name)}/operations/${encodeURIComponent(id)}`),
  getPluginHooks: (name) => apiFetch(`/api/plugins/${encodeURIComponent(name)}/hooks`),
  approvePluginHooks: (name, digest) =>
    jsonPost(`/api/plugins/${encodeURIComponent(name)}/hooks/approve`, { digest }),
  setPluginHooksAutoApprove: (name, enabled) =>
    jsonPut(`/api/plugins/${encodeURIComponent(name)}/hooks/auto-approve`, { enabled }),
  updatePlugin: (name, version) =>
    jsonPost(`/api/plugins/${encodeURIComponent(name)}/update`, version ? { version } : {}),
  discardPluginUpdate: (name) => jsonDelete(`/api/plugins/${encodeURIComponent(name)}/update`),
  fetchPluginBundle: async (name) => {
    const res = await fetch(`/api/${encodeURIComponent(name)}/panel.js`);
    if (!res.ok) throw new Error(`Failed to load plugin bundle for "${name}"`);
    return res.text();
  },
  getPushInstallConfig: () => apiFetch('/api/plugins/push-install/config'),
  updatePushInstallConfig: (data) => jsonPatch('/api/plugins/push-install/config', data),
  getPushInstallPolicies: () => apiFetch('/api/plugins/push-install/policies'),
  createPushInstallPolicy: (data) => jsonPost('/api/plugins/push-install/policies', data),
  deletePushInstallPolicy: (id) =>
    jsonDelete(`/api/plugins/push-install/policies/${encodeURIComponent(id)}`),
  updatePushInstallPolicy: (id, data) =>
    jsonPatch(`/api/plugins/push-install/policies/${encodeURIComponent(id)}`, data),
  enablePushInstall: (label, data) =>
    jsonPost(`/api/plugins/push-install/enable/${encodeURIComponent(label)}`, data),
  disablePushInstall: (label) =>
    jsonDelete(`/api/plugins/push-install/enable/${encodeURIComponent(label)}`),
  pushInstallCommand: (label, data) =>
    jsonPost(`/api/plugins/push-install/${encodeURIComponent(label)}`, data),
  getPushInstallSessions: () => apiFetch('/api/plugins/push-install/sessions'),

  // --- Audit log and notifications ---
  getAuditLog: (query = {}) => apiFetch(`/api/audit${toQuery(query)}`),
  getNotifications: (query = {}) => apiFetch(`/api/notifications${toQuery(query)}`),
  markNotificationsRead: (target) => jsonPost('/api/notifications/read', target),

  // --- Storage ---
  registerStorageServer: (data) => jsonPost('/api/storage/servers', data),
  getStorageServers: () => apiFetch('/api/storage/servers'),
  deleteStorageServer: (id) => jsonDelete(`/api/storage/servers/${encodeURIComponent(id)}`),
  createStorageBinding: (data) => jsonPost('/api/storage/bindings', data),
  getStorageBindings: () => apiFetch('/api/storage/bindings'),
  getStorageBinding: (pluginName) =>
    apiFetch(`/api/storage/bindings/${encodeURIComponent(pluginName)}`),
  deleteStorageBinding: (pluginName) =>
    jsonDelete(`/api/storage/bindings/${encodeURIComponent(pluginName)}`),

  // --- Identity ---
  getIdentitySelf: () => apiFetch('/api/identity/self'),
  getIdentityUsers: () => apiFetch('/api/identity/users'),
  getIdentityUser: (username) => apiFetch(`/api/identity/users/${encodeURIComponent(username)}`),
  getIdentityGroups: () => apiFetch('/api/identity/groups'),

  // --- 2FA ---
  get2faStatus: () => apiFetch('/api/settings/2fa'),
  setup2fa: () => jsonPost('/api/settings/2fa/setup'),
  confirm2fa: (code) => jsonPost('/api/settings/2fa/confirm', { code }),
  verify2fa: (code) => jsonPost('/api/settings/2fa/verify', { code }),
  disable2fa: (code) => jsonPost('/api/settings/2fa/disable', { code }),

  // --- Agents ---
  getAgents: () => apiFetch('/api/certs/agent'),

  // --- User Plugin Access ---
  getUserAccessGrants: () => apiFetch('/api/user-access/grants'),
  createUserAccessGrant: (data) => jsonPost('/api/user-access/grants', data),
  revokeUserAccessGrant: (grantId) =>
    jsonDelete(`/api/user-access/grants/${encodeURIComponent(grantId)}`),

  // --- Tunnels ---
  getTunnels: () => apiFetch('/api/tunnels'),
  createTunnel: (data) => jsonPost('/api/tunnels', data),
  updateTunnel: (id, data) => jsonPatch(`/api/tunnels/${encodeURIComponent(id)}`, data),
  deleteTunnel: (id) => jsonDelete(`/api/tunnels/${encodeURIComponent(id)}`),
  getTunnelAgentConfig: () => apiFetch('/api/tunnels/agent-config'),
};
