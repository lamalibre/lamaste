import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  Terminal,
  Activity,
  Network,
  Compass,
  ScrollText,
  Settings,
  AlertTriangle,
  ExternalLink,
  Cloud,
  Server,
  FileText,
  Users,
  ShieldCheck,
  Ticket,
  Package,
  Shield,
  ChevronLeft,
} from 'lucide-react';
import {
  AdminClientProvider,
  ToastProvider,
  TwoFaProvider,
  DashboardPage,
  ServicesPage,
  SitesPage,
  UsersPage,
  CertificatesPage,
  TicketsPage,
  PluginsPage,
  TunnelsPage,
  SettingsPage as AdminSettingsPage,
} from '@lamalibre/portlama-admin-panel';
import { desktopAdminClient } from './lib/desktop-admin-client.js';
import Dashboard from './pages/Dashboard.jsx';
import Tunnels from './pages/Tunnels.jsx';
import Services from './pages/Services.jsx';
import Servers from './pages/Servers.jsx';
import Logs from './pages/Logs.jsx';
import SettingsPage from './pages/Settings.jsx';

const AGENT_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'tunnels', label: 'Tunnels', icon: Network },
  { id: 'services', label: 'Services', icon: Compass },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const SERVER_ADMIN_TABS = [
  { id: 'server-dashboard', label: 'Dashboard', icon: Activity },
  { id: 'server-tunnels', label: 'Tunnels', icon: Network },
  { id: 'server-services', label: 'Services', icon: Server },
  { id: 'server-sites', label: 'Static Sites', icon: FileText },
  { id: 'server-users', label: 'Users', icon: Users },
  { id: 'server-certificates', label: 'Certificates', icon: ShieldCheck },
  { id: 'server-tickets', label: 'Tickets', icon: Ticket },
  { id: 'server-plugins', label: 'Plugins', icon: Package },
  { id: 'server-settings', label: 'Settings', icon: Settings },
];

function SetupRequired({ message, onCreateServer }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 p-8">
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 max-w-md text-center">
        <AlertTriangle size={48} className="text-amber-400 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-3">Agent Not Configured</h1>
        {message && <p className="text-zinc-400 text-sm mb-4">{message}</p>}
        <p className="text-zinc-400 text-sm mb-6">
          Run the following command in your terminal to connect to your Portlama server:
        </p>
        <div className="rounded bg-zinc-950 border border-zinc-700 p-4 font-mono text-sm text-cyan-400 select-all mb-4">
          npx @lamalibre/portlama-agent setup
        </div>
        <div className="border-t border-zinc-800 pt-4 mt-4">
          <p className="text-zinc-500 text-xs mb-3">
            Don&apos;t have a server yet?
          </p>
          <button
            onClick={onCreateServer}
            className="text-sm px-4 py-2 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 inline-flex items-center gap-2"
          >
            <Cloud size={14} />
            Create a new server
          </button>
        </div>
        <p className="text-zinc-500 text-xs mt-4">
          The app will automatically detect the configuration once setup is complete.
        </p>
      </div>
    </div>
  );
}

