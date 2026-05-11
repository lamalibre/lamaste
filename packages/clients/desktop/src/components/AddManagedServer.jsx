import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { X, Loader2, CheckCircle2 } from 'lucide-react';

export default function AddManagedServer({ onClose }) {
  const queryClient = useQueryClient();
  const [panelUrl, setPanelUrl] = useState('');
  const [label, setLabel] = useState('');

  const addMutation = useMutation({
    mutationFn: () =>
      invoke('add_managed_server', {
        panelUrl: panelUrl.trim(),
        label: label.trim() || panelUrl.replace(/https?:\/\//, '').split(':')[0].replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'my-server',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white">Add Existing Server</h2>
          <button
            onClick={onClose}
            disabled={addMutation.isPending}
            className="text-zinc-500 hover:text-white disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4">
          Connect to an existing Lamaste installation. The panel must be reachable from this machine.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Panel URL</label>
            <input
              type="text"
              value={panelUrl}
              onChange={(e) => setPanelUrl(e.target.value)}
              placeholder="https://1.2.3.4:9292"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Label <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="my-server"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        {addMutation.isError && (
          <p className="text-xs text-red-400 mt-3">{addMutation.error?.toString()}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => addMutation.mutate()}
            disabled={!panelUrl.trim() || addMutation.isPending}
            className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-50 flex items-center gap-1.5"
          >
            {addMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle2 size={12} />
            )}
            Add Server
          </button>
        </div>
      </div>
    </div>
  );
}
