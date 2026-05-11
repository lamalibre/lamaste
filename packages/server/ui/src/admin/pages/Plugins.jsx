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
} from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { errorMessage } from '../lib/errorMessage.js';

function StatusBadge({ status }) {
  const styles =
    status === 'enabled' ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400';

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {status === 'enabled' ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function PluginCard({ plugin, onEnable, onDisable, onUninstall, isActing }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const handleUninstall = () => {
    if (!confirmUninstall) {
      setConfirmUninstall(true);
      return;
    }
    setConfirmUninstall(false);
    onUninstall(plugin.name);
  };

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-cyan-400" />
          <span className="text-white font-semibold">{plugin.displayName || plugin.name}</span>
          <span className="text-zinc-500 text-xs">v{plugin.version}</span>
        </div>
        <StatusBadge status={plugin.status} />
      </div>

      {plugin.displayName && <p className="text-zinc-500 text-xs font-mono mb-1">{plugin.name}</p>}

      {plugin.description && <p className="text-zinc-400 text-sm mb-2">{plugin.description}</p>}

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

      <div className="flex items-center gap-2">
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

        {confirmUninstall ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-400">Uninstall?</span>
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
              onClick={() => setConfirmUninstall(false)}
              className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
            >
              No
            </button>
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
      addToast('Policy deleted');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const policies = policiesQuery.data?.policies || [];

  if (policiesQuery.isLoading) return null;
  if (policies.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="border-t border-zinc-700 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Push Install Policies</h2>
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
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.name}" enabled (restart panel to mount routes)`);
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

  const uninstallMutation = useMutation({
    mutationFn: (name) => client.uninstallPlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.name}" uninstalled`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const isActing =
    installMutation.isPending ||
    enableMutation.isPending ||
    disableMutation.isPending ||
    uninstallMutation.isPending;

  const handleInstall = useCallback(
    (packageName) => installMutation.mutate(packageName),
    [installMutation],
  );

  const handleEnable = useCallback((name) => enableMutation.mutate(name), [enableMutation]);

  const handleDisable = useCallback((name) => disableMutation.mutate(name), [disableMutation]);

  const handleUninstall = useCallback(
    (name) => uninstallMutation.mutate(name),
    [uninstallMutation],
  );

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
              isActing={isActing}
            />
          ))}
        </div>
      )}

      <PushInstallPolicies />
    </div>
  );
}
