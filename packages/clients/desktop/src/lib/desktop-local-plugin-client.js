/**
 * Tauri invoke wrapper for local plugin management.
 *
 * Provides the same interface shape as desktop-admin-client.js plugin methods
 * but routes to local_plugins.rs Tauri commands (filesystem-based, no mTLS).
 */

import { invoke } from '@tauri-apps/api/core';

export const desktopLocalPluginClient = {
  getPlugins: () => invoke('local_get_plugins'),
  getAvailablePlugins: () => invoke('local_get_available_plugins'),
  installPlugin: (packageName) => invoke('local_install_plugin', { packageName }),
  enablePlugin: (name) => invoke('local_enable_plugin', { name }),
  disablePlugin: (name) => invoke('local_disable_plugin', { name }),
  uninstallPlugin: (name) => invoke('local_uninstall_plugin', { name }),
  fetchPluginBundle: (name) => invoke('local_fetch_plugin_bundle', { name }),
  checkPluginUpdate: (name) => invoke('local_check_plugin_update', { name }),
  updatePlugin: (name) => invoke('local_update_plugin', { name }),
  checkDesktopApp: (name) => invoke('local_check_desktop_app', { name }),
  openDesktopApp: (name) => invoke('local_open_desktop_app', { name }),
  uninstallDesktopApp: (name) => invoke('local_uninstall_desktop_app', { name }),
  installDesktopApp: (name) => invoke('local_install_desktop_app', { name }),
  // Host lifecycle delegates to the unified daemon_* commands —
  // the host daemon is managed through launchctl/systemctl, not through agentd.
  getHostStatus: () => invoke('daemon_get_service_status', { kind: 'pluginHost' }),
  startHost: () => invoke('daemon_start', { kind: 'pluginHost' }),
  stopHost: () => invoke('daemon_stop', { kind: 'pluginHost' }),
  restartHost: () => invoke('daemon_restart', { kind: 'pluginHost' }),
  getHostLogs: () => invoke('local_read_host_logs'),
};
