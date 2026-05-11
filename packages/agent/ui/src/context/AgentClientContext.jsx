import { createContext, useContext } from 'react';

/**
 * AgentClientContext — the data layer abstraction for the agent panel.
 *
 * Each host (desktop app, web agent panel) provides its own implementation:
 * - Desktop app: uses Tauri invoke() → Rust subprocess calls
 * - Web agent panel: uses apiFetch() with HTTP requests
 *
 * All methods return promises. The page components call useAgentClient()
 * and are completely host-agnostic.
 */
const AgentClientContext = createContext(null);

/**
 * @returns {AgentClient} The agent client provided by the host.
 * @throws If used outside an AgentClientProvider.
 *
 * @typedef {Object} AgentClient
 *
 * Status & Control:
 * @property {() => Promise<{running: boolean, pid?: number, chiselVersion?: string, installed?: boolean}>} getStatus
 * @property {() => Promise<any>} startAgent
 * @property {() => Promise<any>} stopAgent
 * @property {() => Promise<any>} restartAgent
 * @property {() => Promise<any>} updateAgent
 *
 * Tunnels:
 * @property {() => Promise<Array>} getTunnels
 * @property {(data: {subdomain: string, port: number, description?: string}) => Promise<any>} createTunnel
 * @property {(id: string, data: {enabled: boolean}) => Promise<any>} toggleTunnel
 * @property {(id: string) => Promise<any>} deleteTunnel
 *
 * Services:
 * @property {() => Promise<{services: Array, dockerContainers: Array}>} scanServices
 * @property {() => Promise<{services: Array}>} getServiceRegistry
 * @property {(data: {name: string, port: number, binary?: string, processName?: string, category: string, description: string}) => Promise<any>} addCustomService
 * @property {(id: string) => Promise<any>} removeCustomService
 *
 * Logs:
 * @property {() => Promise<string>} getLogs
 *
 * Configuration:
 * @property {() => Promise<Object>} getConfig
 * @property {() => Promise<string>} getPanelUrl
 *
 * Certificate:
 * @property {() => Promise<any>} rotateCertificate
 * @property {() => Promise<any>} downloadCertificate
 *
 * Web Panel:
 * @property {() => Promise<{enabled: boolean, fqdn?: string, port?: number, running?: boolean}>} getPanelExposeStatus
 * @property {(enabled: boolean) => Promise<any>} togglePanelExpose
 * @property {() => Promise<any>} startAgentPanel
 * @property {() => Promise<any>} stopAgentPanel
 *
 * Lifecycle:
 * @property {() => Promise<any>} uninstallAgent
 *
 * Plugins:
 * @property {() => Promise<{plugins: Array}>} getAgentPlugins
 * @property {(packageName: string) => Promise<{ok: boolean, plugin: Object}>} installAgentPlugin
 * @property {(name: string) => Promise<any>} enableAgentPlugin
 * @property {(name: string) => Promise<any>} disableAgentPlugin
 * @property {(name: string) => Promise<any>} uninstallAgentPlugin
 * @property {(name: string) => Promise<any>} updateAgentPlugin
 * @property {(name: string) => Promise<{type: 'source', source: string}>} fetchAgentPluginBundle
 * @property {(name: string) => Promise<{name: string, currentVersion: string, latestVersion: string, hasUpdate: boolean}>} checkAgentPluginUpdate
 *
 * External links (host-specific):
 * @property {(url: string) => Promise<void>} openExternal
 */
export function useAgentClient() {
  const ctx = useContext(AgentClientContext);
  if (!ctx) throw new Error('useAgentClient must be used within an AgentClientProvider');
  return ctx;
}

/**
 * Wrap your agent pages with this provider, supplying the host-specific client.
 *
 * @param {{ client: AgentClient, children: React.ReactNode }} props
 */
export function AgentClientProvider({ client, children }) {
  return <AgentClientContext.Provider value={client}>{children}</AgentClientContext.Provider>;
}

export default AgentClientContext;
