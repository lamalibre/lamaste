import { useState } from 'react';
import {
  Activity,
  Network,
  Compass,
  Puzzle,
  ScrollText,
  Settings,
  Terminal,
} from 'lucide-react';
import AgentDashboardPage from './pages/Dashboard.jsx';
import AgentTunnelsPage from './pages/Tunnels.jsx';
import AgentServicesPage from './pages/Services.jsx';
import AgentPluginsPage from './pages/Plugins.jsx';
import AgentLogsPage from './pages/Logs.jsx';
import AgentSettingsPage from './pages/Settings.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'tunnels', label: 'Tunnels', icon: Network },
  { id: 'services', label: 'Services', icon: Compass },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function WebApp() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const renderPage = () => {
    switch (activeTab) {
      case 'tunnels':
        return <AgentTunnelsPage />;
      case 'services':
        return <AgentServicesPage />;
      case 'plugins':
        return <AgentPluginsPage />;
      case 'logs':
        return <AgentLogsPage />;
      case 'settings':
        return <AgentSettingsPage />;
      case 'dashboard':
      default:
        return <AgentDashboardPage />;
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <div className="w-48 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">Portlama Agent</span>
          </div>
        </div>

        <nav className="flex-1 p-2 overflow-y-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
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
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">{renderPage()}</div>
    </div>
  );
}
