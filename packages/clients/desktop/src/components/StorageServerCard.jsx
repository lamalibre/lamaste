import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Database, Trash2, Loader2, AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

export default function StorageServerCard({ server }) {
  const queryClient = useQueryClient();
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [showDestroyModal, setShowDestroyModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  const destroyMutation = useMutation({
    mutationFn: () => invoke('destroy_storage_server', { serverId: server.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-servers'] });
      setShowDestroyModal(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => invoke('remove_storage_server', { serverId: server.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['storage-servers'] }),
  });

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-cyan-400" />
          <span className="text-sm font-medium text-white">{server.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400 font-medium">
            Spaces
          </span>
        </div>
      </div>

      <div className="space-y-1 mb-4">
        <div className="text-xs text-zinc-400">
          Bucket: <span className="font-mono text-zinc-300">{server.bucket}</span>
        </div>
        <div className="text-xs text-zinc-500">Region: {server.region}</div>
        <div className="text-xs text-zinc-500 font-mono">{server.endpoint}</div>
      </div>

      <div className="flex items-center gap-2">
        {confirmDestroy ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-red-400">Are you sure?</span>
            <button
              onClick={() => {
                setConfirmDestroy(false);
                setShowDestroyModal(true);
                setConfirmInput('');
              }}
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
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 flex items-center gap-1"
            >
              {removeMutation.isPending ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Trash2 size={10} />
              )}
              Remove
            </button>
            <button
              onClick={() => setConfirmDestroy(true)}
              className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 flex items-center gap-1"
            >
              <Trash2 size={10} />
              Destroy
            </button>
          </div>
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
                <h3 className="text-sm font-bold text-white">Destroy Storage Server</h3>
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
              <p className="text-xs text-zinc-400 leading-relaxed">
                This will <strong className="text-red-400">permanently delete</strong> the Spaces
                bucket <strong className="text-zinc-300 font-mono">{server.bucket}</strong> and
                remove it from the local registry. The bucket must be empty. This action cannot be
                undone.
              </p>
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
              {destroyMutation.isError && (
                <p className="text-xs text-red-400">{destroyMutation.error?.toString()}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
              <button
                onClick={() => setShowDestroyModal(false)}
                disabled={destroyMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                onClick={() => destroyMutation.mutate()}
                disabled={confirmInput !== server.label || destroyMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-30 flex items-center gap-1"
              >
                {destroyMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={10} />
                )}
                Destroy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
