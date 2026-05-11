import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errorMessage.js';
import {
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  FileText,
  FolderOpen,
  Globe,
  CheckCircle,
  Clock,
  AlertTriangle,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import FileBrowser from '../components/FileBrowser.jsx';

// --- Helpers ---

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 30) return new Date(dateStr).toLocaleDateString();
  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function StatusBadge({ site }) {
  if (site.certIssued && site.dnsVerified) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-green-400 bg-green-500/10 border-green-500/20">
        <CheckCircle size={10} />
        Live
      </span>
    );
  }
  if (site.type === 'custom' && !site.dnsVerified) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-yellow-400 bg-yellow-500/10 border-yellow-500/20">
        <Clock size={10} />
        DNS Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-zinc-500 bg-zinc-800 border-zinc-700">
      <AlertTriangle size={10} />
      Setup Required
    </span>
  );
}

function TypeBadge({ type }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${
        type === 'managed'
          ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
          : 'text-purple-400 bg-purple-500/10 border-purple-500/20'
      }`}
    >
      {type}
    </span>
  );
}

// --- Add Site Form ---

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function AddSiteForm({ domain, onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();
  const client = useAdminClient();

  const [name, setName] = useState('');
  const [type, setType] = useState('managed');
  const [customDomain, setCustomDomain] = useState('');
  const [spaMode, setSpaMode] = useState(false);
  const [autheliaProtected, setAutheliaProtected] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);

  const mutation = useMutation({
    mutationFn: (data) => client.createSite(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      addToast(`Site ${data.site.fqdn} created`);
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
      const newErrors = {};

      if (!name) {
        newErrors.name = 'Name is required';
      } else if (!NAME_REGEX.test(name)) {
        newErrors.name = 'Lowercase letters, numbers, and hyphens only';
      }

      if (type === 'custom' && !customDomain) {
        newErrors.customDomain = 'Domain is required for custom sites';
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      setErrors({});
      const body = {
        name,
        type,
        spaMode,
        autheliaProtected,
      };
      if (type === 'custom') {
        body.customDomain = customDomain.toLowerCase();
      }
      mutation.mutate(body);
    },
    [name, type, customDomain, spaMode, autheliaProtected, mutation],
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-6">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
        <Plus size={14} className="text-cyan-400" />
        Add Static Site
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type toggle */}
        <div>
          <label className="block text-xs text-zinc-400 mb-2">Domain Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('managed')}
              className={`px-3 py-1.5 text-sm rounded border ${
                type === 'managed'
                  ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10'
                  : 'border-zinc-700 text-zinc-400 bg-zinc-800 hover:border-zinc-600'
              }`}
            >
              Managed Subdomain
            </button>
            <button
              type="button"
              onClick={() => setType('custom')}
              className={`px-3 py-1.5 text-sm rounded border ${
                type === 'custom'
                  ? 'border-cyan-400 text-cyan-400 bg-cyan-500/10'
                  : 'border-zinc-700 text-zinc-400 bg-zinc-800 hover:border-zinc-600'
              }`}
            >
              Custom Domain
            </button>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Name</label>
          <div className="flex items-center gap-0">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value.toLowerCase());
                setErrors((prev) => ({ ...prev, name: undefined }));
              }}
              disabled={mutation.isPending}
              placeholder="blog"
              className={`flex-1 ${type === 'managed' ? 'rounded-l' : 'rounded'} bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50`}
            />
            {type === 'managed' && (
              <span className="rounded-r bg-zinc-800/60 border border-l-0 border-zinc-700 px-3 py-2 text-sm text-zinc-500 font-mono">
                .{domain}
              </span>
            )}
          </div>
          {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
        </div>

        {/* Custom Domain */}
        {type === 'custom' && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Custom Domain</label>
            <input
              type="text"
              value={customDomain}
              onChange={(e) => {
                setCustomDomain(e.target.value.toLowerCase());
                setErrors((prev) => ({ ...prev, customDomain: undefined }));
              }}
              disabled={mutation.isPending}
              placeholder="example.com"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
            />
            {errors.customDomain && (
              <p className="text-red-400 text-xs mt-1">{errors.customDomain}</p>
            )}
          </div>
        )}

        {/* Options */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={spaMode}
              onChange={(e) => setSpaMode(e.target.checked)}
              disabled={mutation.isPending}
              className="rounded border-zinc-700 bg-zinc-800 text-cyan-400 focus:ring-cyan-400"
            />
            SPA Mode
            <span className="text-zinc-600 text-xs">(fallback to index.html)</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autheliaProtected}
              onChange={(e) => setAutheliaProtected(e.target.checked)}
              disabled={mutation.isPending}
              className="rounded border-zinc-700 bg-zinc-800 text-cyan-400 focus:ring-cyan-400"
            />
            Authelia Protected
            <span className="text-zinc-600 text-xs">(require login)</span>
          </label>
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
                Creating site...
              </>
            ) : (
              <>
                <Plus size={14} />
                Create Site
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

// --- DNS Verification Modal ---

function DnsVerificationModal({ site, onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();
  const client = useAdminClient();
  const [result, setResult] = useState(null);

  const mutation = useMutation({
    mutationFn: () => client.verifySiteDns(site.id),
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ['sites'] });
        addToast('DNS verified and site is now live!');
      }
    },
    onError: (err) => {
      setResult({ ok: false, message: errorMessage(err) });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-lg w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-2">DNS Verification</h3>
        <p className="text-zinc-400 text-sm mb-4">
          Add an A record pointing <span className="text-cyan-400 font-mono">{site.fqdn}</span> to
          your server IP.
        </p>

        <div className="bg-zinc-800 rounded-lg p-4 mb-4">
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="text-zinc-500 py-1 pr-4">Type</td>
                <td className="text-zinc-200 font-mono">A</td>
              </tr>
              <tr>
                <td className="text-zinc-500 py-1 pr-4">Name</td>
                <td className="text-zinc-200 font-mono">{site.fqdn}</td>
              </tr>
              <tr>
                <td className="text-zinc-500 py-1 pr-4">Value</td>
                <td className="text-zinc-200 font-mono">(your server IP)</td>
              </tr>
            </tbody>
          </table>
        </div>

        {result && (
          <div
            className={`rounded px-3 py-2 text-sm mb-4 ${
              result.ok
                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
            }`}
          >
            {result.message}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
          >
            {result?.ok ? 'Done' : 'Cancel'}
          </button>
          {!result?.ok && (
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify DNS'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Delete Confirmation ---

function DeleteConfirmation({ site, onConfirm, onCancel, isPending }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-2">Delete Site</h3>
        <p className="text-zinc-400 text-sm mb-6">
          Are you sure you want to delete{' '}
          <span className="text-cyan-400 font-mono">{site.fqdn}</span>? This will remove all files,
          the nginx configuration, and certificate mapping.
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

// --- Site Settings Modal ---

function SiteSettingsModal({ site, onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();
  const client = useAdminClient();

  const [spaMode, setSpaMode] = useState(site.spaMode);
  const [autheliaProtected, setAutheliaProtected] = useState(site.autheliaProtected);
  const [allowedUsers, setAllowedUsers] = useState(site.allowedUsers || []);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => client.getUsers(),
  });

  const mutation = useMutation({
    mutationFn: (body) => client.updateSite(site.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      addToast(`Site ${site.fqdn} settings updated`);
      onClose();
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
    },
  });

  const origAllowedUsers = site.allowedUsers || [];
  const hasChanges =
    spaMode !== site.spaMode ||
    autheliaProtected !== site.autheliaProtected ||
    JSON.stringify(allowedUsers.slice().sort()) !== JSON.stringify(origAllowedUsers.slice().sort());

  const availableUsers = (usersQuery.data?.users || []).filter(
    (u) => !allowedUsers.includes(u.username),
  );

  const addUser = (username) => {
    setAllowedUsers((prev) => [...prev, username]);
  };

  const removeUser = (username) => {
    setAllowedUsers((prev) => prev.filter((u) => u !== username));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-1">Site Settings</h3>
        <p className="text-zinc-500 text-sm mb-5 font-mono">{site.fqdn}</p>

        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <span className="text-sm text-zinc-200">SPA Mode</span>
              <p className="text-xs text-zinc-500 mt-0.5">
                Fallback to index.html for client-side routing
              </p>
            </div>
            <input
              type="checkbox"
              checked={spaMode}
              onChange={(e) => setSpaMode(e.target.checked)}
              disabled={mutation.isPending}
              className="rounded border-zinc-700 bg-zinc-800 text-cyan-400 focus:ring-cyan-400 h-5 w-5"
            />
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <span className="text-sm text-zinc-200">Authelia Protected</span>
              <p className="text-xs text-zinc-500 mt-0.5">Require login to access this site</p>
            </div>
            <input
              type="checkbox"
              checked={autheliaProtected}
              onChange={(e) => setAutheliaProtected(e.target.checked)}
              disabled={mutation.isPending}
              className="rounded border-zinc-700 bg-zinc-800 text-cyan-400 focus:ring-cyan-400 h-5 w-5"
            />
          </label>

          {/* User access control — only visible when Authelia is enabled */}
          {autheliaProtected && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Shield size={14} className="text-cyan-400" />
                <span className="text-sm text-zinc-200">Allowed Users</span>
              </div>
              <p className="text-xs text-zinc-500 mb-3">
                {allowedUsers.length === 0
                  ? 'All authenticated users can access this site.'
                  : 'Only the selected users can access this site.'}
              </p>

              {/* Current allowed users */}
              {allowedUsers.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {allowedUsers.map((username) => (
                    <span
                      key={username}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-cyan-400"
                    >
                      {username}
                      <button
                        type="button"
                        onClick={() => removeUser(username)}
                        disabled={mutation.isPending}
                        className="hover:text-red-400"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add user dropdown */}
              {availableUsers.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      addUser(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  disabled={mutation.isPending}
                  className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                >
                  <option value="">Add user...</option>
                  {availableUsers.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.username} ({u.displayname})
                    </option>
                  ))}
                </select>
              )}

              {usersQuery.isLoading && <p className="text-xs text-zinc-500">Loading users...</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate({ spaMode, autheliaProtected, allowedUsers })}
            disabled={mutation.isPending || !hasChanges}
            className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Site Table (desktop) ---

function SiteTable({ sites, onDelete, onFiles, onVerifyDns, onSettings }) {
  return (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-700">
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Name
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Domain
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Type
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Status
            </th>
            <th className="text-left text-zinc-400 text-xs uppercase font-semibold py-3 px-4">
              Size
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
          {sites.map((site) => (
            <tr key={site.id} className="border-b border-zinc-700 bg-zinc-800/50">
              <td className="py-3 px-4 text-sm text-zinc-200 font-mono">{site.name}</td>
              <td className="py-3 px-4 text-sm">
                {site.certIssued ? (
                  <a
                    href={`https://${site.fqdn}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"
                  >
                    {site.fqdn}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="text-zinc-400 font-mono">{site.fqdn}</span>
                )}
              </td>
              <td className="py-3 px-4">
                <TypeBadge type={site.type} />
              </td>
              <td className="py-3 px-4">
                <StatusBadge site={site} />
              </td>
              <td className="py-3 px-4 text-sm text-zinc-400 font-mono">
                {formatBytes(site.totalSize || 0)}
              </td>
              <td className="py-3 px-4 text-sm text-zinc-500">{relativeTime(site.createdAt)}</td>
              <td className="py-3 px-4 text-right">
                <div className="flex items-center justify-end gap-2">
                  {site.type === 'custom' && !site.dnsVerified && (
                    <button
                      type="button"
                      onClick={() => onVerifyDns(site)}
                      className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-yellow-400 hover:bg-yellow-600/20 hover:text-yellow-300"
                    >
                      <Globe size={12} />
                      Verify DNS
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onSettings(site)}
                    className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-600 hover:text-zinc-300"
                  >
                    <Settings size={12} />
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => onFiles(site)}
                    className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-cyan-400 hover:bg-cyan-600/20 hover:text-cyan-300"
                  >
                    <FolderOpen size={12} />
                    Files
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(site)}
                    className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-600/20 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Site Cards (mobile) ---

