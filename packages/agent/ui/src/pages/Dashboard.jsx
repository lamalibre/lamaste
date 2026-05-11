import { Activity, HardDrive, RefreshCw, Loader2, Play, Square, Download } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAgentClient } from '../context/AgentClientContext.jsx';

export default function Dashboard() {
  const client = useAgentClient();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['agent', 'status'] });
    queryClient.invalidateQueries({ queryKey: ['agent', 'tunnels'] });
    queryClient.invalidateQueries({ queryKey: ['agents'] });
  };

  const statusQuery = useQuery({
    queryKey: ['agent', 'status'],
    queryFn: () => client.getStatus(),
    refetchInterval: 3000,
  });

  const stopMutation = useMutation({
    mutationFn: () => client.stopAgent(),
    onSuccess: invalidateAll,
  });

  const startMutation = useMutation({
    mutationFn: () => client.startAgent(),
    onSuccess: invalidateAll,
  });

  const restartMutation = useMutation({
    mutationFn: () => client.restartAgent(),
    onSuccess: invalidateAll,
  });

  const updateMutation = useMutation({
    mutationFn: () => client.updateAgent(),
    onSuccess: invalidateAll,
  });

  const anyPending =
    stopMutation.isPending ||
    startMutation.isPending ||
    restartMutation.isPending ||
    updateMutation.isPending;

  const lastResult = updateMutation.isSuccess
    ? { type: 'success', msg: updateMutation.data }
    : updateMutation.isError
      ? { type: 'error', msg: updateMutation.error?.message || 'Update failed' }
      : stopMutation.isSuccess
        ? { type: 'success', msg: stopMutation.data }
        : stopMutation.isError
          ? { type: 'error', msg: stopMutation.error?.message || 'Stop failed' }
          : startMutation.isSuccess
            ? { type: 'success', msg: startMutation.data }
            : startMutation.isError
              ? { type: 'error', msg: startMutation.error?.message || 'Start failed' }
              : restartMutation.isSuccess
                ? { type: 'success', msg: restartMutation.data }
                : restartMutation.isError
                  ? { type: 'error', msg: restartMutation.error?.message || 'Restart failed' }
                  : null;

  const chisel = statusQuery.data;

  return (
    <div className="p-6">
      <h1 className="text-lg font-bold text-white mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Connection Status */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-cyan-400" />
            <span className="text-xs font-medium uppercase text-zinc-400">Connection</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`h-3 w-3 rounded-full ${chisel?.running ? 'bg-green-400' : 'bg-red-400'}`}
            />
            <span className="text-white font-semibold">
              {chisel?.running ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          {chisel?.pid && <p className="text-xs text-zinc-500">PID: {chisel.pid}</p>}
        </div>

        {/* Chisel Info */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive size={14} className="text-cyan-400" />
            <span className="text-xs font-medium uppercase text-zinc-400">Chisel</span>
          </div>
          <p className="text-white font-semibold mb-1">
            {chisel?.installed ? `v${chisel.chiselVersion || '?'}` : 'Not installed'}
          </p>
          <p className="text-xs text-zinc-500">
            {chisel?.installed ? 'Installed' : 'Run lamaste-agent setup'}
          </p>
        </div>
      </div>

      {/* Chisel Controls */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-4">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3">Chisel Controls</h2>
        <div className="flex gap-3">
          <button
            onClick={() => stopMutation.mutate()}
            disabled={anyPending || !chisel?.running}
            className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {stopMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Square size={14} />
            )}
            Stop
          </button>
          <button
            onClick={() => startMutation.mutate()}
            disabled={anyPending || chisel?.running}
            className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {startMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Start
          </button>
          <button
            onClick={() => restartMutation.mutate()}
            disabled={anyPending || !chisel?.installed}
            className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {restartMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Restart
          </button>
        </div>
      </div>

      {/* Update Agent */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3">Agent</h2>
        <button
          onClick={() => updateMutation.mutate()}
          disabled={anyPending}
          className="flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {updateMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Update Agent
        </button>
        <p className="text-xs text-zinc-500 mt-2">
          Re-fetch tunnel configuration from the panel and reload Chisel.
        </p>
        {lastResult && (
          <p
            className={`text-xs mt-2 ${lastResult.type === 'success' ? 'text-green-400' : 'text-red-400'}`}
          >
            {lastResult.msg}
          </p>
        )}
      </div>
    </div>
  );
}
