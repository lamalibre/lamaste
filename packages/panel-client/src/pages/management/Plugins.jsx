import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Power, PowerOff, Trash2, Download, AlertCircle } from 'lucide-react';
import { useToast } from '../../components/Toast.jsx';

async function fetchPlugins() {
  const res = await fetch('/api/plugins');
  if (!res.ok) throw new Error('Failed to fetch plugins');
  return res.json();
}

async function installPlugin(packageName) {
  const res = await fetch('/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to install plugin');
  return data;
}

async function enablePlugin(name) {
  const res = await fetch(`/api/plugins/${name}/enable`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to enable plugin');
  return data;
}

async function disablePlugin(name) {
  const res = await fetch(`/api/plugins/${name}/disable`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to disable plugin');
  return data;
}

async function uninstallPlugin(name) {
  const res = await fetch(`/api/plugins/${name}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to uninstall plugin');
  return data;
}

function StatusBadge({ status }) {
  const styles =
    status === 'enabled'
      ? 'bg-green-500/20 text-green-400'
      : 'bg-zinc-500/20 text-zinc-400';

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
          <span className="text-white font-semibold">{plugin.name}</span>
          <span className="text-zinc-500 text-xs">v{plugin.version}</span>
        </div>
        <StatusBadge status={plugin.status} />
      </div>

      {plugin.description && (
        <p className="text-zinc-400 text-sm mb-2">{plugin.description}</p>
      )}

      <p className="text-zinc-500 text-xs mb-4">
        {plugin.packageName}
        {plugin.installedAt && (
          <span> &middot; Installed {new Date(plugin.installedAt).toLocaleDateString()}</span>
        )}
      </p>

      {plugin.capabilities && plugin.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {plugin.capabilities.map((cap) => (
            <span
              key={cap}
              className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded"
            >
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

export default function Plugins() {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const pluginsQuery = useQuery({
    queryKey: ['plugins'],
    queryFn: fetchPlugins,
    refetchInterval: 10000,
  });

  const installMutation = useMutation({
    mutationFn: installPlugin,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.plugin?.name || 'unknown'}" installed`);
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const enableMutation = useMutation({
    mutationFn: enablePlugin,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.name}" enabled (restart panel to mount routes)`);
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const disableMutation = useMutation({
    mutationFn: disablePlugin,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.name}" disabled`);
    },
    onError: (err) => addToast(err.message, 'error'),
  });

  const uninstallMutation = useMutation({
    mutationFn: uninstallPlugin,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      addToast(`Plugin "${data.name}" uninstalled`);
    },
    onError: (err) => addToast(err.message, 'error'),
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

  const handleEnable = useCallback(
    (name) => enableMutation.mutate(name),
    [enableMutation],
  );

  const handleDisable = useCallback(
    (name) => disableMutation.mutate(name),
    [disableMutation],
  );

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
        {installMutation.isPending && (
          <p className="text-xs text-zinc-500 mt-2">Installing...</p>
        )}
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
    </div>
  );
}
