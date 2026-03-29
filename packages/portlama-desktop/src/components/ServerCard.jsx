import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  Server,
  Trash2,
  ExternalLink,
  Globe,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useState } from 'react';

export default function ServerCard({ server, onSetActive, onManage }) {
  const queryClient = useQueryClient();
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [showDestroyModal, setShowDestroyModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  const healthQuery = useQuery({
    queryKey: ['server-health', server.id],
    queryFn: () => invoke('check_server_health', { serverId: server.id }),
    refetchInterval: 30000,
  });

  const destroyMutation = useMutation({
    mutationFn: () => invoke('destroy_cloud_server', { serverId: server.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setShowDestroyModal(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => invoke('remove_server', { serverId: server.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
  });

  const online = healthQuery.data?.online ?? false;
  const hasCloudControls = !!server.providerId;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-zinc-400" />
          <span className="text-sm font-medium text-white">{server.label}</span>
          {server.active && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400 font-medium">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`}
          />
          <span className="text-xs text-zinc-500">
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="space-y-1 mb-4">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Globe size={12} />
          <span className="font-mono">{server.ip}</span>
        </div>
        {server.region && (
          <div className="text-xs text-zinc-500 ml-5">
            Region: {server.region}
          </div>
        )}
        {server.provider && (
          <div className="text-xs text-zinc-500 ml-5">
            Provider: {server.provider}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!server.active && (
          <button
            onClick={() => onSetActive(server.id)}
            className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700"
          >
            Set Active
          </button>
        )}
        {onManage && (
          <button
            onClick={() => onManage(server)}
            className="text-xs px-2.5 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1"
          >
            <Server size={10} />
            Manage
          </button>
        )}
        <button
          onClick={() => {
            if (server.panelUrl?.startsWith('https://')) open(server.panelUrl);
          }}
          className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 flex items-center gap-1"
        >
          <ExternalLink size={10} />
          Panel
        </button>

        {confirmDestroy ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-red-400">Are you sure?</span>
            <button
              onClick={() => { setConfirmDestroy(false); setShowDestroyModal(true); setConfirmInput(''); }}
              className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDestroy(false)}
              className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-white"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDestroy(true)}
            className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 ml-auto flex items-center gap-1"
          >
            <Trash2 size={10} />
            {hasCloudControls ? 'Destroy' : 'Remove'}
          </button>
        )}
      </div>

      {(destroyMutation.isError || removeMutation.isError) && (
        <p className="text-xs text-red-400 mt-2">
          {destroyMutation.error?.toString() || removeMutation.error?.toString()}
        </p>
      )}

      {showDestroyModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-400" />
                <h3 className="text-sm font-bold text-white">
                  {hasCloudControls ? 'Destroy Server' : 'Remove Server'}
                </h3>
              </div>
              <button
                onClick={() => setShowDestroyModal(false)}
                disabled={destroyMutation.isPending || removeMutation.isPending}
                className="text-zinc-500 hover:text-white disabled:opacity-30"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 space-y-3">
              {hasCloudControls ? (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  This will <strong className="text-red-400">permanently destroy</strong> the
                  droplet on DigitalOcean and remove it from the local registry.
                  This action cannot be undone.
                </p>
              ) : (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  This will remove the server from the local registry.
                  The server itself will not be affected.
                </p>
              )}
              <div>
                <p className="text-xs text-zinc-400 mb-1.5">
                  Type <strong className="text-white font-mono">{server.label}</strong> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={server.label}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-red-400 font-mono"
                />
              </div>
              {(destroyMutation.isError || removeMutation.isError) && (
                <p className="text-xs text-red-400">
                  {destroyMutation.error?.toString() || removeMutation.error?.toString()}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
              <button
                onClick={() => setShowDestroyModal(false)}
                disabled={destroyMutation.isPending || removeMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  hasCloudControls
                    ? destroyMutation.mutate()
                    : removeMutation.mutate()
                }
                disabled={
                  confirmInput !== server.label ||
                  destroyMutation.isPending ||
                  removeMutation.isPending
                }
                className="text-xs px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 flex items-center gap-1"
              >
                {destroyMutation.isPending || removeMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={10} />
                )}
                {hasCloudControls ? 'Destroy' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
