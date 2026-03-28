import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Network,
  Power,
} from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';

// --- Relative time helper ---

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 30) {
    return new Date(dateStr).toLocaleDateString();
  }
  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}

// --- Subdomain validation ---

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateSubdomain(value) {
  if (!value) return 'Subdomain is required';
  if (value.length > 63) return 'Max 63 characters';
  if (!SUBDOMAIN_REGEX.test(value)) {
    return 'Lowercase letters, numbers, and hyphens only. Cannot start or end with a hyphen.';
  }
  return null;
}

function validatePort(value) {
  const num = Number(value);
  if (!value && value !== 0) return 'Port is required';
  if (!Number.isInteger(num)) return 'Must be an integer';
  if (num < 1024) return 'Minimum 1024';
  if (num > 65535) return 'Maximum 65535';
  return null;
}

// --- Add Tunnel Form ---

function AddTunnelForm({ domain, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [subdomain, setSubdomain] = useState('');
  const [port, setPort] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);

  const mutation = useMutation({
    mutationFn: (data) => client.createTunnel(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
      addToast(`Tunnel ${data.tunnel.fqdn} created`);
      onClose();
    },
    onError: (err) => {
      setApiError(err.message);
    },
  });

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setApiError(null);

      const subdomainErr = validateSubdomain(subdomain);
      const portErr = validatePort(port);
      const newErrors = {};
      if (subdomainErr) newErrors.subdomain = subdomainErr;
      if (portErr) newErrors.port = portErr;

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      setErrors({});
      mutation.mutate({
        subdomain,
        port: Number(port),
        description: description || undefined,
      });
    },
    [subdomain, port, description, mutation],
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
        <Plus size={14} className="text-cyan-400" />
        Add Tunnel
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Subdomain */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Subdomain</label>
          <div className="flex items-center gap-0">
            <input
              type="text"
              value={subdomain}
              onChange={(e) => {
                setSubdomain(e.target.value.toLowerCase());
                setErrors((prev) => ({ ...prev, subdomain: undefined }));
              }}
              disabled={mutation.isPending}
              placeholder="myapp"
              className="flex-1 rounded-l bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
            />
            <span className="rounded-r bg-zinc-800/60 border border-l-0 border-zinc-700 px-3 py-2 text-sm text-zinc-500 font-mono">
              .{domain}
            </span>
          </div>
          {errors.subdomain && <p className="text-red-400 text-xs mt-1">{errors.subdomain}</p>}
        </div>

        {/* Port */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
              setErrors((prev) => ({ ...prev, port: undefined }));
            }}
            disabled={mutation.isPending}
            placeholder="8080"
            min={1024}
            max={65535}
            className="w-40 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
          />
          {errors.port && <p className="text-red-400 text-xs mt-1">{errors.port}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Description <span className="text-zinc-600">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={mutation.isPending}
            placeholder="My web application"
            maxLength={200}
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
          />
        </div>

        {/* API Error */}
        {apiError && (
          <div className="rounded bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
            {apiError}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Setting up tunnel...
              </>
            ) : (
              <>
                <Plus size={14} />
                Add Tunnel
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Delete Confirmation ---

function DeleteConfirmation({ tunnel, onConfirm, onCancel, isPending }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-2">Delete Tunnel</h3>
        <p className="text-zinc-400 text-sm mb-6">
          Are you sure you want to delete{' '}
          <span className="text-cyan-400 font-mono">{tunnel.fqdn}</span>? This will remove the nginx
          configuration and TLS certificate mapping.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Tunnel Table (desktop) ---

function TunnelTable({ tunnels, onDelete, onToggle }) {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-700">
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Status
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Subdomain
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              FQDN
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Port
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Description
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Created
            </th>
            <th className="text-right text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {tunnels.map((tunnel) => {
            const enabled = tunnel.enabled !== false;
            return (
              <tr
                key={tunnel.id}
                className={`border-b border-zinc-700 ${enabled ? 'bg-zinc-800/50' : 'bg-zinc-800/20 opacity-60'}`}
              >
                <td className="py-3 px-4">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      enabled
                        ? 'text-green-400 bg-green-500/10 border-green-500/20'
                        : 'text-zinc-500 bg-zinc-800 border-zinc-700'
                    }`}
                  >
                    {enabled ? 'active' : 'disabled'}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-zinc-200 font-mono">{tunnel.subdomain}</td>
                <td className="py-3 px-4 text-sm">
                  <a
                    href={`https://${tunnel.fqdn}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 ${enabled ? 'text-cyan-400 hover:text-cyan-300' : 'text-zinc-500'}`}
                  >
                    {tunnel.fqdn}
                    <ExternalLink size={12} />
                  </a>
                </td>
                <td className="py-3 px-4 text-sm text-zinc-200 font-mono">{tunnel.port}</td>
                <td className="py-3 px-4 text-sm text-zinc-400">
                  {tunnel.description || '\u2014'}
                </td>
                <td className="py-3 px-4 text-sm text-zinc-500">
                  {relativeTime(tunnel.createdAt)}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggle(tunnel)}
                      className={`inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs hover:bg-zinc-600 ${
                        enabled ? 'text-yellow-400' : 'text-green-400'
                      }`}
                      title={enabled ? 'Disable tunnel' : 'Enable tunnel'}
                    >
                      <Power size={12} />
                      {enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(tunnel)}
                      className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-600/20 hover:text-red-300"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Tunnel Cards (mobile) ---

function TunnelCards({ tunnels, onDelete, onToggle }) {
  return (
    <div className="md:hidden space-y-3">
      {tunnels.map((tunnel) => {
        const enabled = tunnel.enabled !== false;
        return (
          <div
            key={tunnel.id}
            className={`border border-zinc-700 rounded-lg p-4 ${enabled ? 'bg-zinc-800/50' : 'bg-zinc-800/20 opacity-60'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    enabled
                      ? 'text-green-400 bg-green-500/10 border-green-500/20'
                      : 'text-zinc-500 bg-zinc-800 border-zinc-700'
                  }`}
                >
                  {enabled ? 'active' : 'disabled'}
                </span>
                <span className="text-sm font-semibold text-zinc-200 font-mono">
                  {tunnel.subdomain}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggle(tunnel)}
                  className={`text-xs ${enabled ? 'text-yellow-400' : 'text-green-400'}`}
                >
                  <Power size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(tunnel)}
                  className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <a
              href={`https://${tunnel.fqdn}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm inline-flex items-center gap-1 mb-1 ${enabled ? 'text-cyan-400 hover:text-cyan-300' : 'text-zinc-500'}`}
            >
              {tunnel.fqdn}
              <ExternalLink size={12} />
            </a>
            <div className="flex items-center gap-4 text-xs text-zinc-500 mt-2">
              <span>
                Port: <span className="text-zinc-300 font-mono">{tunnel.port}</span>
              </span>
              <span>{relativeTime(tunnel.createdAt)}</span>
            </div>
            {tunnel.description && (
              <p className="text-xs text-zinc-400 mt-2">{tunnel.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Mac Config Section ---

function MacConfigSection({ hasTunnels }) {
  const client = useAdminClient();
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const handleDownload = useCallback(async () => {
    try {
      await client.getMacPlist();
    } catch {
      // Errors are non-critical for download
    }
  }, [client]);

  const instructions = [
    {
      step: 'Install Chisel:',
      code: 'brew install chisel',
      note: 'or download from https://github.com/jpillora/chisel/releases',
    },
    {
      step: 'Save the downloaded file to:',
      code: '~/Library/LaunchAgents/com.portlama.chisel.plist',
    },
    {
      step: 'Load the agent:',
      code: 'launchctl load ~/Library/LaunchAgents/com.portlama.chisel.plist',
    },
    { step: 'Check status:', code: 'launchctl list | grep chisel' },
    { step: 'View logs:', code: 'tail -f /usr/local/var/log/chisel.log' },
    {
      step: 'To update after adding/removing tunnels:',
      note: 'Download a new plist, unload the old one, load the new one.',
    },
  ];

  return (
    <div className="mt-8 border-t border-zinc-800 pt-6">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4">Mac Client Configuration</h2>

      <button
        type="button"
        onClick={handleDownload}
        disabled={!hasTunnels}
        title={!hasTunnels ? 'Add at least one tunnel first' : 'Download launchd plist'}
        className="flex items-center gap-2 rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={14} />
        Download Mac Config
      </button>

      {!hasTunnels && (
        <p className="text-xs text-zinc-500 mt-2">
          Add at least one tunnel to download the config.
        </p>
      )}

      {/* Collapsible instructions */}
      <button
        type="button"
        onClick={() => setInstructionsOpen((prev) => !prev)}
        className="flex items-center gap-1 mt-4 text-sm text-zinc-400 hover:text-zinc-300"
      >
        {instructionsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Mac Setup Instructions
      </button>

      {instructionsOpen && (
        <div className="mt-3 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <ol className="space-y-3 text-sm text-zinc-400 list-decimal list-inside">
            {instructions.map((item, i) => (
              <li key={i}>
                {item.step}
                {item.code && (
                  <code className="ml-2 bg-zinc-800 px-2 py-0.5 rounded text-xs font-mono text-cyan-400">
                    {item.code}
                  </code>
                )}
                {item.note && (
                  <span className="block ml-5 text-xs text-zinc-500 mt-0.5">{item.note}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// --- Main Page ---

export default function Tunnels() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const tunnelsQuery = useQuery({
    queryKey: ['tunnels'],
    queryFn: () => client.getTunnels(),
    refetchInterval: 10_000,
  });

  // Fetch tunnel agent config to get the domain for the add-tunnel form
  const agentConfigQuery = useQuery({
    queryKey: ['tunnel-agent-config'],
    queryFn: () => client.getTunnelAgentConfig(),
  });

  const domain = agentConfigQuery.data?.domain;

  const deleteMutation = useMutation({
    mutationFn: (id) => client.deleteTunnel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
      addToast(`Tunnel ${deleteTarget.fqdn} deleted`);
      setDeleteTarget(null);
    },
    onError: (err) => {
      addToast(err.message, 'error');
      setDeleteTarget(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }) => client.toggleTunnel(id, { enabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
      const t = data.tunnel;
      addToast(`Tunnel ${t.fqdn} ${t.enabled ? 'enabled' : 'disabled'}`);
    },
    onError: (err) => {
      addToast(err.message, 'error');
    },
  });

  const handleDelete = useCallback((tunnel) => {
    setDeleteTarget(tunnel);
  }, []);

  const handleToggle = useCallback(
    (tunnel) => {
      const enabled = tunnel.enabled !== false;
      toggleMutation.mutate({ id: tunnel.id, enabled: !enabled });
    },
    [toggleMutation],
  );

  const confirmDelete = useCallback(() => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
    }
  }, [deleteTarget, deleteMutation]);

  const tunnels = tunnelsQuery.data?.tunnels || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Tunnels</h1>
          <p className="text-zinc-500 text-sm mt-1">Manage reverse tunnel configurations</p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Plus size={14} />
            Add Tunnel
          </button>
        )}
      </div>

      {/* Add Tunnel Form */}
      {showForm && domain && <AddTunnelForm domain={domain} onClose={() => setShowForm(false)} />}

      {/* Tunnel List */}
      {tunnelsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
            />
          ))}
        </div>
      ) : tunnelsQuery.isError ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
          <p className="text-red-400 text-sm">Failed to load tunnels</p>
        </div>
      ) : tunnels.length === 0 ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-12 text-center">
          <Network size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">
            No tunnels yet. Add your first tunnel to get started.
          </p>
        </div>
      ) : (
        <>
          <TunnelTable tunnels={tunnels} onDelete={handleDelete} onToggle={handleToggle} />
          <TunnelCards tunnels={tunnels} onDelete={handleDelete} onToggle={handleToggle} />
        </>
      )}

      {/* Mac Config Download */}
      <MacConfigSection hasTunnels={tunnels.length > 0} />

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmation
          tunnel={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