function SiteCards({ sites, onDelete, onFiles, onVerifyDns, onSettings }) {
  return (
    <div className="md:hidden space-y-3">
      {sites.map((site) => (
        <div key={site.id} className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-zinc-200 font-mono">{site.name}</span>
            <div className="flex items-center gap-2">
              <TypeBadge type={site.type} />
              <StatusBadge site={site} />
            </div>
          </div>
          {site.certIssued ? (
            <a
              href={`https://${site.fqdn}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 text-sm inline-flex items-center gap-1 mb-1"
            >
              {site.fqdn}
              <ExternalLink size={12} />
            </a>
          ) : (
            <span className="text-zinc-400 text-sm font-mono">{site.fqdn}</span>
          )}
          <div className="flex items-center gap-4 text-xs text-zinc-500 mt-2">
            <span>{formatBytes(site.totalSize || 0)}</span>
            <span>{relativeTime(site.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {site.type === 'custom' && !site.dnsVerified && (
              <button
                type="button"
                onClick={() => onVerifyDns(site)}
                className="inline-flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300"
              >
                <Globe size={12} />
                Verify DNS
              </button>
            )}
            <button
              type="button"
              onClick={() => onSettings(site)}
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
            >
              <Settings size={12} />
              Settings
            </button>
            <button
              type="button"
              onClick={() => onFiles(site)}
              className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
            >
              <FolderOpen size={12} />
              Files
            </button>
            <button
              type="button"
              onClick={() => onDelete(site)}
              className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Main Page ---

export default function Sites({ domain }) {
  const queryClient = useQueryClient();
  const addToast = useToast();
  const client = useAdminClient();

  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [fileBrowserSite, setFileBrowserSite] = useState(null);
  const [dnsVerifySite, setDnsVerifySite] = useState(null);
  const [settingsSite, setSettingsSite] = useState(null);

  const sitesQuery = useQuery({
    queryKey: ['sites'],
    queryFn: () => client.getSites(),
    refetchInterval: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => client.deleteSite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      addToast(`Site ${deleteTarget.fqdn} deleted`);
      setDeleteTarget(null);
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
      setDeleteTarget(null);
    },
  });

  const handleDelete = useCallback((site) => setDeleteTarget(site), []);
  const handleFiles = useCallback((site) => setFileBrowserSite(site), []);
  const handleVerifyDns = useCallback((site) => setDnsVerifySite(site), []);
  const handleSettings = useCallback((site) => setSettingsSite(site), []);

  const confirmDelete = useCallback(() => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
    }
  }, [deleteTarget, deleteMutation]);

  const sites = sitesQuery.data?.sites || [];

  // If file browser is open, show it instead of the sites list
  if (fileBrowserSite) {
    return <FileBrowser site={fileBrowserSite} onBack={() => setFileBrowserSite(null)} />;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Static Sites</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Host static websites, landing pages, and SPAs
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Plus size={14} />
            Add Site
          </button>
        )}
      </div>

      {/* Add Site Form */}
      {showForm && domain && <AddSiteForm domain={domain} onClose={() => setShowForm(false)} />}

      {/* Sites List */}
      {sitesQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
            />
          ))}
        </div>
      ) : sitesQuery.isError ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
          <p className="text-red-400 text-sm">Failed to load sites</p>
        </div>
      ) : sites.length === 0 ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-12 text-center">
          <FileText size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">
            No static sites yet. Create your first site to get started.
          </p>
        </div>
      ) : (
        <>
          <SiteTable
            sites={sites}
            onDelete={handleDelete}
            onFiles={handleFiles}
            onVerifyDns={handleVerifyDns}
            onSettings={handleSettings}
          />
          <SiteCards
            sites={sites}
            onDelete={handleDelete}
            onFiles={handleFiles}
            onVerifyDns={handleVerifyDns}
            onSettings={handleSettings}
          />
        </>
      )}

      {/* DNS Verification Modal */}
      {dnsVerifySite && (
        <DnsVerificationModal site={dnsVerifySite} onClose={() => setDnsVerifySite(null)} />
      )}

      {/* Site Settings Modal */}
      {settingsSite && (
        <SiteSettingsModal site={settingsSite} onClose={() => setSettingsSite(null)} />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteConfirmation
          site={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
