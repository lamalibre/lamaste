import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Network, Loader2, Plus, Trash2, X, Power } from 'lucide-react';

export default function Tunnels({ agentLabel }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [formData, setFormData] = useState({ subdomain: '', port: '', description: '' });
  const [formError, setFormError] = useState(null);

  const tunnelsQuery = useQuery({
    queryKey: ['tunnels', agentLabel],
    queryFn: () => agentLabel
      ? invoke('get_agent_tunnels', { label: agentLabel })
      : invoke('get_tunnels'),
    refetchInterval: 10000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tunnels'] });
    queryClient.invalidateQueries({ queryKey: ['status'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data) => {
      await invoke('create_tunnel', {
        subdomain: data.subdomain,
        port: parseInt(data.port, 10),
        description: data.description || '',
      });
      // After creating, update the agent so chisel picks up the new tunnel
      await invoke('update_agent');
    },
    onSuccess: () => {
      setShowForm(false);
      setFormData({ subdomain: '', port: '', description: '' });
      setFormError(null);
      invalidateAll();
    },
    onError: (err) => {
      setFormError(err?.message || String(err));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }) => {
      await invoke('toggle_tunnel', { id, enabled });
      await invoke('update_agent');
    },
    onSuccess: () => {
      invalidateAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await invoke('delete_tunnel', { id });
      await invoke('update_agent');
    },
    onSuccess: () => {
      setDeleteConfirm(null);
      invalidateAll();
    },
  });

  const tunnels = tunnelsQuery.data || [];

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError(null);

    const port = parseInt(formData.port, 10);
    if (!formData.subdomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(formData.subdomain)) {
      setFormError('Subdomain must be lowercase alphanumeric with optional hyphens');
      return;
    }
    if (formData.subdomain.length > 63) {
      setFormError('Subdomain must be at most 63 characters');
      return;
    }
    if (isNaN(port) || port < 1024 || port > 65535) {
      setFormError('Port must be between 1024 and 65535');
      return;
    }

    createMutation.mutate(formData);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-white">Tunnels</h1>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-sm text-white"
          >
            <Plus size={14} />
            New Tunnel
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Create Tunnel</h2>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Subdomain</label>
              <input
                type="text"
                placeholder="myapp"
                value={formData.subdomain}
                onChange={(e) =>
                  setFormData({ ...formData, subdomain: e.target.value.toLowerCase() })
                }
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Port</label>
              <input
                type="number"
                placeholder="3000"
                min={1024}
                max={65535}
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="text-xs text-zinc-500 block mb-1">Description (optional)</label>
            <input
              type="text"
              placeholder="My web app"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          {formError && <p className="text-red-400 text-xs mb-3">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Create Tunnel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {tunnelsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={14} className="animate-spin" />
          Loading tunnels...
        </div>
      ) : tunnels.length === 0 && !showForm ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
          <Network size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No tunnels configured.</p>
          <p className="text-zinc-500 text-xs mt-1">
            Click &quot;New Tunnel&quot; to expose a local service.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tunnels.map((tunnel) => {
            const enabled = tunnel.enabled !== false;
            return (
              <div
                key={tunnel.id || tunnel.fqdn}
                className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${!enabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white font-semibold">{tunnel.fqdn}</p>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          enabled
                            ? 'text-green-400 bg-green-500/10 border-green-500/20'
                            : 'text-zinc-500 bg-zinc-800 border-zinc-700'
                        }`}
                      >
                        {enabled ? 'active' : 'disabled'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      localhost:{tunnel.port}
                      {tunnel.description && ` — ${tunnel.description}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleMutation.mutate({ id: tunnel.id, enabled: !enabled })}
                      disabled={toggleMutation.isPending}
                      className={`p-1.5 rounded hover:bg-zinc-800 ${enabled ? 'text-yellow-400' : 'text-green-400'}`}
                      title={enabled ? 'Disable tunnel' : 'Enable tunnel'}
                    >
                      <Power size={14} />
                    </button>
                    {deleteConfirm === tunnel.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMutation.mutate(tunnel.id)}
                          disabled={deleteMutation.isPending}
                          className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                        >
                          {deleteMutation.isPending ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(tunnel.id)}
                        className="text-zinc-600 hover:text-red-400 p-1"
                        title="Delete tunnel"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteMutation.isError && (
        <p className="text-red-400 text-xs mt-3">
          {deleteMutation.error?.message || 'Delete failed'}
        </p>
      )}
    </div>
  );
}
