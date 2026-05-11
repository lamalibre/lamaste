import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import {
  Terminal,
  Activity,
  Network,
  Compass,
  ScrollText,
  Settings,
  Cloud,
  Server,
  FileText,
  Users,
  ShieldCheck,
  Ticket,
  Package,
  ChevronLeft,
  Puzzle,
  HardDrive,
  LogIn,
  LogOut,
  UserCheck,
  LayoutDashboard,
  Monitor,
  Eye,
  Trash2,
  Folder,
  Shield,
  Key,
  MessageSquare,
} from 'lucide-react';
import {
  AdminClientProvider,
  ToastProvider as AdminToastProvider,
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
  StoragePage,
  UserPluginAccessPage,
  GatekeeperDashboardPage,
  GatekeeperGroupsPage,
  GatekeeperGrantsPage,
  GatekeeperAccessRequestsPage,
  GatekeeperSettingsPage,
} from '@lamalibre/lamaste-server-ui';
import {
  AgentClientProvider,
  ToastProvider as AgentToastProvider,
  AgentDashboardPage,
  AgentTunnelsPage,
  AgentServicesPage,
  AgentPluginsPage,
  AgentPluginPanel,
  AgentLogsPage,
  AgentSettingsPage,
} from '@lamalibre/lamaste-agent-ui';
import { desktopAdminClient } from './lib/desktop-admin-client.js';
import { createDesktopAgentClient } from './lib/desktop-agent-client.js';
import { desktopUserAccessClient } from './lib/desktop-user-access-client.js';
import Servers from './pages/Servers.jsx';
import Agents from './pages/Agents.jsx';
import LocalPlugins from './pages/LocalPlugins.jsx';
import UserLogin from './pages/UserLogin.jsx';
import UserPlugins from './pages/UserPlugins.jsx';
import LocalDaemonPill from './components/LocalDaemonPill.jsx';
import FeriaStatusPill from './components/FeriaStatusPill.jsx';
import Welcome from './components/Welcome.jsx';

const AGENT_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'tunnels', label: 'Tunnels', icon: Network },
  { id: 'services', label: 'Services', icon: Compass },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
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
  { id: 'server-storage', label: 'Storage', icon: HardDrive },
  { id: 'server-user-access', label: 'User Plugin Access', icon: UserCheck },
  { id: 'server-gatekeeper', label: 'GK Dashboard', icon: Shield, section: 'Gatekeeper' },
  { id: 'server-gatekeeper-groups', label: 'Groups', icon: Users, section: 'Gatekeeper' },
  { id: 'server-gatekeeper-grants', label: 'Grants', icon: Key, section: 'Gatekeeper' },
  {
    id: 'server-gatekeeper-requests',
    label: 'Access Requests',
    icon: MessageSquare,
    section: 'Gatekeeper',
  },
  { id: 'server-gatekeeper-settings', label: 'GK Settings', icon: Settings, section: 'Gatekeeper' },
  { id: 'server-settings', label: 'Settings', icon: Settings },
];

// Map lucide icon name strings (from plugin pages metadata) to React components
const PLUGIN_ICON_MAP = {
  'layout-dashboard': LayoutDashboard,
  'hard-drive': HardDrive,
  monitor: Monitor,
  eye: Eye,
  'trash-2': Trash2,
  settings: Settings,
  folder: Folder,
  activity: Activity,
  network: Network,
  compass: Compass,
  'scroll-text': ScrollText,
  package: Package,
  puzzle: Puzzle,
  'shield-check': ShieldCheck,
  terminal: Terminal,
};

