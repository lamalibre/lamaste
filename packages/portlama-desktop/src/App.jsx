import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  Terminal,
  SquareTerminal,
  Activity,
  Network,
  Compass,
  ScrollText,
  Settings,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import Dashboard from './pages/Dashboard.jsx';
import Tunnels from './pages/Tunnels.jsx';
import Services from './pages/Services.jsx';
import Shell from './pages/Shell.jsx';
import Logs from './pages/Logs.jsx';
import SettingsPage from './pages/Settings.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'tunnels', label: 'Tunnels', icon: Network },
  { id: 'services', label: 'Services', icon: Compass },
  { id: 'shell', label: 'Shell', icon: SquareTerminal },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function SetupRequired({ message }) {
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
        <p className="text-zinc-500 text-xs">
          The app will automatically detect the configuration once setup is complete.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: () => invoke('get_status'),
    refetchInterval: 3000,
  });

  const status = statusQuery.data;

  if (status && !status.configured) {
    return <SetupRequired message={status.setupMessage} />;
  }

  const handleOpenPanel = async () => {
    try {
      const url = await invoke('get_panel_url');
      await open(url);
    } catch {
      // silently ignore if config not loaded
    }
  };

  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard status={status} />;
      case 'tunnels':
        return <Tunnels />;
      case 'services':
        return <Services />;
      case 'shell':
        return <Shell />;
      case 'logs':
        return <Logs />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <Dashboard status={status} />;
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <div className="w-48 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">Portlama</span>
          </div>
        </div>
        <nav className="flex-1 p-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
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
          <button
            onClick={handleOpenPanel}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm mb-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
          >
            <ExternalLink size={14} />
            Open Panel
          </button>
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
      <div className="flex-1 overflow-y-auto">{renderPage()}</div>
    </div>
  );
}
