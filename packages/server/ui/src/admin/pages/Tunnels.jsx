import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errorMessage.js';
import { Plus, Trash2, ExternalLink, Loader2, Network, Power, Settings2 } from 'lucide-react';
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

const MAX_BODY_MB = { default: 10, min: 1, max: 10240 };

function validateMaxBody(value) {
  const num = Number(value);
  if (value === '' || !Number.isInteger(num)) return 'Must be a whole number of MiB';
  if (num < MAX_BODY_MB.min) return `Minimum ${MAX_BODY_MB.min}`;
  if (num > MAX_BODY_MB.max) return `Maximum ${MAX_BODY_MB.max}`;
  return null;
}

// Tunnels created before the setting existed carry nginx's built-in 1 MiB.
function effectiveMaxBody(tunnel) {
  return tunnel.maxBodySizeMb ?? 1;
}

const ACCESS_OPTIONS = [
  { value: 'restricted', label: 'Restricted', desc: 'Only granted users and groups' },
  {
    value: 'authenticated',
    label: 'All Authelia Users',
    desc: 'Any authenticated user can access',
  },
  { value: 'public', label: 'Public', desc: 'No authentication required' },
];

// Mirrors RESERVED_TUNNEL_PORTS in @lamalibre/lamaste — the relay's own
// services (panel, chisel, Authelia, IP panel, Gatekeeper). The panel rejects
// them too; this only explains why before the request is sent.
const RESERVED_TUNNEL_PORTS = [3100, 9090, 9091, 9292, 9294];

function validatePort(value) {
  const num = Number(value);
  if (!value && value !== 0) return 'Port is required';
  if (!Number.isInteger(num)) return 'Must be an integer';
  if (num < 1024) return 'Minimum 1024';
  if (num > 65535) return 'Maximum 65535';
  if (RESERVED_TUNNEL_PORTS.includes(num)) return 'Reserved for a Lamaste service on the relay';
  return null;
}

// --- Agents that can carry a tunnel ---

// Enrolled, non-revoked regular agents. Plugin-agent certificates never carry
// tunnels, so they are not offered.
function useCarrierAgents() {
  const client = useAdminClient();
  const query = useQuery({
    queryKey: ['admin-agents'],
    queryFn: () => client.getAgents(),
  });
  const agents = (query.data?.agents || [])
    .filter((a) => !a.revoked && a.certType !== 'plugin-agent')
    .map((a) => a.label)
    .sort();
  return { agents, isLoading: query.isLoading };
}

// --- Add Tunnel Form ---