export default function App() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('agent-list');
  const [skipSetup, setSkipSetup] = useState(false);
  const [managingServer, setManagingServer] = useState(null);
  const [managingAgent, setManagingAgent] = useState(null);
  const [userSession, setUserSession] = useState(null);

  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  // Plugin sidebar injection state
  const [openPluginName, setOpenPluginName] = useState(null);
  const [openPluginPages, setOpenPluginPages] = useState([]);
  const [openPluginCurrentPage, setOpenPluginCurrentPage] = useState('');

  // Check for existing user session on mount
  useEffect(() => {
    desktopUserAccessClient
      .getSession()
      .then((session) => {
        if (session) setUserSession(session);
      })
      .catch(() => {});
  }, []);

  // Listen for deep link callback from Authelia OAuth flow
  useEffect(() => {
    let unlisten;
    listen('user-access-callback', async (event) => {
      const { token, domain, nonce } = event.payload || {};
      if (token && domain && nonce) {
        try {
          const result = await desktopUserAccessClient.exchangeToken(token, domain, nonce);
          if (result?.ok) {
            setUserSession({
              username: result.username,
              domain: result.domain,
              expiresAt: result.expiresAt,
            });
            setManagingAgent(null);
            setManagingServer(null);
            setActiveTab('user-plugins');
          }
        } catch (err) {
          console.error('Token exchange failed:', err);
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleUserLogout = useCallback(async () => {
    await desktopUserAccessClient.logout();
    setUserSession(null);
    setActiveTab('agent-list');
  }, []);

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: () => invoke('get_status'),
    refetchInterval: 3000,
  });

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => invoke('get_agents'),
    refetchInterval: 5000,
  });

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: () => invoke('get_servers'),
    refetchInterval: 10000,
  });

  const agents = agentsQuery.data || [];
  const servers = serversQuery.data || [];
  const status = statusQuery.data;

  const agentClient = useMemo(
    () => createDesktopAgentClient(managingAgent?.label),
    [managingAgent?.label],
  );

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

  const managingHasAdmin =
    managingServer && (!!managingServer.adminAuth || !!managingServer.provider);

  // Sync tray icon with aggregate agent connection state
  useEffect(() => {
    if (agents.length > 0) {
      const runningCount = agents.filter((a) => a.running).length;
      let state, tooltip;
      if (runningCount === agents.length) {
        state = 'online';
        tooltip = `Lamaste: ${runningCount}/${agents.length} agents connected`;
      } else if (runningCount > 0) {
        state = 'checking';
        tooltip = `Lamaste: ${runningCount}/${agents.length} agents connected`;
      } else {
        state = 'offline';
        tooltip = `Lamaste: 0/${agents.length} agents connected`;
      }
      invoke('set_tray_state', { state, tooltip }).catch(() => {});
    } else if (status) {
      let state, tooltip;
      if (!status.configured) {
        state = 'unconfigured';
        tooltip = 'Lamaste: Not configured';
      } else if (status.chisel?.running) {
        state = 'online';
        tooltip = 'Lamaste: Connected';
      } else {
        state = 'offline';
        tooltip = 'Lamaste: Disconnected';
      }
      invoke('set_tray_state', { state, tooltip }).catch(() => {});
    }
  }, [agents, status?.configured, status?.chisel?.running]);

  const handleManageServer = useCallback(
    async (server) => {
      try {
        await invoke('set_active_server', { serverId: server.id });
      } catch {
        // ignore if already active
      }
      queryClient.removeQueries({ queryKey: ['agent'] });
      setManagingAgent(null);
      setManagingServer(server);
      setActiveTab('server-dashboard');
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const handleBackToServerList = () => {
    setManagingServer(null);
    setActiveTab('server-list');
  };

  const handleManageAgent = useCallback(
    (agent) => {
      queryClient.removeQueries({ queryKey: ['agent'] });
      setManagingServer(null);
      setManagingAgent(agent);
      setActiveTab('dashboard');
      setOpenPluginName(null);
      setOpenPluginPages([]);
      setOpenPluginCurrentPage('');
    },
    [queryClient],
  );

  const handleBackToAgentList = () => {
    queryClient.removeQueries({ queryKey: ['agent'] });
    setManagingAgent(null);
    setActiveTab('agent-list');
    setOpenPluginName(null);
    setOpenPluginPages([]);
    setOpenPluginCurrentPage('');
  };

  const renderServerDetailPage = () => {
    if (!managingHasAdmin) {
      return (
        <div className="p-6 max-w-md mx-auto mt-20 text-center">
          <Server size={48} className="text-zinc-700 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">No Admin Certificate</h2>
          <p className="text-zinc-400 text-sm mb-4">
            This server was connected with an agent certificate. To manage it, import an admin
            certificate.
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
      case 'server-storage':
        return <StoragePage />;
      case 'server-user-access':
        return <UserPluginAccessPage />;
      case 'server-gatekeeper':
        return <GatekeeperDashboardPage />;
      case 'server-gatekeeper-groups':
        return <GatekeeperGroupsPage />;
      case 'server-gatekeeper-grants':
        return <GatekeeperGrantsPage />;
      case 'server-gatekeeper-requests':
        return <GatekeeperAccessRequestsPage />;
      case 'server-gatekeeper-settings':
        return <GatekeeperSettingsPage />;
      case 'server-settings':
        return <AdminSettingsPage hasDomain={managingHasDomain} />;
      default:
        return <DashboardPage />;
    }
  };

  const handleOpenPlugin = useCallback((pluginName, pages) => {
    setOpenPluginName(pluginName);
    setOpenPluginPages(pages || []);
    setOpenPluginCurrentPage(pages?.[0]?.id || '');
    setActiveTab('plugin-detail');
  }, []);

  const handleClosePlugin = useCallback(() => {
    setOpenPluginName(null);
    setOpenPluginPages([]);
    setOpenPluginCurrentPage('');
    setActiveTab('plugins');
  }, []);

  // All hooks must be above this line — React requires consistent hook count across renders
  if (
    status &&
    !status.configured &&
    agents.length === 0 &&
    servers.length === 0 &&
    !skipSetup &&
    !userSession
  ) {
    return <Welcome onSkip={() => setSkipSetup(true)} />;
  }

  const renderAgentDetailPage = () => {
    if (activeTab === 'plugin-detail' && openPluginName) {
      return (
        <div className="p-6 max-w-4xl mx-auto">
          <AgentPluginPanel
            pluginName={openPluginName}
            client={agentClient}
            onBack={handleClosePlugin}
            subPath={openPluginCurrentPage}
            onPagesDiscovered={(pages) => {
              if (pages.length > 0 && openPluginPages.length === 0) {
                setOpenPluginPages(pages);
                if (!openPluginCurrentPage) {
                  setOpenPluginCurrentPage(pages[0]?.id || '');
                }
              }
            }}
          />
        </div>
      );
    }
    switch (activeTab) {
      case 'tunnels':
        return <AgentTunnelsPage />;
      case 'services':
        return <AgentServicesPage />;
      case 'plugins':
        return <AgentPluginsPage onOpenPlugin={(name) => handleOpenPlugin(name, [])} />;
      case 'logs':
        return <AgentLogsPage />;
      case 'settings':
        return (
          <AgentSettingsPage
            agentLabel={managingAgent?.label}
            onUninstalled={navigateToAgentList}
          />
        );
      case 'dashboard':
      default:
        return <AgentDashboardPage />;
    }
  };

  const navigateToAgentList = () => {
    queryClient.removeQueries({ queryKey: ['agent'] });
    setManagingAgent(null);
    setManagingServer(null);
    setActiveTab('agent-list');
  };

  const navigateToServerList = () => {
    setManagingAgent(null);
    setManagingServer(null);
    setActiveTab('server-list');
  };

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <div className="w-48 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">Lamaste</span>
          </div>
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {/* AGENTS section */}
          <div className="mb-1">
            <button
              type="button"
              onClick={navigateToAgentList}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded hover:bg-zinc-800/30 mb-0.5"
            >
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  activeTab === 'agent-list' || managingAgent ? 'text-zinc-400' : 'text-zinc-500'
                }`}
              >
                Agents
              </span>
              {agents.length > 0 && (
                <span className="text-[10px] text-zinc-600">{agents.length}</span>
              )}
            </button>

            {managingAgent ? (
              <>
                <button
                  type="button"
                  onClick={handleBackToAgentList}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded text-xs mb-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                >
                  <ChevronLeft size={12} className="flex-shrink-0" />
                  <span className="truncate font-medium text-zinc-300">{managingAgent.label}</span>
                </button>
                {openPluginName && activeTab === 'plugin-detail' ? (
                  <>
                    {/* Plugin sidebar injection — show plugin pages */}
                    <button
                      type="button"
                      onClick={handleClosePlugin}
                      className="w-full flex items-center gap-1.5 pl-6 pr-3 py-1.5 rounded text-xs mb-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    >
                      <ChevronLeft size={11} className="flex-shrink-0" />
                      <span className="text-zinc-400">Plugins</span>
                    </button>
                    <div className="pl-6 pr-3 py-1 mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {openPluginName}
                      </span>
                    </div>
                    {openPluginPages.map((page) => {
                      const PageIcon = PLUGIN_ICON_MAP[page.icon] || Puzzle;
                      return (
                        <button
                          key={page.id}
                          type="button"
                          onClick={() => setOpenPluginCurrentPage(page.id)}
                          className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 rounded text-xs mb-0.5 ${
                            openPluginCurrentPage === page.id
                              ? 'bg-zinc-800 text-cyan-400'
                              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                          }`}
                        >
                          <PageIcon size={12} />
                          {page.label}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  AGENT_TABS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setActiveTab(id);
                        setOpenPluginName(null);
                        setOpenPluginPages([]);
                      }}
                      className={`w-full flex items-center gap-2 pl-6 pr-3 py-1.5 rounded text-xs mb-0.5 ${
                        activeTab === id
                          ? 'bg-zinc-800 text-cyan-400'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                      }`}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))
                )}
              </>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.label}
                  type="button"
                  onClick={() => handleManageAgent(agent)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs mb-0.5 ${
                    activeTab === 'agent-list'
                      ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                      agent.running ? 'bg-green-400' : 'bg-zinc-600'
                    }`}
                  />
                  <span className="truncate">{agent.label}</span>
                </button>
              ))
            )}
          </div>

          {/* SERVERS section */}
          <div className="mb-1 mt-3">
            <button
              type="button"
              onClick={navigateToServerList}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded hover:bg-zinc-800/30 mb-0.5"
            >
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  activeTab === 'server-list' || managingServer ? 'text-zinc-400' : 'text-zinc-500'
                }`}
              >
                Servers
              </span>
              {servers.length > 0 && (
                <span className="text-[10px] text-zinc-600">{servers.length}</span>
              )}
            </button>

            {managingServer ? (
              <>
                <button
                  type="button"
                  onClick={handleBackToServerList}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded text-xs mb-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                >
                  <ChevronLeft size={12} className="flex-shrink-0" />
                  <span className="truncate font-medium text-zinc-300">{managingServer.label}</span>
                </button>
                {managingHasAdmin &&
                  SERVER_ADMIN_TABS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={`w-full flex items-center gap-2 pl-6 pr-3 py-1.5 rounded text-xs mb-0.5 ${
                        activeTab === id
                          ? 'bg-zinc-800 text-cyan-400'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                      }`}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
              </>
            ) : (
              servers.map((server) => (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => handleManageServer(server)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs mb-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                >
                  <Cloud size={12} className="flex-shrink-0 text-zinc-600" />
                  <span className="truncate">{server.label || server.domain || 'Server'}</span>
                </button>
              ))
            )}
          </div>

          {/* LOCAL section */}
          <div className="mt-3 pt-2 border-t border-zinc-800">
            <div className="px-3 py-1.5">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  activeTab === 'local-plugins' ? 'text-zinc-400' : 'text-zinc-500'
                }`}
              >
                Local
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setManagingAgent(null);
                setManagingServer(null);
                setActiveTab('local-plugins');
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs mb-0.5 ${
                activeTab === 'local-plugins'
                  ? 'bg-zinc-800 text-cyan-400'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Puzzle size={13} />
              Plugins
            </button>
          </div>

          {/* USER section */}
          <div className="mt-3 pt-2 border-t border-zinc-800">
            <div className="px-3 py-1.5">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  activeTab === 'user-login' || activeTab === 'user-plugins'
                    ? 'text-zinc-400'
                    : 'text-zinc-500'
                }`}
              >
                User
              </span>
            </div>
            {userSession ? (
              <>
                <div className="px-3 py-1 mb-1">
                  <span className="text-[10px] text-zinc-500 truncate block">
                    {userSession.username}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setManagingAgent(null);
                    setManagingServer(null);
                    setActiveTab('user-plugins');
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs mb-0.5 ${
                    activeTab === 'user-plugins'
                      ? 'bg-zinc-800 text-cyan-400'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <Puzzle size={13} />
                  My Plugins
                </button>
                <button
                  type="button"
                  onClick={handleUserLogout}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs mb-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                >
                  <LogOut size={13} />
                  Logout
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setManagingAgent(null);
                  setManagingServer(null);
                  setActiveTab('user-login');
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs mb-0.5 ${
                  activeTab === 'user-login'
                    ? 'bg-zinc-800 text-cyan-400'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                <LogIn size={13} />
                User Login
              </button>
            )}
          </div>
        </nav>

        {/* Footer: daemon service pills + feria + version */}
        <div className="flex flex-col gap-1.5 border-t border-zinc-800 px-3 py-3">
          <LocalDaemonPill kind="agent" />
          <LocalDaemonPill kind="server" />
          <LocalDaemonPill kind="pluginHost" />
          <FeriaStatusPill />
          {appVersion && (
            <div className="mt-0.5 text-[10px] text-zinc-600">lamaste &middot; v{appVersion}</div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'user-login' ? (
          <UserLogin
            onBack={() => {
              setSkipSetup(false);
              setActiveTab('agent-list');
            }}
          />
        ) : activeTab === 'user-plugins' && userSession ? (
          <UserPlugins />
        ) : activeTab === 'local-plugins' ? (
          <LocalPlugins />
        ) : managingServer ? (
          <AdminClientProvider client={desktopAdminClient}>
            <AdminToastProvider>
              <TwoFaProvider>{renderServerDetailPage()}</TwoFaProvider>
            </AdminToastProvider>
          </AdminClientProvider>
        ) : managingAgent ? (
          <AgentClientProvider client={agentClient}>
            <AgentToastProvider>{renderAgentDetailPage()}</AgentToastProvider>
          </AgentClientProvider>
        ) : activeTab === 'server-list' ? (
          <Servers onManage={handleManageServer} />
        ) : (
          <Agents onManage={handleManageAgent} />
        )}
      </div>
    </div>
  );
}
