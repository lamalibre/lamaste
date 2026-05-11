import { invoke } from '@tauri-apps/api/core';

export const desktopUserAccessClient = {
  startLogin: (domain) => invoke('user_access_start_login', { domain }),
  exchangeToken: (token, domain, nonce) =>
    invoke('user_access_exchange_token', { token, domain, nonce }),
  getSession: () => invoke('user_access_get_session'),
  logout: () => invoke('user_access_logout'),
  getPlugins: () => invoke('user_access_get_plugins'),
  enrollPlugin: (grantId) => invoke('user_access_enroll_plugin', { grantId }),
  installPlugin: (grantId, packageName) =>
    invoke('user_access_install_plugin', { grantId, packageName }),
};
