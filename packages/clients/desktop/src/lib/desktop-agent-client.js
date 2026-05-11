import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

/**
 * Create a Tauri-backed AgentClient bound to a specific agent label.
 *
 * All operations go through the multi-agent Tauri commands in agents.rs.
 *
 * @param {string} label
 * @returns {import('@lamalibre/lamaste-agent-ui').AgentClient}
 */
export function createDesktopAgentClient(label) {
  return {
    getStatus: () => invoke('get_agent_status', { label }),
    startAgent: () => invoke('start_agent', { label }),
    stopAgent: () => invoke('stop_agent', { label }),
    restartAgent: () => invoke('restart_agent', { label }),
    updateAgent: () => invoke('update_agent', { label }),
    getTunnels: () => invoke('get_agent_tunnels', { label }),
    createTunnel: (data) =>
      invoke('create_tunnel', {
        label,
        subdomain: data.subdomain,
        port: data.port,
        description: data.description || '',
      }),
    toggleTunnel: (id, data) => invoke('toggle_tunnel', { label, id, enabled: data.enabled }),
    deleteTunnel: (id) => invoke('delete_tunnel', { label, id }),
    scanServices: () => invoke('scan_services'),
    getServiceRegistry: () => invoke('get_service_registry'),
    addCustomService: (data) =>
      invoke('add_custom_service', {
        name: data.name,
        port: data.port,
        binary: data.binary || null,
        processName: data.processName || null,
        category: data.category,
        description: data.description || '',
      }),
    removeCustomService: (id) => invoke('remove_custom_service', { id }),
    getLogs: () => invoke('get_agent_logs', { label }),
    getConfig: () => invoke('get_agent_config', { label }),
    getPanelUrl: () => invoke('get_agent_config', { label }).then((c) => c?.panelUrl),
    rotateCertificate: () => invoke('rotate_certificate', { label }),
    downloadCertificate: () => invoke('download_certificate', { label }),
    getPanelExposeStatus: () => invoke('get_panel_expose_status', { label }),
    togglePanelExpose: (enabled) => invoke('toggle_panel_expose', { label, enabled }),
    uninstallAgent: () => invoke('uninstall_agent', { label }),
    startAgentPanel: () => invoke('start_agent_panel', { label }),
    stopAgentPanel: () => invoke('stop_agent_panel', { label }),
    getAgentPlugins: () => invoke('get_agent_plugins', { label }),
    installAgentPlugin: (packageName) => invoke('install_agent_plugin', { label, packageName }),
    enableAgentPlugin: (name) => invoke('enable_agent_plugin', { label, name }),
    disableAgentPlugin: (name) => invoke('disable_agent_plugin', { label, name }),
    uninstallAgentPlugin: (name) => invoke('uninstall_agent_plugin', { label, name }),
    updateAgentPlugin: (name) => invoke('update_agent_plugin', { label, name }),
    fetchAgentPluginBundle: (name) =>
      invoke('fetch_agent_plugin_bundle', { label, name }).then((chunks) => ({
        type: 'source',
        source: chunks.join(''),
      })),
    checkAgentPluginUpdate: (name) => invoke('check_agent_plugin_update', { label, name }),
    openExternal: (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Only HTTP(S) URLs can be opened');
      }
      return open(url);
    },
  };
}