function AddTunnelForm({ domain, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [subdomain, setSubdomain] = useState('');
  const [port, setPort] = useState('');
  const [description, setDescription] = useState('');
  const [accessMode, setAccessMode] = useState('restricted');
  const [agentLabel, setAgentLabel] = useState('');
  const [maxBody, setMaxBody] = useState(String(MAX_BODY_MB.default));
  const { agents, isLoading: agentsLoading } = useCarrierAgents();
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
      setApiError(errorMessage(err));
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
      if (!agentLabel) newErrors.agentLabel = 'Choose the agent that carries this tunnel';
      const maxBodyErr = validateMaxBody(maxBody);
      if (maxBodyErr) newErrors.maxBody = maxBodyErr;

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      setErrors({});
      mutation.mutate({
        subdomain,
        port: Number(port),
        description: description || undefined,
        accessMode,
        agentLabel,
        maxBodySizeMb: Number(maxBody),
      });
    },
    [subdomain, port, description, accessMode, agentLabel, maxBody, mutation],
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

        {/* Carrying agent */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Agent</label>
          <select
            value={agentLabel}
            onChange={(e) => {
              setAgentLabel(e.target.value);
              setErrors((prev) => ({ ...prev, agentLabel: undefined }));
            }}
            disabled={mutation.isPending || agentsLoading}
            className="w-64 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-cyan-400 disabled:opacity-50"
          >
            <option value="">{agentsLoading ? 'Loading agents…' : 'Select an agent'}</option>
            {agents.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500 mt-1">
            Only this agent forwards the port. It starts carrying the tunnel within 30 seconds.
          </p>
          {!agentsLoading && agents.length === 0 && (
            <p className="text-yellow-400 text-xs mt-1">
              No agents enrolled yet — enroll one under Certificates first.
            </p>
          )}
          {errors.agentLabel && <p className="text-red-400 text-xs mt-1">{errors.agentLabel}</p>}
        </div>

        {/* Request body limit */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Largest request body (MiB)</label>
          <input
            type="number"
            value={maxBody}
            onChange={(e) => {
              setMaxBody(e.target.value);
              setErrors((prev) => ({ ...prev, maxBody: undefined }));
            }}
            disabled={mutation.isPending}
            min={MAX_BODY_MB.min}
            max={MAX_BODY_MB.max}
            className="w-40 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-cyan-400 disabled:opacity-50"
          />
          <p className="text-xs text-zinc-500 mt-1">
            Larger uploads are rejected with 413. Raise it for apps that accept big files.
          </p>
          {errors.maxBody && <p className="text-red-400 text-xs mt-1">{errors.maxBody}</p>}
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

        {/* Access Mode */}
        <div>
          <label className="block text-xs text-zinc-400 mb-2">Access</label>
          <div className="space-y-2">
            {ACCESS_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="accessMode"
                  value={opt.value}
                  checked={accessMode === opt.value}
                  onChange={(e) => setAccessMode(e.target.value)}
                  disabled={mutation.isPending}
                  className="mt-1 text-cyan-500 focus:ring-cyan-500 bg-zinc-800 border-zinc-700"
                />
                <div>
                  <span className="text-sm text-zinc-200">{opt.label}</span>
                  <p className="text-xs text-zinc-500">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
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

// --- Edit dialog (carrier, access mode, body limit) ---

function EditTunnelDialog({ tunnel, onConfirm, onCancel, isPending }) {
  const { agents, isLoading } = useCarrierAgents();
  const [agentLabel, setAgentLabel] = useState(tunnel.agentLabel || '');
  const [accessMode, setAccessMode] = useState(tunnel.accessMode || 'restricted');
  const initialMaxBody = effectiveMaxBody(tunnel);
  const [maxBody, setMaxBody] = useState(String(initialMaxBody));
  const maxBodyErr = validateMaxBody(maxBody);

  const changes = {};
  if (agentLabel && agentLabel !== tunnel.agentLabel) changes.agentLabel = agentLabel;
  if (accessMode !== (tunnel.accessMode || 'restricted')) changes.accessMode = accessMode;
  // Compare with what the field started at: a tunnel from before the setting
  // shows nginx's implicit 1 MiB, and leaving that untouched is not a change.
  if (!maxBodyErr && Number(maxBody) !== initialMaxBody) {
    changes.maxBodySizeMb = Number(maxBody);
  }
  const hasChanges = Object.keys(changes).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-1">Edit Tunnel</h3>
        <p className="text-cyan-400 font-mono text-sm mb-5">{tunnel.fqdn}</p>

        <label className="block text-xs text-zinc-400 mb-1">Agent</label>
        <select
          value={agentLabel}
          onChange={(e) => setAgentLabel(e.target.value)}
          disabled={isPending || isLoading}
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-cyan-400 disabled:opacity-50"
        >
          {!tunnel.agentLabel && <option value="">Unassigned — select an agent</option>}
          {agents.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        {changes.agentLabel && (
          <p className="text-xs text-zinc-500 mt-1">
            {tunnel.agentLabel ? 'Both agents pick' : `${changes.agentLabel} picks`} the change up
            within 30 seconds.
          </p>
        )}

        <label className="block text-xs text-zinc-400 mt-4 mb-2">Access</label>
        <div className="space-y-2">
          {ACCESS_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="editAccessMode"
                value={opt.value}
                checked={accessMode === opt.value}
                onChange={(e) => setAccessMode(e.target.value)}
                disabled={isPending}
                className="mt-1 text-cyan-500 focus:ring-cyan-500 bg-zinc-800 border-zinc-700"
              />
              <div>
                <span className="text-sm text-zinc-200">{opt.label}</span>
                <p className="text-xs text-zinc-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <label className="block text-xs text-zinc-400 mt-4 mb-1">Largest request body (MiB)</label>
        <input
          type="number"
          value={maxBody}
          onChange={(e) => setMaxBody(e.target.value)}
          disabled={isPending}
          min={MAX_BODY_MB.min}
          max={MAX_BODY_MB.max}
          className="w-40 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:outline-none focus:border-cyan-400 disabled:opacity-50"
        />
        {maxBodyErr && <p className="text-red-400 text-xs mt-1">{maxBodyErr}</p>}

        <div className="flex items-center justify-end gap-3 mt-6">
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
            onClick={() => onConfirm(changes)}
            disabled={isPending || !hasChanges || Boolean(maxBodyErr)}
            className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Carrying agent badge ---

function CarrierBadge({ tunnel }) {
  if (tunnel.agentLabel) {
    return <span className="text-sm text-zinc-300 font-mono">{tunnel.agentLabel}</span>;
  }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs bg-red-500/10 text-red-400"
      title="No agent carries this tunnel. Move it to an agent to bring it back."
    >
      unassigned
    </span>
  );
}

// --- Tunnel Table (desktop) ---

function TunnelTable({ tunnels, onDelete, onToggle, onEdit }) {
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
              Agent
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Access
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Body limit
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
                <td className="py-3 px-4">
                  <CarrierBadge tunnel={tunnel} />
                </td>
                <td className="py-3 px-4 text-sm">
                  {tunnel.type !== 'panel' && (
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs ${
                        tunnel.accessMode === 'public'
                          ? 'bg-green-500/10 text-green-400'
                          : tunnel.accessMode === 'authenticated'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-orange-500/10 text-orange-400'
                      }`}
                    >
                      {tunnel.accessMode === 'public'
                        ? 'Public'
                        : tunnel.accessMode === 'authenticated'
                          ? 'All Users'
                          : 'Restricted'}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-sm text-zinc-400 font-mono">
                  {tunnel.type !== 'panel' ? `${effectiveMaxBody(tunnel)} MiB` : '\u2014'}
                </td>
                <td className="py-3 px-4 text-sm text-zinc-400">
                  {tunnel.description || '\u2014'}
                </td>
                <td className="py-3 px-4 text-sm text-zinc-500">
                  {relativeTime(tunnel.createdAt)}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="inline-flex items-center gap-2">
                    {tunnel.type !== 'panel' && (
                      <button
                        type="button"
                        onClick={() => onEdit(tunnel)}
                        className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
                        title="Agent, access mode, body limit"
                      >
                        <Settings2 size={12} />
                        Edit
                      </button>
                    )}
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

function TunnelCards({ tunnels, onDelete, onToggle, onEdit }) {
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
                {tunnel.type !== 'panel' && (
                  <button
                    type="button"
                    onClick={() => onEdit(tunnel)}
                    className="text-xs text-zinc-300"
                    title="Agent, access mode, body limit"
                  >
                    <Settings2 size={14} />
                  </button>
                )}
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
              <span>
                Agent: <CarrierBadge tunnel={tunnel} />
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

// --- Main Page ---

export default function Tunnels() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

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
      addToast(errorMessage(err), 'error');
      setDeleteTarget(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }) => client.updateTunnel(id, { enabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
      const t = data.tunnel;
      addToast(`Tunnel ${t.fqdn} ${t.enabled ? 'enabled' : 'disabled'}`);
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, changes }) => client.updateTunnel(id, changes),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
      addToast(`Tunnel ${data.tunnel.fqdn} updated`);
      setEditTarget(null);
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
      setEditTarget(null);
    },
  });

  const handleEdit = useCallback((tunnel) => {
    setEditTarget(tunnel);
  }, []);

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
          <TunnelTable
            tunnels={tunnels}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onEdit={handleEdit}
          />
          <TunnelCards
            tunnels={tunnels}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onEdit={handleEdit}
          />
        </>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <EditTunnelDialog
          tunnel={editTarget}
          onConfirm={(changes) => editMutation.mutate({ id: editTarget.id, changes })}
          onCancel={() => setEditTarget(null)}
          isPending={editMutation.isPending}
        />
      )}

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
