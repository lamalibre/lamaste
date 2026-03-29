import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Terminal, Loader2, Plus } from 'lucide-react';
import AgentCard from '../components/AgentCard.jsx';
import InstallAgentWizard from '../components/InstallAgentWizard.jsx';

export default function Agents({ onManage }) {
  const [showInstallWizard, setShowInstallWizard] = useState(false);

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => invoke('get_agents'),
    refetchInterval: 5000,
  });

  const agents = agentsQuery.data || [];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-white">Agents</h1>
          {agents.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
              {agents.length}
            </span>
          )}
        </div>
        {agents.length > 0 && (
          <button
            onClick={() => setShowInstallWizard(true)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20"
          >
            <Plus size={12} />
            Add Agent
          </button>
        )}
      </div>

      {agentsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={14} className="animate-spin" />
          Loading agents...
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Terminal size={48} className="text-zinc-700 mb-4" />
          <h2 className="text-sm font-medium text-zinc-400 mb-2">No agents yet</h2>
          <p className="text-xs text-zinc-500 mb-6 text-center max-w-sm">
            Install an agent to connect this machine to a Portlama server.
          </p>
          <button
            onClick={() => setShowInstallWizard(true)}
            className="text-xs px-4 py-2 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1.5 mb-4"
          >
            <Plus size={14} />
            Install Agent
          </button>
          <p className="text-zinc-600 text-[10px] mb-2">or run manually:</p>
          <div className="rounded bg-zinc-950 border border-zinc-700 p-3 font-mono text-xs text-cyan-400 select-all max-w-md mx-auto">
            npx @lamalibre/portlama-agent setup --label my-server
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {agents.map((agent) => (
            <AgentCard key={agent.label} agent={agent} onManage={onManage} />
          ))}
        </div>
      )}

      {showInstallWizard && (
        <InstallAgentWizard onClose={() => setShowInstallWizard(false)} />
      )}
    </div>
  );
}
