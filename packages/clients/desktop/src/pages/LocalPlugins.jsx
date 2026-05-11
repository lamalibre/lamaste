import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Power,
  PowerOff,
  Trash2,
  Download,
  AlertCircle,
  Play,
  Square,
  Cpu,
  Terminal,
  Folder,
  Shield,
  ChevronLeft,
  ScrollText,
  ExternalLink,
  ArrowUpCircle,
  ArrowRightFromLine,
  ChevronUp,
  ChevronsUp,
  X,
  Rocket,
  Search,
  FlaskConical,
  BookOpen,
  MessageCircle,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { desktopLocalPluginClient as client } from '../lib/desktop-local-plugin-client.js';

// Map icon names from curated list to lucide-react components
const ICON_MAP = {
  cpu: Cpu,
  terminal: Terminal,
  folder: Folder,
  shield: Shield,
  package: Package,
  rocket: Rocket,
  search: Search,
  'flask-conical': FlaskConical,
  'book-open': BookOpen,
  'message-circle': MessageCircle,
};

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

const HOST_PORT = 9293;

function hostStateLabel(state) {
  switch (state) {
    case 'running': return `Running on port ${HOST_PORT}`;
    case 'loaded': return 'Starting\u2026';
    case 'stopped': return 'Stopped';
    case 'notInstalled': return 'Not installed';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

function HostStatusBar({ status, onStart, onStop, isActing }) {
  const state = status?.state;
  const running = state === 'running';
  const installed = status?.installed ?? state !== 'notInstalled';

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              running
                ? 'bg-green-400'
                : state === 'loaded'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-zinc-600'
            }`}
          />
          <div>
            <span className="text-sm text-white font-medium">
              Plugin Host
            </span>
            <span className="text-xs text-zinc-500 ml-2">
              {hostStateLabel(state)}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={isActing || !installed}
          onClick={running ? onStop : onStart}
          title={installed ? '' : 'Plugin host is not installed. Use the sidebar footer pill to install it.'}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
            running
              ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              : 'bg-cyan-600 text-white hover:bg-cyan-500'
          }`}
        >
          {running ? (
            <>
              <Square size={12} />
              Stop
            </>
          ) : (
            <>
              <Play size={12} />
              Start
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function AvailablePluginCard({ plugin, installed, onInstall, isInstalling }) {
  const Icon = ICON_MAP[plugin.icon] || Package;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-cyan-400" />
        <span className="text-white font-semibold">{plugin.name}</span>
      </div>
      <p className="text-zinc-400 text-sm mb-3">{plugin.description}</p>
      <p className="text-zinc-500 text-xs mb-4 font-mono">{plugin.packageName}</p>
      {installed ? (
        <span className="text-xs text-zinc-500 bg-zinc-800 px-3 py-1.5 rounded inline-block">
          Installed
        </span>
      ) : (
        <button
          type="button"
          disabled={isInstalling}
          onClick={() => onInstall(plugin.packageName)}
          className="flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={12} />
          {isInstalling ? 'Installing...' : 'Install'}
        </button>
      )}
    </div>
  );
}

function getUpdateType(current, latest) {
  const parse = (v) => (v || '0.0.0').split('.').map(Number);
  const [cMaj, cMin] = parse(current);
  const [lMaj, lMin] = parse(latest);
  if (lMaj > cMaj) return 'major';
  if (lMin > cMin) return 'minor';
  return 'patch';
}

function UpdateIcon({ type, size = 14 }) {
  if (type === 'major') return <ChevronsUp size={size} className="text-red-400" />;
  if (type === 'minor') return <ChevronUp size={size} className="text-amber-400" />;
  return <ArrowUpCircle size={size} className="text-cyan-400" />;
}

function UpdateDialog({ plugin, updateInfo, onUpdate, onClose, isUpdating }) {
  const updateType = getUpdateType(updateInfo.currentVersion, updateInfo.latestVersion);
  const typeLabel = { major: 'Major', minor: 'Minor', patch: 'Patch' }[updateType];
  const typeColor = { major: 'text-red-400', minor: 'text-amber-400', patch: 'text-cyan-400' }[updateType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <UpdateIcon type={updateType} size={16} />
            <span className="text-white font-semibold text-sm">{typeLabel} Update Available</span>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Plugin</span>
            <span className="text-white">{plugin.displayName || plugin.name}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Current</span>
            <span className="text-zinc-300 font-mono text-xs">v{updateInfo.currentVersion}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Latest</span>
            <span className={`font-mono text-xs ${typeColor}`}>v{updateInfo.latestVersion}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Type</span>
            <span className={`text-xs ${typeColor}`}>{typeLabel}</span>
          </div>
          {plugin.status === 'enabled' && (
            <p className="text-xs text-zinc-500">
              The plugin host will restart automatically after update.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-zinc-300 bg-zinc-700 hover:bg-zinc-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => { onUpdate(plugin.name); onClose(); }}
            className="rounded px-3 py-1.5 text-xs text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUpdating ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveToAgentDialog({ pluginName, onClose, onMoved }) {
  const [selectedAgent, setSelectedAgent] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState(null);

  const agentsQuery = useQuery({
    queryKey: ['agents-for-migration'],
    queryFn: () => invoke('get_agents'),
    select: (data) => data || [],
  });

  const agents = agentsQuery.data || [];
  const loading = agentsQuery.isLoading;

  // Use the first agent as default if no selection has been made
  const effectiveAgent = selectedAgent || (agents.length > 0 ? agents[0].label : '');

  const handleMigrate = async () => {
    if (!effectiveAgent) return;
    setMigrating(true);
    setError(null);
    try {
      await invoke('migrate_local_plugin_to_agent', { name: pluginName, label: effectiveAgent });
      onMoved(pluginName, effectiveAgent);
    } catch (err) {
      setError(typeof err === 'string' ? err : err.message || String(err));
      setMigrating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-xl bg-zinc-900 border border-zinc-700 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Move to Agent</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <p className="text-zinc-400 text-sm mb-4">
          Move <span className="text-white font-semibold">{pluginName}</span> from local plugins to an agent.
          The plugin data will be transferred and the local copy removed.
        </p>

        {loading ? (
          <p className="text-zinc-500 text-sm">Loading agents...</p>
        ) : agents.length === 0 ? (
          <p className="text-zinc-500 text-sm">No agents found. Install an agent first.</p>
        ) : (
          <>
            <label className="block text-xs text-zinc-400 mb-1" htmlFor="migrate-agent-select">
              Target agent
            </label>
            <select
              id="migrate-agent-select"
              value={effectiveAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 mb-4 focus:border-cyan-500 focus:outline-none"
            >
              {agents.map((a) => (
                <option key={a.label} value={a.label}>
                  {a.label}{a.domain ? ` (${a.domain})` : ''}
                </option>
              ))}
            </select>
          </>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs mb-4">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMigrate}
            disabled={migrating || !effectiveAgent || agents.length === 0}
            className="rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {migrating ? 'Moving...' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InstalledPluginCard({ plugin, onEnable, onDisable, onUninstall, onOpen, onUpdate, onMoveToAgent, updateInfo, isActing, isUpdating }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  const updateType = updateInfo?.hasUpdate
    ? getUpdateType(updateInfo.currentVersion, updateInfo.latestVersion)
    : null;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-cyan-400" />
          <span className="text-white font-semibold">{plugin.displayName || plugin.name}</span>
          <span className="text-zinc-500 text-xs">v{plugin.version}</span>
          {updateType && (
            <button
              type="button"
              onClick={() => setShowUpdateDialog(true)}
              title={`${updateType} update: v${updateInfo.latestVersion}`}
              className="hover:opacity-80"
            >
              <UpdateIcon type={updateType} size={14} />
            </button>
          )}
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

      <div className="flex flex-wrap items-center gap-2">
        {plugin.status === 'disabled' ? (
          <>
            <button
              type="button"
              disabled={isActing}
              onClick={() => onEnable(plugin.name)}
              className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Power size={12} />
              Enable
            </button>
            {confirmUninstall ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-zinc-400">Uninstall?</span>
                <button
                  type="button"
                  onClick={() => { setConfirmUninstall(false); onUninstall(plugin.name); }}
                  className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
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
                disabled={isActing}
                onClick={() => setConfirmUninstall(true)}
                className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 size={12} />
                Uninstall
              </button>
            )}
            {onMoveToAgent && (
              <button
                type="button"
                disabled={isActing}
                onClick={() => onMoveToAgent(plugin.name)}
                title="Move this plugin to an agent"
                className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-cyan-400 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowRightFromLine size={12} />
                Move to Agent
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={isActing}
              onClick={() => onDisable(plugin.name)}
              className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PowerOff size={12} />
              Disable
            </button>
            {plugin.packages?.server && (
              <button
                type="button"
                onClick={() => onOpen(plugin.name)}
                className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-cyan-400 hover:bg-zinc-600"
              >
                <ExternalLink size={12} />
                Open
              </button>
            )}
          </>
        )}
      </div>

      {showUpdateDialog && updateInfo?.hasUpdate && (
        <UpdateDialog
          plugin={plugin}
          updateInfo={updateInfo}
          onUpdate={onUpdate}
          onClose={() => setShowUpdateDialog(false)}
          isUpdating={isUpdating}
        />
      )}
    </div>
  );
}

function LocalPluginPanel({ pluginName, hostPort, onBack }) {
  const mountRef = useRef(null);
  const cleanupRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [confirmDesktopUninstall, setConfirmDesktopUninstall] = useState(false);

  const desktopStatusQuery = useQuery({
    queryKey: ['local-desktop-app-status', pluginName],
    queryFn: () => client.checkDesktopApp(pluginName),
    staleTime: 10000,
  });

  const queryClient = useQueryClient();
  const desktopInstallMutation = useMutation({
    mutationFn: () => client.installDesktopApp(pluginName),
  });
  const desktopOpenMutation = useMutation({
    mutationFn: () => client.openDesktopApp(pluginName),
  });
  const desktopUninstallMutation = useMutation({
    mutationFn: () => client.uninstallDesktopApp(pluginName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-desktop-app-status', pluginName] });
      setConfirmDesktopUninstall(false);
    },
  });

  const desktopApp = desktopStatusQuery.data;

  useEffect(() => {
    let cancelled = false;

    async function loadBundle() {
      try {
        const jsSource = await client.fetchPluginBundle(pluginName);
        if (cancelled) return;

        // Evaluate the plugin bundle in global scope
        const evalFn = new Function(jsSource);
        evalFn();

        const pluginEntry = window.__lamalibrePlugins?.[pluginName];
        if (!pluginEntry || typeof pluginEntry.mount !== 'function') {
          setError('Plugin did not register a mount function');
          setLoading(false);
          return;
        }

        const ctx = {
          mountPoint: mountRef.current,
          panelUrl: `http://localhost:${hostPort || 9293}`,
          basePath: `/plugins/${pluginName}`,
          subPath: '',
          theme: {
            bg: 'zinc-950',
            card: 'zinc-900',
            accent: 'cyan-400',
            border: 'zinc-800',
          },
        };

        const result = pluginEntry.mount(ctx);
        if (result && typeof result === 'object' && typeof result.unmount === 'function') {
          cleanupRef.current = result.unmount;
        } else if (typeof result === 'function') {
          cleanupRef.current = result;
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    loadBundle();

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch {
          // best-effort cleanup
        }
        cleanupRef.current = null;
      }
    };
  }, [pluginName, hostPort]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ChevronLeft size={14} />
          Back to Local Plugins
        </button>
        <div className="flex items-center gap-2">
          {desktopApp?.installed ? (
            <>
              <button
                type="button"
                disabled={desktopOpenMutation.isPending}
                onClick={() => desktopOpenMutation.mutate()}
                className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-cyan-400 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ExternalLink size={12} />
                Open Desktop App
              </button>
              {confirmDesktopUninstall ? (
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="text-zinc-400">Remove {desktopApp.productName}.app?</span>
                  <button
                    type="button"
                    disabled={desktopUninstallMutation.isPending}
                    onClick={() => desktopUninstallMutation.mutate()}
                    className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {desktopUninstallMutation.isPending ? 'Removing...' : 'Yes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDesktopUninstall(false)}
                    className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDesktopUninstall(true)}
                  className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
                >
                  <Trash2 size={12} />
                  Uninstall
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={desktopInstallMutation.isPending}
              onClick={() => desktopInstallMutation.mutate()}
              className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={12} />
              {desktopInstallMutation.isPending ? 'Launching...' : 'Install Desktop App'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-zinc-500 text-sm">Loading plugin panel...</div>
      )}

      {error && (
        <div className="rounded-lg bg-zinc-900 border border-red-800/50 p-4">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} />
            Failed to load plugin panel: {error}
          </div>
        </div>
      )}

      <div ref={mountRef} />
    </div>
  );
}

function HostLogs() {
  const logsQuery = useQuery({
    queryKey: ['local-host-logs'],
    queryFn: () => client.getHostLogs(),
    refetchInterval: 5000,
  });

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
        <ScrollText size={14} />
        Host Logs
      </h2>
      <pre className="rounded-lg bg-zinc-950 border border-zinc-800 p-4 text-xs text-zinc-400 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
        {logsQuery.data || 'No logs available'}
      </pre>
    </div>
  );
}

export default function LocalPlugins() {
  const queryClient = useQueryClient();
  const [openPlugin, setOpenPlugin] = useState(null);
  const [migratePlugin, setMigratePlugin] = useState(null);
  const [toast, setToast] = useState(null);

  const addToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Queries
  const hostQuery = useQuery({
    queryKey: ['local-host-status'],
    queryFn: () => client.getHostStatus(),
    refetchInterval: 5000,
  });

  const pluginsQuery = useQuery({
    queryKey: ['local-plugins'],
    queryFn: () => client.getPlugins(),
    refetchInterval: 10000,
  });

  const availableQuery = useQuery({
    queryKey: ['local-available-plugins'],
    queryFn: () => client.getAvailablePlugins(),
  });

  // Check for updates on all installed plugins
  const installedList = pluginsQuery.data?.plugins || [];
  const updatesQuery = useQuery({
    queryKey: ['local-plugin-updates', installedList.map((p) => `${p.name}@${p.version}`).join(',')],
    queryFn: async () => {
      const results = {};
      await Promise.all(
        installedList.map(async (p) => {
          try {
            results[p.name] = await client.checkPluginUpdate(p.name);
          } catch {
            // Silently skip — network errors shouldn't block the UI
          }
        }),
      );
      return results;
    },
    enabled: installedList.length > 0,
    refetchInterval: 60000, // check every minute
    staleTime: 30000,
  });

  const updateInfoMap = updatesQuery.data || {};

  // Mutations
  const startMutation = useMutation({
    mutationFn: () => client.startHost(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-host-status'] });
      addToast('Plugin host started');
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const stopMutation = useMutation({
    mutationFn: () => client.stopHost(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-host-status'] });
      addToast('Plugin host stopped');
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const installMutation = useMutation({
    mutationFn: (packageName) => client.installPlugin(packageName),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
      addToast(`Plugin "${data?.name || 'unknown'}" installed`);
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const enableMutation = useMutation({
    mutationFn: (name) => client.enablePlugin(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
      queryClient.invalidateQueries({ queryKey: ['local-host-status'] });
      addToast('Plugin enabled');
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const disableMutation = useMutation({
    mutationFn: (name) => client.disablePlugin(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
      queryClient.invalidateQueries({ queryKey: ['local-host-status'] });
      addToast('Plugin disabled');
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const uninstallMutation = useMutation({
    mutationFn: (name) => client.uninstallPlugin(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
      addToast('Plugin uninstalled');
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: (name) => client.updatePlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
      queryClient.invalidateQueries({ queryKey: ['local-host-status'] });
      queryClient.invalidateQueries({ queryKey: ['local-plugin-updates'] });
      addToast(`Plugin "${data?.name || 'unknown'}" updated to v${data?.version || '?'}`);
    },
    onError: (err) => addToast(err.message || String(err), 'error'),
  });

  const isActing =
    installMutation.isPending ||
    enableMutation.isPending ||
    disableMutation.isPending ||
    uninstallMutation.isPending ||
    updateMutation.isPending ||
    startMutation.isPending ||
    stopMutation.isPending;

  const installedPlugins = pluginsQuery.data?.plugins || [];
  const availablePlugins = availableQuery.data || [];
  const installedNames = new Set(installedPlugins.map((p) => p.packageName));

  // If a plugin panel is open, show it
  if (openPlugin) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <LocalPluginPanel
          pluginName={openPlugin}
          hostPort={hostQuery.data?.port}
          onBack={() => setOpenPlugin(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-2 text-sm shadow-lg ${
            toast.type === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-zinc-800 text-zinc-200 border border-zinc-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Local Plugins</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Run plugins locally without a server or agent
        </p>
      </div>

      {/* Host status */}
      <HostStatusBar
        status={hostQuery.data}
        onStart={() => startMutation.mutate()}
        onStop={() => stopMutation.mutate()}
        isActing={isActing}
      />

      {/* Unified plugin list */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Plugins</h2>
        {(pluginsQuery.isLoading || availableQuery.isLoading) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Installed plugins first */}
            {installedPlugins.map((plugin) => (
              <InstalledPluginCard
                key={plugin.name}
                plugin={plugin}
                onEnable={(name) => enableMutation.mutate(name)}
                onDisable={(name) => disableMutation.mutate(name)}
                onUninstall={(name) => uninstallMutation.mutate(name)}
                onOpen={(name) => setOpenPlugin(name)}
                onUpdate={(name) => updateMutation.mutate(name)}
                onMoveToAgent={(name) => setMigratePlugin(name)}
                updateInfo={updateInfoMap[plugin.name]}
                isActing={isActing}
                isUpdating={updateMutation.isPending}
              />
            ))}
            {/* Available but not yet installed */}
            {availablePlugins
              .filter((p) => !installedNames.has(p.packageName))
              .map((plugin) => (
                <AvailablePluginCard
                  key={plugin.name}
                  plugin={plugin}
                  installed={false}
                  onInstall={(pkg) => installMutation.mutate(pkg)}
                  isInstalling={installMutation.isPending}
                />
              ))}
          </div>
        )}
      </div>

      {/* Logs */}
      {hostQuery.data?.running && <HostLogs />}

      {/* Move to Agent dialog */}
      {migratePlugin && (
        <MoveToAgentDialog
          pluginName={migratePlugin}
          onClose={() => setMigratePlugin(null)}
          onMoved={(name, agentLabel) => {
            setMigratePlugin(null);
            queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
            addToast(`Plugin "${name}" moved to agent "${agentLabel}"`);
          }}
        />
      )}
    </div>
  );
}
