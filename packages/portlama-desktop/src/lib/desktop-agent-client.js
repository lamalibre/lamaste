import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

/**
 * Create a Tauri-backed AgentClient bound to a specific agent label.
 *
 * When label is provided, uses multi-agent Tauri commands.
 * When label is null/undefined, falls back to legacy single-agent commands.
 *
 * @param {string|null|undefined} label
 * @returns {import('@lamalibre/portlama-agent-panel').AgentClient}
 */
export function createDesktopAgentClient(label) {
  return {
    getStatus: () =>
      label
        ? invoke('get_agent_status', { label })
        : invoke('get_status').then((s) => {
            const chisel = s?.chisel ?? {};
            // Normalize legacy 'version' field to 'chiselVersion' for consistency
            if (chisel.version && !chisel.chiselVersion) {
              chisel.chiselVersion = chisel.version;
            }
            return chisel;
          }),
    startAgent: () => (label ? invoke('start_agent', { label }) : invoke('start_chisel')),
    stopAgent: () => (label ? invoke('stop_agent', { label }) : invoke('stop_chisel')),
    restartAgent: () => (label ? invoke('restart_agent', { label }) : invoke('restart_chisel')),
    updateAgent: () => invoke('update_agent'),
    getTunnels: () =>
      label ? invoke('get_agent_tunnels', { label }) : invoke('get_tunnels'),
    createTunnel: (data) =>
      invoke('create_tunnel', {
        subdomain: data.subdomain,
        port: data.port,
        description: data.description || '',
      }),
    toggleTunnel: (id, data) => invoke('toggle_tunnel', { id, enabled: data.enabled }),
    deleteTunnel: (id) => invoke('delete_tunnel', { id }),
    scanServices: () => invoke('scan_services'),
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
    getLogs: () => (label ? invoke('get_agent_logs', { label }) : invoke('get_logs')),
    getConfig: () => (label ? invoke('get_agent_config', { label }) : invoke('get_config')),
    getPanelUrl: () => invoke('get_panel_url'),
    rotateCertificate: () => invoke('rotate_certificate'),
    downloadCertificate: () => invoke('download_certificate'),
    uninstallAgent: () => invoke('uninstall_agent'),
    openExternal: (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('Only HTTP(S) URLs can be opened');
      }
      return open(url);
    },
  };
}
