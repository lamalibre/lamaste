import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  RefreshCw,
  Download,
  AlertTriangle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Plus,
  Trash2,
  Key,
  Settings,
  Globe,
} from 'lucide-react';
import { useToast } from '../../components/Toast.jsx';

// --- API helpers ---

async function fetchCerts() {
  const res = await fetch('/api/certs');
  if (!res.ok) throw new Error('Failed to fetch certificates');
  return res.json();
}

async function fetchAutoRenewStatus() {
  const res = await fetch('/api/certs/auto-renew-status');
  if (!res.ok) throw new Error('Failed to fetch auto-renew status');
  return res.json();
}

async function renewCert(domain) {
  const res = await fetch(`/api/certs/${domain}/renew`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details || data.error || 'Renewal failed');
  return data;
}

async function rotateMtls() {
  const res = await fetch('/api/certs/mtls/rotate', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Rotation failed');
  return data;
}

// --- Agent certificate API helpers ---

async function fetchAgentCerts() {
  const res = await fetch('/api/certs/agent');
  if (!res.ok) throw new Error('Failed to fetch agent certificates');
  return res.json();
}

async function generateAgentCert({ label, capabilities, allowedSites }) {
  const res = await fetch('/api/certs/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, capabilities, allowedSites }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to generate agent certificate');
  return data;
}

async function updateAgentCaps(label, capabilities) {
  const res = await fetch(`/api/certs/agent/${encodeURIComponent(label)}/capabilities`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update capabilities');
  return data;
}

async function updateAgentAllowedSites(label, allowedSites) {
  const res = await fetch(`/api/certs/agent/${encodeURIComponent(label)}/allowed-sites`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowedSites }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update allowed sites');
  return data;
}

async function revokeAgentCert(label) {
  const res = await fetch(`/api/certs/agent/${encodeURIComponent(label)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to revoke agent certificate');
  return data;
}

async function downloadAgentP12(label) {
  const res = await fetch(`/api/certs/agent/${encodeURIComponent(label)}/download`);
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label}.p12`;
  a.click();
  URL.revokeObjectURL(url);
}

async function generateEnrollmentToken({ label, capabilities, allowedSites }) {
  const res = await fetch('/api/certs/agent/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, capabilities, allowedSites }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to generate enrollment token');
  return data;
}

async function fetchAdminAuthMode() {
  const res = await fetch('/api/certs/admin/auth-mode');
  if (!res.ok) return { adminAuthMode: 'p12' };
  return res.json();
}

// --- Sub-components ---

function TypeBadge({ type }) {
  const styles = {
    letsencrypt: 'bg-blue-500/20 text-blue-400',
    'mtls-ca': 'bg-purple-500/20 text-purple-400',
    'mtls-client': 'bg-purple-500/20 text-purple-400',
  };
  const labels = {
    letsencrypt: "Let's Encrypt",
    'mtls-ca': 'mTLS CA',
    'mtls-client': 'mTLS Client',
  };

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${styles[type] || 'bg-zinc-500/20 text-zinc-400'}`}
    >
      {labels[type] || type}
    </span>
  );
}

function DaysIndicator({ days }) {
  let colorClass = 'text-green-400';
  let dotClass = 'bg-green-400';

  if (days <= 7) {
    colorClass = 'text-red-400';
    dotClass = 'bg-red-400';
  } else if (days <= 30) {
    colorClass = 'text-amber-400';
    dotClass = 'bg-amber-400';
  }

  return (
    <span className={`flex items-center gap-1.5 ${colorClass}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      {days}d
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function AutoRenewStatus({ data, isLoading }) {
  if (isLoading) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={14} className="animate-spin" />
        Checking auto-renewal status...
      </div>
    );
  }

  if (!data) return null;

  if (data.active) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
          Auto-renewal active
        </span>
        {data.nextRun && <span>Next run: {formatDate(data.nextRun)}</span>}
        {data.lastRun && <span>Last renewed: {formatDate(data.lastRun)}</span>}
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-1.5 text-sm text-amber-400">
      <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
      Auto-renewal is not active. Certificates may expire.
    </div>
  );
}

function CertTable({ certs, onRenew, renewingDomain }) {
  const leCerts = certs.filter((c) => c.type === 'letsencrypt');

  if (leCerts.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
        <p className="text-zinc-500 text-sm text-center">
          No Let&apos;s Encrypt certificates found.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-700 bg-zinc-900">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
              Type
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
              Domain
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
              Expiry Date
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
              Days Remaining
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {leCerts.map((cert) => (
            <tr key={cert.domain || cert.path} className="border-b border-zinc-700 bg-zinc-800">
              <td className="px-4 py-3">
                <TypeBadge type={cert.type} />
              </td>
              <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{cert.domain || 'N/A'}</td>
              <td className="px-4 py-3 text-zinc-400">{formatDate(cert.expiresAt)}</td>
              <td className="px-4 py-3">
                <DaysIndicator days={cert.daysUntilExpiry} />
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  disabled={!!renewingDomain}
                  onClick={() => onRenew(cert.domain)}
                  className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {renewingDomain === cert.domain ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Renewing...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={12} />
                      Renew
                    </>
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MtlsSection({ certs, onRotate, adminAuthMode }) {
  const caCert = certs.find((c) => c.type === 'mtls-ca');
  const clientCert = certs.find((c) => c.type === 'mtls-client');
  const isHardwareBound = adminAuthMode === 'hardware-bound';

  if (!caCert && !clientCert) return null;

  return (
    <div className="mt-8">
      <div className="border-t border-zinc-700 pt-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <ShieldCheck size={18} className="text-purple-400" />
          mTLS Certificates
          {isHardwareBound && (
            <span className="text-xs px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
              hardware-bound
            </span>
          )}
        </h2>

        <div className="space-y-4">
          {caCert && (
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type="mtls-ca" />
                    <span className="text-white font-semibold text-sm">Certificate Authority</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-zinc-400 mt-2">
                    <span>Expires: {formatDate(caCert.expiresAt)}</span>
                    <DaysIndicator days={caCert.daysUntilExpiry} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-zinc-500 mt-3">
                The CA certificate cannot be rotated. It was created during initial setup.
              </p>
            </div>
          )}

          {clientCert && (
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type="mtls-client" />
                    <span className="text-white font-semibold text-sm">Client Certificate</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-zinc-400 mt-2">
                    <span>Expires: {formatDate(clientCert.expiresAt)}</span>
                    <DaysIndicator days={clientCert.daysUntilExpiry} />
                  </div>
                </div>
                {!isHardwareBound && (
                  <button
                    type="button"
                    onClick={onRotate}
                    className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500"
                  >
                    <RefreshCw size={12} />
                    Rotate
                  </button>
                )}
              </div>
              {isHardwareBound && (
                <p className="text-xs text-emerald-400/70 mt-3">
                  Admin uses a hardware-bound certificate. P12 download and rotation are disabled.
                  To revert, run <code className="bg-zinc-800 px-1 py-0.5 rounded">sudo portlama-reset-admin</code> on the server.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentStatusBadge({ status }) {
  const styles = {
    active: 'text-green-400 bg-green-500/10 border-green-500/20',
    'expiring-soon': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    revoked: 'text-red-400 bg-red-500/10 border-red-500/20',
  };
  const labels = {
    active: 'active',
    'expiring-soon': 'expiring soon',
    revoked: 'revoked',
  };

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${styles[status] || 'text-zinc-500 bg-zinc-800 border-zinc-700'}`}
    >
      {labels[status] || status}
    </span>
  );
}

function EnrollmentMethodBadge({ method }) {
  if (method === 'hardware-bound') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
        hardware-bound
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border text-zinc-500 bg-zinc-800 border-zinc-700">
      p12
    </span>
  );
}

const CAPABILITY_OPTIONS = [
  {
    value: 'tunnels:read',
    label: 'tunnels:read',
    description: 'List tunnels and download plist',
    mandatory: true,
  },
  { value: 'tunnels:write', label: 'tunnels:write', description: 'Create and delete tunnels' },
  { value: 'services:read', label: 'services:read', description: 'View service status' },
  { value: 'services:write', label: 'services:write', description: 'Start/stop/restart services' },
  { value: 'system:read', label: 'system:read', description: 'View system stats (CPU, RAM, disk)' },
  { value: 'sites:read', label: 'sites:read', description: 'List sites and browse files' },
  {
    value: 'sites:write',
    label: 'sites:write',
    description: 'Create, delete, and deploy to sites',
  },
];

function CapabilityCheckboxes({ capabilities, onChange, disabled }) {
  const toggle = (cap) => {
    if (cap === 'tunnels:read') return;
    if (capabilities.includes(cap)) {
      onChange(capabilities.filter((c) => c !== cap));
    } else {
      onChange([...capabilities, cap]);
    }
  };

  return (
    <div className="space-y-2">
      {CAPABILITY_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer ${
            capabilities.includes(opt.value)
              ? 'border-cyan-500/30 bg-cyan-500/5'
              : 'border-zinc-700 bg-zinc-800/50'
          } ${opt.mandatory || disabled ? 'opacity-80' : ''}`}
        >
          <input
            type="checkbox"
            checked={capabilities.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            disabled={opt.mandatory || disabled}
            className="mt-0.5 accent-cyan-500"
          />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-mono text-zinc-200">{opt.label}</span>
            <p className="text-xs text-zinc-500">{opt.description}</p>
          </div>
        </label>
      ))}
    </div>
  );
}

function AgentGenerateModal({ onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [label, setLabel] = useState('');
  const [capabilities, setCapabilities] = useState(['tunnels:read']);
  const [allowedSites, setAllowedSites] = useState([]);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetch('/api/sites').then((r) => r.json()),
  });

  const generateMutation = useMutation({
    mutationFn: generateAgentCert,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleGenerate = useCallback(
    (e) => {
      e.preventDefault();
      setError(null);
      if (!label.trim()) {
        setError('Label is required');
        return;
      }
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(label)) {
        setError(
          'Lowercase letters, numbers, and hyphens only. Cannot start or end with a hyphen.',
        );
        return;
      }
      generateMutation.mutate({ label, capabilities, allowedSites });
    },
    [label, capabilities, allowedSites, generateMutation],
  );

  const handleCopyPassword = useCallback(async () => {
    if (!result?.p12Password) return;
    try {
      await navigator.clipboard.writeText(result.p12Password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy — please select and copy manually', 'error');
    }
  }, [result, addToast]);

  const handleDownload = useCallback(() => {
    if (result?.label) {
      downloadAgentP12(result.label);
    }
  }, [result]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Key size={20} className="text-cyan-400" />
            {result ? 'Certificate Generated' : 'Generate Agent Certificate'}
          </h3>
          {!generateMutation.isPending && (
            <button
              type="button"
              onClick={handleClose}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {!result ? (
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value.toLowerCase());
                    setError(null);
                  }}
                  disabled={generateMutation.isPending}
                  placeholder="e.g. macbook-pro"
                  className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                />
                <p className="text-xs text-zinc-500 mt-1">
                  Lowercase letters, numbers, and hyphens only.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Capabilities</label>
                <CapabilityCheckboxes
                  capabilities={capabilities}
                  onChange={setCapabilities}
                  disabled={generateMutation.isPending}
                />
              </div>

              {(capabilities.includes('sites:read') || capabilities.includes('sites:write')) && (
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Site Access
                  </label>
                  <p className="text-xs text-zinc-500 mb-2">
                    Select which static sites this agent can manage files for.
                  </p>
                  {sitesData?.sites?.length > 0 ? (
                    <div className="space-y-1">
                      {sitesData.sites.map((site) => (
                        <label
                          key={site.id}
                          className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={allowedSites.includes(site.name)}
                            onChange={() => {
                              setAllowedSites((prev) =>
                                prev.includes(site.name)
                                  ? prev.filter((s) => s !== site.name)
                                  : [...prev, site.name],
                              );
                            }}
                            disabled={generateMutation.isPending}
                            className="rounded border-zinc-600 bg-zinc-800 text-cyan-400 focus:ring-cyan-400"
                          />
                          <span className="font-mono">{site.name}</span>
                          <span className="text-zinc-500 text-xs">({site.fqdn})</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">No sites created yet.</p>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3 justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={generateMutation.isPending}
                  className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generateMutation.isPending}
                  className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Key size={14} />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              {/* Password */}
              <div>
                <label className="text-sm font-medium text-zinc-300 block mb-2">
                  Certificate Password:
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-yellow-400 text-sm break-all select-all">
                    {result.p12Password}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="rounded bg-zinc-700 p-2 text-zinc-300 hover:bg-zinc-600 shrink-0"
                    title="Copy password"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Warning */}
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-400 space-y-1">
                <p className="font-semibold">Save this password — it cannot be retrieved later.</p>
                <p>Share the .p12 file and password securely with the Mac user.</p>
              </div>

              {/* Download */}
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded bg-cyan-600 py-3 px-6 text-sm font-semibold text-white hover:bg-cyan-500"
              >
                <Download size={16} />
                Download {result.label}.p12
              </button>

              {/* Done */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentRevokeConfirmation({ label, onConfirm, onCancel, isPending }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-lg font-semibold text-white mb-2">Revoke Certificate</h3>
        <p className="text-zinc-400 text-sm mb-6">
          Revoke certificate for &lsquo;<span className="text-cyan-400 font-mono">{label}</span>
          &rsquo;? The Mac agent using this certificate will immediately lose access.
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
                Revoking...
              </>
            ) : (
              'Revoke'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentEditCapsModal({ agent, onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [capabilities, setCapabilities] = useState(agent.capabilities || ['tunnels:read']);

  const updateMutation = useMutation({
    mutationFn: (caps) => updateAgentCaps(agent.label, caps),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
      addToast(`Capabilities updated for ${agent.label}`);
      onClose();
    },
    onError: (err) => {
      addToast(err.message, 'error');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Settings size={20} className="text-cyan-400" />
            Capabilities — {agent.label}
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <CapabilityCheckboxes
            capabilities={capabilities}
            onChange={setCapabilities}
            disabled={updateMutation.isPending}
          />
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={updateMutation.isPending}
              className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => updateMutation.mutate(capabilities)}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {updateMutation.isPending ? (
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
    </div>
  );
}

function AgentEditSitesModal({ agent, onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [selectedSites, setSelectedSites] = useState(agent.allowedSites || []);

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetch('/api/sites').then((r) => r.json()),
  });

  const updateMutation = useMutation({
    mutationFn: (sites) => updateAgentAllowedSites(agent.label, sites),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
      addToast(`Allowed sites updated for ${agent.label}`);
      onClose();
    },
    onError: (err) => {
      addToast(err.message, 'error');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Globe size={20} className="text-cyan-400" />
            Site Access — {agent.label}
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-zinc-500">
            Select which static sites this agent can manage files for.
          </p>
          {sitesData?.sites?.length > 0 ? (
            <div className="space-y-1">
              {sitesData.sites.map((site) => (
                <label
                  key={site.id}
                  className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSites.includes(site.name)}
                    onChange={() => {
                      setSelectedSites((prev) =>
                        prev.includes(site.name)
                          ? prev.filter((s) => s !== site.name)
                          : [...prev, site.name],
                      );
                    }}
                    disabled={updateMutation.isPending}
                    className="rounded border-zinc-600 bg-zinc-800 text-cyan-400 focus:ring-cyan-400"
                  />
                  <span className="font-mono">{site.name}</span>
                  <span className="text-zinc-500 text-xs">({site.fqdn})</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No sites created yet.</p>
          )}
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={updateMutation.isPending}
              className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => updateMutation.mutate(selectedSites)}
              disabled={updateMutation.isPending}
              className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {updateMutation.isPending ? (
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
    </div>
  );
}

function AgentEnrollTokenModal({ onClose }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [capabilities, setCapabilities] = useState(['tunnels:read']);
  const [allowedSites, setAllowedSites] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetch('/api/sites').then((r) => r.json()),
  });

  const enrollMutation = useMutation({
    mutationFn: generateEnrollmentToken,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const isValidLabel = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label);

  const handleGenerate = () => {
    setError(null);
    enrollMutation.mutate({ label, capabilities, allowedSites });
  };

  const handleCopyToken = async () => {
    if (result?.token) {
      try {
        await navigator.clipboard.writeText(result.token);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard API may fail if page is not focused
      }
    }
  };

  const setupCommand = result
    ? `npx @lamalibre/portlama-agent setup --token ${result.token} --panel-url <PANEL_URL>`
    : '';

  const handleCopyCmd = async () => {
    try {
      await navigator.clipboard.writeText(setupCommand);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      // Clipboard API may fail if page is not focused
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-lg rounded-xl bg-zinc-900 border border-zinc-700 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            {result ? 'Enrollment Token' : 'Generate Enrollment Token'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {!result ? (
          <>
            <p className="text-sm text-zinc-400 mb-4">
              Generate a one-time token for hardware-bound agent enrollment.
              The agent will generate a non-exportable keypair in macOS Keychain.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Agent Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value.toLowerCase())}
                  placeholder="e.g. macbook-pro"
                  className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <CapabilityCheckboxes capabilities={capabilities} onChange={setCapabilities} />

              {(capabilities.includes('sites:read') || capabilities.includes('sites:write')) &&
                sitesData?.sites?.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-300 mb-2">
                      Allowed Sites
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {sitesData.sites.map((site) => (
                        <label key={site.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={allowedSites.includes(site.name)}
                            onChange={() =>
                              setAllowedSites((prev) =>
                                prev.includes(site.name)
                                  ? prev.filter((s) => s !== site.name)
                                  : [...prev, site.name],
                              )
                            }
                            className="accent-cyan-500"
                          />
                          <span className="text-zinc-300">{site.name}</span>
                          {site.fqdn && (
                            <span className="text-zinc-500 text-xs">{site.fqdn}</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

              {error && (
                <div className="rounded bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!isValidLabel || enrollMutation.isPending}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {enrollMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin inline mr-1" />
                ) : null}
                Generate Token
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Agent Label
                </label>
                <p className="text-sm text-cyan-400 font-mono">{result.label}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Enrollment Token
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 block rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-yellow-300 font-mono break-all">
                    {result.token}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyToken}
                    className="rounded bg-zinc-700 p-2 text-zinc-300 hover:bg-zinc-600"
                    title="Copy token"
                  >
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Expires
                </label>
                <p className="text-sm text-zinc-400">
                  {new Date(result.expiresAt).toLocaleString()} (10 minutes)
                </p>
              </div>

              <div className="rounded bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                <p className="text-sm text-amber-300">
                  This token is single-use and expires in 10 minutes. Copy and send it to the agent machine now.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Setup Command
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 block rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 font-mono break-all">
                    {setupCommand}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyCmd}
                    className="rounded bg-zinc-700 p-2 text-zinc-300 hover:bg-zinc-600"
                    title="Copy command"
                  >
                    {copiedCmd ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Replace &lt;PANEL_URL&gt; with your panel address (e.g. https://1.2.3.4:9292)
                </p>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AgentCertsSection() {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [editCapsTarget, setEditCapsTarget] = useState(null);
  const [editSitesTarget, setEditSitesTarget] = useState(null);

  const agentQuery = useQuery({
    queryKey: ['agent-certs'],
    queryFn: fetchAgentCerts,
    refetchInterval: 30000,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeAgentCert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
      addToast(`Certificate for ${revokeTarget} revoked`);
      setRevokeTarget(null);
    },
    onError: (err) => {
      addToast(err.message, 'error');
      setRevokeTarget(null);
    },
  });

  const handleRevoke = useCallback((label) => {
    setRevokeTarget(label);
  }, []);

  const confirmRevoke = useCallback(() => {
    if (revokeTarget) {
      revokeMutation.mutate(revokeTarget);
    }
  }, [revokeTarget, revokeMutation]);

  const certs = agentQuery.data?.agents || [];

  return (
    <div className="mt-8">
      <div className="border-t border-zinc-700 pt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Key size={18} className="text-cyan-400" />
            Agent Certificates
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEnrollModal(true)}
              className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              title="Generate a one-time token for hardware-bound enrollment"
            >
              <Key size={14} />
              Enrollment Token
            </button>
            <button
              type="button"
              onClick={() => setShowGenerateModal(true)}
              className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
              title="Generate a P12 certificate file"
            >
              <Plus size={14} />
              Generate P12
            </button>
          </div>
        </div>

        {agentQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
              />
            ))}
          </div>
        ) : agentQuery.isError ? (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
            <p className="text-red-400 text-sm">Failed to load agent certificates</p>
          </div>
        ) : certs.length === 0 ? (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
            <Key size={32} className="mx-auto text-zinc-600 mb-3" />
            <p className="text-zinc-400 text-sm">
              No agent certificates. Generate one to connect a Mac tunnel agent.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 bg-zinc-900">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Label
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Serial
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Expires
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Capabilities
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {certs.map((cert) => (
                  <tr key={cert.label} className="border-b border-zinc-700 bg-zinc-800">
                    <td className="px-4 py-3 text-zinc-200 font-semibold">{cert.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                      {cert.serial ? cert.serial.slice(0, 16) : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(cert.createdAt)}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(cert.expiresAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(cert.capabilities || ['tunnels:read']).map((cap) => (
                          <span
                            key={cap}
                            className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 font-mono"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                      {cert.allowedSites?.length > 0 && (
                        <span className="text-xs text-zinc-500 mt-1 block">
                          Sites: {cert.allowedSites.join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <EnrollmentMethodBadge method={cert.enrollmentMethod} />
                    </td>
                    <td className="px-4 py-3">
                      <AgentStatusBadge status={cert.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {cert.status !== 'revoked' && (
                          <button
                            type="button"
                            onClick={() => setEditCapsTarget(cert)}
                            className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
                            title="Edit capabilities"
                          >
                            <Settings size={12} />
                          </button>
                        )}
                        {cert.status !== 'revoked' && (
                          <button
                            type="button"
                            onClick={() => setEditSitesTarget(cert)}
                            className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
                            title="Edit site access"
                          >
                            <Globe size={12} />
                          </button>
                        )}
                        {cert.status !== 'revoked' && cert.enrollmentMethod !== 'hardware-bound' && (
                          <button
                            type="button"
                            onClick={() => downloadAgentP12(cert.label)}
                            className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
                            title="Download .p12"
                          >
                            <Download size={12} />
                          </button>
                        )}
                        {cert.status !== 'revoked' && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(cert.label)}
                            className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-red-600/20 hover:text-red-400"
                            title="Revoke certificate"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Generate P12 modal */}
      {showGenerateModal && <AgentGenerateModal onClose={() => setShowGenerateModal(false)} />}

      {/* Generate Enrollment Token modal */}
      {showEnrollModal && <AgentEnrollTokenModal onClose={() => setShowEnrollModal(false)} />}

      {/* Revoke confirmation */}
      {revokeTarget && (
        <AgentRevokeConfirmation
          label={revokeTarget}
          onConfirm={confirmRevoke}
          onCancel={() => setRevokeTarget(null)}
          isPending={revokeMutation.isPending}
        />
      )}

      {/* Edit capabilities modal */}
      {editCapsTarget && (
        <AgentEditCapsModal agent={editCapsTarget} onClose={() => setEditCapsTarget(null)} />
      )}

      {/* Edit site access modal */}
      {editSitesTarget && (
        <AgentEditSitesModal agent={editSitesTarget} onClose={() => setEditSitesTarget(null)} />
      )}
    </div>
  );
}

function RotationModal({ onClose }) {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [stage, setStage] = useState('warning'); // warning | rotating | success | error
  const [rotationResult, setRotationResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);

  const rotateMutation = useMutation({
    mutationFn: rotateMtls,
    onSuccess: (data) => {
      setRotationResult(data);
      setStage('success');
      queryClient.invalidateQueries({ queryKey: ['certs'] });
    },
    onError: (err) => {
      setError(err.message);
      setStage('error');
    },
  });

  const handleConfirmRotate = useCallback(() => {
    setStage('rotating');
    rotateMutation.mutate();
  }, [rotateMutation]);

  const handleCopyPassword = useCallback(async () => {
    if (!rotationResult?.p12Password) return;
    try {
      await navigator.clipboard.writeText(rotationResult.p12Password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text for manual copy
      addToast('Failed to copy — please select and copy manually', 'error');
    }
  }, [rotationResult, addToast]);

  const handleDownload = useCallback(() => {
    window.open('/api/certs/mtls/download', '_blank');
  }, []);

  const handleDone = useCallback(() => {
    if (!confirmDone) {
      setConfirmDone(true);
      return;
    }
    onClose();
  }, [confirmDone, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            {stage === 'warning' && (
              <>
                <AlertTriangle size={20} className="text-amber-400" />
                Rotate Client Certificate
              </>
            )}
            {stage === 'rotating' && (
              <>
                <Loader2 size={20} className="animate-spin text-cyan-400" />
                Generating New Certificate...
              </>
            )}
            {stage === 'success' && (
              <>
                <ShieldCheck size={20} className="text-green-400" />
                New Certificate Ready
              </>
            )}
            {stage === 'error' && (
              <>
                <AlertTriangle size={20} className="text-red-400" />
                Rotation Failed
              </>
            )}
          </h3>
          {(stage === 'warning' || stage === 'error') && (
            <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Warning stage */}
          {stage === 'warning' && (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-400 space-y-2">
                <p className="font-semibold">
                  This will immediately invalidate your current browser certificate.
                </p>
                <p>
                  You <strong>MUST</strong> download and import the new certificate before closing
                  this page or your browser.
                </p>
                <p>
                  If you fail to do this, you will be locked out of the panel and will need SSH
                  access to recover.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  autoFocus
                  className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRotate}
                  className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500"
                >
                  I Understand, Rotate
                </button>
              </div>
            </div>
          )}

          {/* Rotating stage */}
          {stage === 'rotating' && (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-400 text-sm">Generating new certificate...</p>
            </div>
          )}

          {/* Success stage */}
          {stage === 'success' && rotationResult && (
            <div className="space-y-5">
              {/* Password */}
              <div>
                <label className="text-sm font-medium text-zinc-300 block mb-2">
                  Certificate Password (copy this first):
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-cyan-400 text-sm break-all select-all">
                    {rotationResult.p12Password}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="rounded bg-zinc-700 p-2 text-zinc-300 hover:bg-zinc-600 shrink-0"
                    title="Copy password"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              {/* Download */}
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded bg-cyan-600 py-3 px-6 text-sm font-semibold text-white hover:bg-cyan-500"
              >
                <Download size={16} />
                Download Certificate
              </button>

              {/* Instructions */}
              <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1.5 pl-1">
                <li>Copy the password above</li>
                <li>Click Download Certificate</li>
                <li>
                  Double-click the downloaded file to import it into your browser&apos;s keychain
                </li>
                <li>Enter the password when prompted</li>
                <li>Restart your browser to use the new certificate</li>
              </ol>

              {/* Recovery instructions (collapsible) */}
              <div className="border-t border-zinc-700 pt-4">
                <button
                  type="button"
                  onClick={() => setShowRecovery((prev) => !prev)}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-400"
                >
                  {showRecovery ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  Recovery instructions (if locked out)
                </button>
                {showRecovery && (
                  <div className="mt-3 rounded border border-zinc-700 bg-zinc-950 p-3">
                    <p className="text-xs text-zinc-400 mb-2">
                      If you get locked out, connect via SSH and run these commands to restore the
                      backup:
                    </p>
                    <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap">
                      {`sudo cp /etc/portlama/pki/client.crt.bak /etc/portlama/pki/client.crt
sudo cp /etc/portlama/pki/client.key.bak /etc/portlama/pki/client.key
sudo cp /etc/portlama/pki/client.p12.bak /etc/portlama/pki/client.p12
sudo systemctl reload nginx`}
                    </pre>
                  </div>
                )}
              </div>

              {/* Done button */}
              <div className="flex justify-end">
                {confirmDone ? (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-400">
                      Have you downloaded and imported the new certificate?
                    </span>
                    <button
                      type="button"
                      onClick={handleDone}
                      className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-500"
                    >
                      Yes, Done
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDone(false)}
                      className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                    >
                      Not yet
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDone}
                    className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Error stage */}
          {stage === 'error' && (
            <div className="space-y-4">
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
                <p className="font-semibold mb-1">Rotation failed</p>
                <p>{error}</p>
                <p className="mt-2 text-zinc-400">Your existing certificate is still valid.</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main page component ---

export default function Certificates() {
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [renewingDomain, setRenewingDomain] = useState(null);
  const [showRotationModal, setShowRotationModal] = useState(false);

  const certsQuery = useQuery({
    queryKey: ['certs'],
    queryFn: fetchCerts,
    refetchInterval: 30000,
  });

  const autoRenewQuery = useQuery({
    queryKey: ['auto-renew-status'],
    queryFn: fetchAutoRenewStatus,
  });

  const adminAuthQuery = useQuery({
    queryKey: ['admin-auth-mode'],
    queryFn: fetchAdminAuthMode,
  });

  const adminAuthMode = adminAuthQuery.data?.adminAuthMode || 'p12';

  const renewMutation = useMutation({
    mutationFn: renewCert,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['certs'] });
      const expiryText = data.newExpiry ? ` New expiry: ${formatDate(data.newExpiry)}` : '';
      addToast(`Certificate for ${data.domain} renewed.${expiryText}`);
      if (data.warning) addToast(data.warning, 'error');
      setRenewingDomain(null);
    },
    onError: (err) => {
      addToast(err.message, 'error');
      setRenewingDomain(null);
    },
  });

  const handleRenew = useCallback(
    (domain) => {
      setRenewingDomain(domain);
      renewMutation.mutate(domain);
    },
    [renewMutation],
  );

  const certs = certsQuery.data?.certs || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Certificates</h1>
        <p className="text-zinc-500 text-sm mt-1">View and manage TLS and mTLS certificates</p>
      </div>

      {/* Auto-renew status */}
      <AutoRenewStatus data={autoRenewQuery.data} isLoading={autoRenewQuery.isLoading} />

      {/* Certificate table */}
      {certsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
            />
          ))}
        </div>
      ) : certsQuery.isError ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
          <p className="text-red-400 text-sm">Failed to load certificates</p>
        </div>
      ) : (
        <>
          <CertTable certs={certs} onRenew={handleRenew} renewingDomain={renewingDomain} />
          <MtlsSection certs={certs} onRotate={() => setShowRotationModal(true)} adminAuthMode={adminAuthMode} />
          <AgentCertsSection />
        </>
      )}

      {/* Rotation modal */}
      {showRotationModal && <RotationModal onClose={() => setShowRotationModal(false)} />}
    </div>
  );
}
