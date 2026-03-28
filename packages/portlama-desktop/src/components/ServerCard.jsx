import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  Server,
  Trash2,
  ExternalLink,
  Globe,
  Loader2,
} from 'lucide-react';
import { useState } from 'react';

export default function ServerCard({ server, onSetActive, onManage }) {
  const queryClient = useQueryClient();
  const [confirmDestroy, setConfirmDestroy] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['server-health', server.id],
    queryFn: () => invoke('check_server_health', { serverId: server.id }),
    refetchInterval: 30000,
  });

  const destroyMutation = useMutation({
    mutationFn: () => invoke('destroy_cloud_server', { serverId: server.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setConfirmDestroy(false);
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
            <span className="text-xs text-red-400">Destroy server?</span>
            <button
              onClick={() =>
                hasCloudControls
                  ? destroyMutation.mutate()
                  : removeMutation.mutate()
              }
              disabled={destroyMutation.isPending || removeMutation.isPending}
              className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
            >
              {destroyMutation.isPending || removeMutation.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                'Yes'
              )}
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
    </div>
  );
}