function ModeToggle({ mode, onModeChange }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-zinc-800 border border-zinc-700">
      <button
        type="button"
        onClick={() => onModeChange('agent')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
          mode === 'agent'
            ? 'bg-zinc-700 text-cyan-400'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <Terminal size={12} />
        Agents
      </button>
      <button
        type="button"
        onClick={() => onModeChange('admin')}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
          mode === 'admin'
            ? 'bg-zinc-700 text-cyan-400'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <Shield size={12} />
        Servers
      </button>
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [skipSetup, setSkipSetup] = useState(false);
  // Server mode: null = server list, server object = managing that server
  const [managingServer, setManagingServer] = useState(null);
  const [mode, setMode] = useState('agent');

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: () => invoke('get_status'),
    refetchInterval: 3000,
  });

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: () => invoke('get_servers'),
    refetchInterval: 10000,
  });

  const status = statusQuery.data;
  const servers = serversQuery.data || [];

  // Derive domain from the server being managed
  const managingDomain = (() => {
    if (!managingServer?.panelUrl) return '';
    try {
      const host = new URL(managingServer.panelUrl).hostname;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
      return host.startsWith('panel.') ? host.slice(6) : host;
    } catch {
      return '';
    }
  })();
  const managingHasDomain = managingDomain.length > 0;

  // Check if the server being managed has an admin cert
  const managingHasAdmin = managingServer && (
    !!managingServer.adminAuth || !!managingServer.provider
  );

  // Sync tray icon with connection state
  useEffect(() => {
    if (!status) return;
    let state, tooltip;
    if (!status.configured) {
      state = 'unconfigured';
      tooltip = 'Portlama: Not configured';
    } else if (status.chisel?.running) {
      state = 'online';
      tooltip = 'Portlama: Connected';
    } else {
      state = 'offline';
      tooltip = 'Portlama: Disconnected';
    }
    invoke('set_tray_state', { state, tooltip }).catch(() => {});
  }, [status?.configured, status?.chisel?.running]);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    setManagingServer(null);
    setActiveTab(newMode === 'admin' ? 'server-list' : 'dashboard');
  };

  const handleManageServer = useCallback(async (server) => {
    // Set this server as active so Rust admin commands target it
    try {
      await invoke('set_active_server', { serverId: server.id });
    } catch {
      // ignore if already active
    }
    setManagingServer(server);
    setActiveTab('server-dashboard');
    queryClient.invalidateQueries();
  }, [queryClient]);

  const handleBackToServerList = () => {
    setManagingServer(null);
    setActiveTab('server-list');
  };

  if (status && !status.configured && !skipSetup) {
    return (
      <SetupRequired
        message={status.setupMessage}
        onCreateServer={() => {
          setSkipSetup(true);
          setMode('admin');
          setActiveTab('server-list');
        }}
      />
    );
  }

  const handleOpenPanel = async () => {
    try {
      const url = await invoke('get_panel_url');
      await open(url);
    } catch {
      // silently ignore if config not loaded
    }
  };

  const renderAgentPage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard status={status} />;
      case 'tunnels':
        return <Tunnels />;
      case 'services':
        return <Services />;
      case 'logs':
        return <Logs />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard status={status} />;
    }
  };

  const renderServerPage = () => {
    // Server list is the landing page for Servers mode
    if (!managingServer) {
      return <Servers onManage={handleManageServer} />;
    }

    // Per-server admin panel
    if (!managingHasAdmin) {
      return (
        <div className="p-6 max-w-md mx-auto mt-20 text-center">
          <Server size={48} className="text-zinc-700 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">No Admin Certificate</h2>
          <p className="text-zinc-400 text-sm mb-4">
            This server was connected with an agent certificate. To manage it, import an admin certificate.
          </p>
          <button
            type="button"
            onClick={handleBackToServerList}
            className="text-sm px-4 py-2 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700"
          >
            Back to Servers
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'server-dashboard':
        return <DashboardPage />;
      case 'server-tunnels':
        return <TunnelsPage />;
      case 'server-services':
        return <ServicesPage />;
      case 'server-sites':
        return <SitesPage domain={managingDomain} />;
      case 'server-users':
        return <UsersPage />;
      case 'server-certificates':
        return <CertificatesPage />;
      case 'server-tickets':
        return <TicketsPage />;
      case 'server-plugins':
        return <PluginsPage />;
      case 'server-settings':
        return <AdminSettingsPage hasDomain={managingHasDomain} />;
      default:
        return <DashboardPage />;
    }
  };

  // Determine which tabs to show in sidebar
  const getSidebarTabs = () => {
    if (mode === 'agent') return AGENT_TABS;
    if (managingServer && managingHasAdmin) return SERVER_ADMIN_TABS;
    return []; // Server list mode — no nav tabs, content handles its own layout
  };

  const currentTabs = getSidebarTabs();

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <div className="w-48 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <Terminal size={18} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">Portlama</span>
          </div>
          <ModeToggle mode={mode} onModeChange={handleModeChange} />
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {/* Back button when managing a specific server */}
          {mode === 'admin' && managingServer && (
            <button
              type="button"
              onClick={handleBackToServerList}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm mb-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-b border-zinc-800 pb-3"
            >
              <ChevronLeft size={14} />
              <span className="truncate">{managingServer.label}</span>
            </button>
          )}

          {/* Server list link when in Servers mode without managing */}
          {mode === 'admin' && !managingServer && (
            <button
              type="button"
              onClick={() => setActiveTab('server-list')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm mb-0.5 bg-zinc-800 text-cyan-400"
            >
              <Cloud size={14} />
              Servers
            </button>
          )}

          {currentTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm mb-0.5 ${
                activeTab === id
                  ? 'bg-zinc-800 text-cyan-400'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}

          {mode === 'agent' && (
            <button
              type="button"
              onClick={handleOpenPanel}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm mb-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            >
              <ExternalLink size={14} />
              Open Panel
            </button>
          )}
        </nav>

        {/* Connection status */}
        <div className="p-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                status?.chisel?.running ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
            <span className="text-zinc-500">
              {status?.chisel?.running ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'admin' ? (
          <AdminClientProvider client={desktopAdminClient}>
            <ToastProvider>
              <TwoFaProvider>
                {renderServerPage()}
              </TwoFaProvider>
            </ToastProvider>
          </AdminClientProvider>
        ) : (
          renderAgentPage()
        )}
      </div>
    </div>
  );
}
