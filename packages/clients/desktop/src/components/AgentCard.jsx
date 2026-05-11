import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Terminal, Globe, Loader2, Play, Square, Server } from 'lucide-react';

export default function AgentCard({ agent, onManage }) {
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => invoke('start_agent', { label: agent.label }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => invoke('stop_agent', { label: agent.label }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const anyPending = startMutation.isPending || stopMutation.isPending;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-zinc-400" />
          <span className="text-sm font-medium text-white">{agent.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${agent.running ? 'bg-green-400' : 'bg-red-400'}`}
          />
          <span className="text-xs text-zinc-500">
            {agent.running ? `Running (PID ${agent.pid})` : 'Stopped'}
          </span>
        </div>
      </div>

      <div className="space-y-1 mb-4">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Server size={12} className="text-zinc-600" />
          <span className="truncate">{agent.panelUrl}</span>
        </div>
        {agent.domain && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Globe size={12} className="text-zinc-600" />
            <span>{agent.domain}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {agent.running ? (
          <button
            onClick={() => stopMutation.mutate()}
            disabled={anyPending}
            className="flex items-center gap-1.5 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {stopMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Square size={12} />
            )}
            Stop
          </button>
        ) : (
          <button
            onClick={() => startMutation.mutate()}
            disabled={anyPending}
            className="flex items-center gap-1.5 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {startMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            Start
          </button>
        )}
        <button
          onClick={() => onManage(agent)}
          className="flex items-center gap-1.5 rounded bg-cyan-400/10 text-cyan-400 px-3 py-1.5 text-xs font-medium hover:bg-cyan-400/20"
        >
          <Terminal size={12} />
          Manage
        </button>
      </div>
    </div>
  );
}
