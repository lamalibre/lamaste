import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Power,
  PowerOff,
  Trash2,
  Download,
  AlertCircle,
  Shield,
  Pencil,
  X,
  Loader2,
  Network,
  Server,
  RefreshCw,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { PluginHooks, PluginOperation, PluginUpdate } from '../components/PluginLifecycle.jsx';
import PluginHostDialog from '../components/PluginHostDialog.jsx';
import PushInstallSection from '../components/PushInstallSection.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { refusalText } from '../lib/pluginRefusal.js';

function StatusBadge({ status }) {
  const styles =
    status === 'enabled' ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400';

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {status === 'enabled' ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function HostingBadge() {
  return (
    <span
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400"
      title="The application runs on its own agent. Lamaste never loads its code."
    >
      <Network size={11} />
      Agent-hosted
    </span>
  );
}

function HealthBadge({ health }) {
  const state = health?.state ?? 'unknown';
  const styles =
    state === 'up'
      ? 'bg-green-500/20 text-green-400'
      : state === 'down'
        ? 'bg-red-500/20 text-red-400'
        : 'bg-zinc-500/20 text-zinc-400';
  const label =
    state === 'up' ? 'reachable' : state === 'down' ? `down (${health.reason ?? '?'})` : 'unknown';
  const title = [
    health?.since ? `since ${new Date(health.since).toLocaleString()}` : null,
    health?.checkedAt ? `checked ${new Date(health.checkedAt).toLocaleTimeString()}` : null,
    state !== 'up' && health?.lastError ? health.lastError : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${styles}`}
      title={title}
    >
      <Activity size={11} />
      {label}
    </span>
  );
}

/**
 * "Delete the agent half's data" when a hosting whose agent half Lamaste
 * installed is removed: its data directory (`dataDir`, from the agent
 * half's preview; null while it loads) and service account go too. Kept by
 * default, so hosting the plugin there again finds its data.
 */
function PurgeOption({ hosting, dataDir, checked, onChange }) {
  return (
    <span className="flex basis-full flex-col gap-1">
      <label
        className="flex items-center gap-1 text-zinc-500"
        title="Kept by default: hosting the plugin on this agent again finds its data"
      >
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        also delete the agent half&apos;s data (purge)
      </label>
      {checked && (
        <span className="flex items-start gap-1 text-red-400">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>
            Deletes {dataDir ? <span className="font-mono">{dataDir}</span> : 'its data directory'}{' '}
            and the agent half&apos;s service account on{' '}
            <span className="font-mono">{hosting.agentLabel}</span> — this cannot be undone.
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * Where an agent-hosted plugin's agent half runs: the hosting agent, the
 * assigned port and its health, the agent half Lamaste installed there, or
 * the dialog to host it on an agent.
 */
function HostingSection({ plugin, dataDir, onHost, onUnhost, onRotate, isActing }) {
  const [hostDialog, setHostDialog] = useState(false);
  const [confirmUnhost, setConfirmUnhost] = useState(false);
  const [force, setForce] = useState(false);
  const [purge, setPurge] = useState(false);
  const hosting = plugin.agentHosting;
  const lamasteInstalls = plugin.hooks?.agentHalf === true;
  const hooksPending = plugin.hooks?.approval === 'pending';

  if (hosting) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Server size={12} className="text-cyan-400" />
          <span className="text-zinc-300">
            Hosted on <span className="font-mono text-zinc-200">{hosting.agentLabel}</span>
          </span>
          <span className="text-zinc-500">
            port <span className="font-mono">{hosting.port}</span>
          </span>
          {hosting.phase && hosting.phase !== 'active' ? (
            <span className="text-cyan-400">{hosting.phase}…</span>
          ) : (
            <HealthBadge health={hosting.health} />
          )}
          {!hosting.secretAcknowledged && (
            <span className="text-zinc-500" title="The agent fetches it on its next sync">
              secret not yet fetched
            </span>
          )}
          {hosting.rotationPending && <span className="text-yellow-400">rotation pending</span>}
        </div>
        {hosting.agentHalf && (
          <p className="mb-2 text-zinc-500">
            Agent half <span className="font-mono text-zinc-300">{hosting.agentHalf.version}</span>{' '}
            installed by Lamaste {new Date(hosting.agentHalf.installedAt).toLocaleString()}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isActing}
            onClick={() => onRotate(plugin.name)}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
            title="Issue a new installation secret; the previous one stays accepted until the agent acknowledges the new one"
          >
            <RefreshCw size={11} />
            Rotate secret
          </button>
          {confirmUnhost ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-400">
                {lamasteInstalls
                  ? 'Run its uninstall hooks, then remove the agent half, tunnel, secret and capability?'
                  : 'Run its uninstall hooks, then remove tunnel, secret and capability?'}
              </span>
              <label
                className="flex items-center gap-1 text-zinc-500"
                title="Go on when a pre-teardown hook fails or the agent does not answer (reported, audited)"
              >
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />
                force
              </label>
              <button
                type="button"
                onClick={() => {
                  setConfirmUnhost(false);
                  onUnhost(plugin.name, { force, purge: lamasteInstalls && purge }, hosting);
                  setForce(false);
                  setPurge(false);
                }}
                className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmUnhost(false);
                  setForce(false);
                  setPurge(false);
                }}
                className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
              >
                No
              </button>
              {lamasteInstalls && (
                <PurgeOption
                  hosting={hosting}
                  dataDir={dataDir}
                  checked={purge}
                  onChange={setPurge}
                />
              )}
            </span>
          ) : (
            <button
              type="button"
              disabled={isActing}
              onClick={() => setConfirmUnhost(true)}
              className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
            >
              <X size={11} />
              Clear hosting
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <p className="text-zinc-400 mb-2">
        {lamasteInstalls
          ? 'Not hosted yet. Pick the agent it runs on: Lamaste installs the agent half there and runs the install hooks around creating the internal tunnel, assigning the port and issuing the installation secret.'
          : 'Not hosted yet. Pick the agent that runs its agent half: Lamaste runs the plugin’s install hooks around creating the internal tunnel, assigning the port and issuing the installation secret.'}
      </p>
      <button
        type="button"
        disabled={isActing}
        onClick={() => setHostDialog(true)}
        title={hooksPending ? 'What it brings waits for approval (Lifecycle hooks)' : undefined}
        className="flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        <Server size={11} />
        Host on an agent…
      </button>
      {hostDialog && (
        <PluginHostDialog
          plugin={plugin}
          onHost={onHost}
          onClose={() => setHostDialog(false)}
          isActing={isActing}
        />
      )}
    </div>
  );
}

function PluginCard({
  plugin,
  onEnable,
  onDisable,
  onUninstall,
  onHost,
  onUnhost,
  onRotate,
  isActing,
}) {
  const client = useAdminClient();
  const agentHosted = plugin.hosting === 'agent';
  const hasAgentHalf = agentHosted && plugin.agent != null;
  // Purging applies to a hosting whose agent half Lamaste installed; the
  // agent half's preview names its data directory (the Lifecycle hooks
  // panel reads the same query).
  const canPurge = plugin.agentHosting != null && plugin.hooks?.agentHalf === true;
  const hooksQuery = useQuery({
    queryKey: ['plugin-hooks', plugin.name],
    queryFn: () => client.getPluginHooks(plugin.name),
    enabled: plugin.hooks?.agentHalf === true,
  });
  const dataDir = hooksQuery.data?.hooks?.agentHalf?.dataDir ?? null;
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [purge, setPurge] = useState(false);

  const handleUninstall = () => {
    if (!confirmUninstall) {
      setConfirmUninstall(true);
      return;
    }
    setConfirmUninstall(false);
    onUninstall(plugin.name, { purge: canPurge && purge }, plugin.agentHosting);
    setPurge(false);
  };

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-cyan-400" />
          <span className="text-white font-semibold">{plugin.displayName || plugin.name}</span>
          <span className="text-zinc-500 text-xs">v{plugin.version}</span>
        </div>
        <div className="flex items-center gap-2">
          {agentHosted && <HostingBadge />}
          <StatusBadge status={plugin.status} />
        </div>
      </div>

      {plugin.displayName && <p className="text-zinc-500 text-xs font-mono mb-1">{plugin.name}</p>}

      {plugin.description && <p className="text-zinc-400 text-sm mb-2">{plugin.description}</p>}

      {agentHosted && !hasAgentHalf && (
        <p className="text-zinc-500 text-xs mb-2">
          Runs on its own agent. Lamaste registers its OIDC clients and capabilities; it mounts no
          routes and serves no pages for it.
        </p>
      )}
      {hasAgentHalf && (
        <p className="text-zinc-500 text-xs mb-2">
          Runs on an agent; the panel forwards its admin API and pages to the agent half over an
          internal tunnel.
        </p>
      )}

      <p className="text-zinc-500 text-xs mb-4">
        {plugin.packageName}
        {plugin.installedAt && (
          <span> &middot; Installed {new Date(plugin.installedAt).toLocaleDateString()}</span>
        )}
        {plugin.panel?.pages?.length > 0 && (
          <span>
            {' '}
            &middot; {plugin.panel.pages.length} page{plugin.panel.pages.length > 1 ? 's' : ''}
          </span>
        )}
      </p>

      {plugin.capabilities && plugin.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {plugin.capabilities.map((cap) => (
            <span key={cap} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
              {cap}
            </span>
          ))}
        </div>
      )}

      {agentHosted && <PluginOperation plugin={plugin.name} />}

      {(plugin.hooks?.relay ||
        plugin.hooks?.agent ||
        plugin.hooks?.agentHalf ||
        plugin.hooks?.pendingUpdate) && <PluginHooks plugin={plugin} isActing={isActing} />}

      {hasAgentHalf && (
        <HostingSection
          plugin={plugin}
          dataDir={dataDir}
          onHost={onHost}
          onUnhost={onUnhost}
          onRotate={onRotate}
          isActing={isActing}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {plugin.status === 'disabled' ? (
          <button
            type="button"
            disabled={isActing}
            onClick={() => onEnable(plugin.name)}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Power size={12} />
            Enable
          </button>
        ) : (
          <button
            type="button"
            disabled={isActing}
            onClick={() => onDisable(plugin.name)}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PowerOff size={12} />
            Disable
          </button>
        )}

        {agentHosted && <PluginUpdate plugin={plugin} isActing={isActing} />}

        {confirmUninstall ? (
          <span className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-zinc-400">
              {canPurge ? 'Remove its hosting and agent half, then uninstall?' : 'Uninstall?'}
            </span>
            <button
              type="button"
              onClick={handleUninstall}
              disabled={plugin.status === 'enabled'}
              className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmUninstall(false);
                setPurge(false);
              }}
              className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
            >
              No
            </button>
            {canPurge && (
              <PurgeOption
                hosting={plugin.agentHosting}
                dataDir={dataDir}
                checked={purge}
                onChange={setPurge}
              />
            )}
          </span>
        ) : (
          <button
            type="button"
            disabled={isActing || plugin.status === 'enabled'}
            onClick={handleUninstall}
            title={plugin.status === 'enabled' ? 'Disable before uninstalling' : 'Uninstall plugin'}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={12} />
            Uninstall
          </button>
        )}
      </div>
    </div>
  );
}

function InstallForm({ onInstall, isInstalling }) {
  const [packageName, setPackageName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!packageName.trim()) return;
    onInstall(packageName.trim());
    setPackageName('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="flex-1">
        <label className="block text-xs text-zinc-400 mb-1" htmlFor="package-name">
          Package name
        </label>
        <input
          id="package-name"
          type="text"
          value={packageName}
          onChange={(e) => setPackageName(e.target.value)}
          placeholder="@lamalibre/..."
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
        />
      </div>
      <button
        type="submit"
        disabled={isInstalling || !packageName.trim()}
        className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1.5 text-sm text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={14} />
        Install
      </button>
    </form>
  );
}

const ACTIONS = ['install', 'update', 'uninstall', 'check-prerequisites'];

function PolicyEditModal({ policy, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [name, setName] = useState(policy.name || '');
  const [description, setDescription] = useState(policy.description || '');
  const [allowedIps, setAllowedIps] = useState((policy.allowedIps || []).join('\n'));
  const [deniedIps, setDeniedIps] = useState((policy.deniedIps || []).join('\n'));
  const [allowedPlugins, setAllowedPlugins] = useState((policy.allowedPlugins || []).join('\n'));
  const [allowedActions, setAllowedActions] = useState(
    policy.allowedActions || ACTIONS.slice(0, 3),
  );

  const mutation = useMutation({
    mutationFn: (data) => client.updatePushInstallPolicy(policy.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-install-policies'] });
      queryClient.invalidateQueries({ queryKey: ['push-install-config'] });
      addToast('Policy updated');
      onClose();
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const toArray = (str) =>
      str
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    mutation.mutate({
      name,
      description,
      allowedIps: toArray(allowedIps),
      deniedIps: toArray(deniedIps),
      allowedPlugins: toArray(allowedPlugins),
      allowedActions,
    });
  };

  const toggleAction = (action) => {
    setAllowedActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action],
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-lg rounded-xl bg-zinc-900 border border-zinc-700 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Edit Policy</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Allowed IPs (one per line)
            </label>
            <textarea
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
              rows={3}
              placeholder="192.168.1.0/24"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Denied IPs (one per line)
            </label>
            <textarea
              value={deniedIps}
              onChange={(e) => setDeniedIps(e.target.value)}
              rows={2}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Allowed Plugins (one per line)
            </label>
            <textarea
              value={allowedPlugins}
              onChange={(e) => setAllowedPlugins(e.target.value)}
              rows={2}
              placeholder="@lamalibre/lamaste-herd-plugin"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-zinc-500">
              For an agent half Lamaste installs, name its agent package (the manifest&apos;s{' '}
              <span className="font-mono">agent.package</span>). Empty allows every package.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Allowed Actions</label>
            <div className="flex flex-wrap gap-3">
              {ACTIONS.map((action) => (
                <label key={action} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowedActions.includes(action)}
                    onChange={() => toggleAction(action)}
                    className="accent-cyan-500"
                  />
                  <span className="text-zinc-300">{action}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || mutation.isPending}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin inline mr-1" />
              ) : null}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PushInstallPolicies() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [editPolicy, setEditPolicy] = useState(null);

  const policiesQuery = useQuery({
    queryKey: ['push-install-policies'],
    queryFn: () => client.getPushInstallPolicies(),
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => client.deletePushInstallPolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-install-policies'] });
      queryClient.invalidateQueries({ queryKey: ['push-install-config'] });
      addToast('Policy deleted');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const policies = policiesQuery.data?.policies || [];

  if (policiesQuery.isLoading) return null;
  if (policies.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Shield size={14} className="text-cyan-400" />
        <h3 className="text-sm font-semibold text-zinc-300">Policies</h3>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 bg-zinc-900">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400 hidden md:table-cell">
                Description
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400 hidden lg:table-cell">
                Actions
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">
                Manage
              </th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id} className="border-b border-zinc-700 bg-zinc-800">
                <td className="px-4 py-3 text-zinc-200 font-semibold">{policy.name}</td>
                <td className="px-4 py-3 text-zinc-400 hidden md:table-cell">
                  {policy.description || '—'}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(policy.allowedActions || []).map((a) => (
                      <span
                        key={a}
                        className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditPolicy(policy)}
                      className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
                      title="Edit policy"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(policy.id)}
                      disabled={deleteMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-red-600/20 hover:text-red-400"
                      title="Delete policy"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editPolicy && <PolicyEditModal policy={editPolicy} onClose={() => setEditPolicy(null)} />}
    </div>
  );
}

export default function Plugins() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const pluginsQuery = useQuery({
    queryKey: ['plugins'],
    queryFn: () => client.getPlugins(),
    refetchInterval: 10000,
  });

  const installMutation = useMutation({
    mutationFn: (packageName) => client.installPlugin(packageName),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.plugin?.name || 'unknown'}" installed`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const enableMutation = useMutation({
    mutationFn: (name) => client.enablePlugin(name),
    onSuccess: (data) => {
      const plugin = pluginsQuery.data?.plugins?.find((p) => p.name === data.name);
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(
        plugin?.hosting === 'agent'
          ? `Plugin "${data.name}" enabled (agent-hosted — nothing to mount)`
          : `Plugin "${data.name}" enabled (restart panel to mount routes)`,
      );
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const disableMutation = useMutation({
    mutationFn: (name) => client.disablePlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.name}" disabled`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  // A refused uninstall or hosting removal; `hosting` names the agent the
  // refusal is about.
  const toastRemovalRefused = (err, { hosting }) =>
    addToast(refusalText(err, { agentLabel: hosting?.agentLabel, action: 'uninstall' }), 'error');

  // A hosted plugin's hosting goes first (its uninstall pipeline, an
  // operation) — with the agent half Lamaste installed, and its data when
  // `purge` is set; `hosting` names the agent a refusal is about.
  const uninstallMutation = useMutation({
    mutationFn: ({ name, purge }) => client.uninstallPlugin(name, { purge }),
    onSuccess: (data, { name, purge }) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      if (data.operation) {
        queryClient.invalidateQueries({ queryKey: ['plugin-operations', name] });
        addToast(
          `Uninstalling "${name}": its hosting is removed first${purge ? ', with its agent half’s data' : ''} — follow the steps on its card`,
        );
      } else {
        addToast(`Plugin "${data.name}" uninstalled`);
      }
    },
    onError: toastRemovalRefused,
  });

  // Hosting and clearing it run the plugin's install / uninstall pipelines
  // as operations; each card follows its plugin's latest operation. The
  // host dialog explains a refused hosting itself (it passes onError).
  const hostMutation = useMutation({
    mutationFn: ({ name, agentLabel }) => client.setPluginHosting(name, agentLabel),
    onSuccess: (_data, { name, agentLabel }) => {
      queryClient.invalidateQueries({ queryKey: ['plugin-operations', name] });
      addToast(`Hosting "${name}" on ${agentLabel} — follow the steps on its card`);
    },
  });

  const unhostMutation = useMutation({
    mutationFn: ({ name, force, purge }) => client.clearPluginHosting(name, { force, purge }),
    onSuccess: (_data, { name, purge }) => {
      queryClient.invalidateQueries({ queryKey: ['plugin-operations', name] });
      addToast(
        `Removing the hosting of "${name}"${purge ? ' and its agent half’s data' : ''} — follow the steps on its card`,
      );
    },
    onError: toastRemovalRefused,
  });

  const rotateMutation = useMutation({
    mutationFn: (name) => client.rotatePluginHostingSecret(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast('New installation secret issued — the agent picks it up on its next sync');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const isActing =
    installMutation.isPending ||
    enableMutation.isPending ||
    disableMutation.isPending ||
    uninstallMutation.isPending ||
    hostMutation.isPending ||
    unhostMutation.isPending ||
    rotateMutation.isPending;

  const handleInstall = useCallback(
    (packageName) => installMutation.mutate(packageName),
    [installMutation],
  );

  const handleEnable = useCallback((name) => enableMutation.mutate(name), [enableMutation]);

  const handleDisable = useCallback((name) => disableMutation.mutate(name), [disableMutation]);

  const handleUninstall = useCallback(
    (name, options = {}, hosting = null) =>
      uninstallMutation.mutate({ name, purge: options.purge === true, hosting }),
    [uninstallMutation],
  );

  const handleHost = useCallback(
    (name, agentLabel, callbacks) => hostMutation.mutate({ name, agentLabel }, callbacks),
    [hostMutation],
  );
  const handleUnhost = useCallback(
    (name, options = {}, hosting = null) =>
      unhostMutation.mutate({
        name,
        force: options.force === true,
        purge: options.purge === true,
        hosting,
      }),
    [unhostMutation],
  );
  const handleRotate = useCallback((name) => rotateMutation.mutate(name), [rotateMutation]);

  const plugins = pluginsQuery.data?.plugins;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Plugins</h1>
        <p className="text-zinc-500 text-sm mt-1">Install, enable, and manage plugins</p>
      </div>

      {/* Install form */}
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5 mb-8">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Install Plugin</h2>
        <InstallForm onInstall={handleInstall} isInstalling={installMutation.isPending} />
        {installMutation.isPending && <p className="text-xs text-zinc-500 mt-2">Installing...</p>}
      </div>

      {/* Plugin list */}
      {pluginsQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
            />
          ))}
        </div>
      ) : pluginsQuery.isError ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} />
            Failed to load plugins
          </div>
        </div>
      ) : plugins?.length === 0 ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
          <p className="text-zinc-500 text-sm text-center">
            No plugins installed. Use the form above to install one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plugins?.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              onEnable={handleEnable}
              onDisable={handleDisable}
              onUninstall={handleUninstall}
              onHost={handleHost}
              onUnhost={handleUnhost}
              onRotate={handleRotate}
              isActing={isActing}
            />
          ))}
        </div>
      )}

      <PushInstallSection>
        <PushInstallPolicies />
      </PushInstallSection>
    </div>
  );
}
