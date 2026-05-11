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
  ExternalLink,
  ChevronLeft,
  ArrowUpCircle,
  ChevronUp,
  ChevronsUp,
  X,
} from 'lucide-react';
import { Cpu, Terminal, Folder, Shield } from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAgentClient } from '../context/AgentClientContext.jsx';
import { errorMessage } from '../lib/errorMessage.js';

// Curated plugin list — same as local plugins, filtered to agent-capable
const KNOWN_PLUGINS = [
  {
    name: 'herd',
    packageName: '@lamalibre/herd-server',
    description: 'Zero-config LLM inference pooling',
    icon: 'cpu',
  },
  {
    name: 'shell',
    packageName: '@lamalibre/shell-server',
    description: 'Secure remote terminal via tmux',
    icon: 'terminal',
  },
  {
    name: 'sync',
    packageName: '@lamalibre/sync-server',
    description: 'Bidirectional file sync',
    icon: 'folder',
  },
  {
    name: 'gate',
    packageName: '@lamalibre/gate-server',
    description: 'VPN tunnel management',
    icon: 'shield',
  },
];

const ICON_MAP = {
  cpu: Cpu,
  terminal: Terminal,
  folder: Folder,
  shield: Shield,
  package: Package,
};

function StatusBadge({ status }) {
  const styles =
    status === 'enabled' ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400';

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles}`}>
      {status === 'enabled' ? 'Enabled' : 'Disabled'}
    </span>
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
  const typeColor = { major: 'text-red-400', minor: 'text-amber-400', patch: 'text-cyan-400' }[
    updateType
  ];

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
          {plugin.status === 'enabled' && (
            <p className="text-xs text-zinc-500">
              The panel server will restart automatically after update.
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
            onClick={() => {
              onUpdate(plugin.name);
              onClose();
            }}
            className="rounded px-3 py-1.5 text-xs text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUpdating ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Default agent panel port — matches AGENT_PANEL_PORT in agents.rs
const AGENT_PANEL_DEFAULT_PORT = 9393;

// Theme override — maps Lamaste Desktop's zinc/cyan palette to sync-panel's
// custom CSS tokens (--color-surface, --color-card, etc.) so microfrontend
// plugins look native inside the host.
const HOST_THEME = {
  surface: 'oklch(0.145 0.000 0)', // zinc-950
  card: 'oklch(0.210 0.006 285.885)', // zinc-900
  cardHover: 'oklch(0.274 0.006 286.033)', // zinc-800
  border: 'oklch(0.274 0.006 286.033)', // zinc-800
  accent: 'oklch(0.789 0.154 211.53)', // cyan-400
  accentDim: 'oklch(0.609 0.126 211.53)', // cyan-500
  textPrimary: 'oklch(1.000 0.000 0)', // white
  textSecondary: 'oklch(0.552 0.016 285.938)', // zinc-400
  success: 'oklch(0.723 0.191 149.579)', // green-400
  warning: 'oklch(0.795 0.184 86.047)', // amber-400
  error: 'oklch(0.637 0.237 25.331)', // red-400
};

function AgentPluginPanel({ pluginName, client, onBack, subPath, onPagesDiscovered }) {
  const mountRef = useRef(null);
  const cleanupRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const subPathRef = useRef(subPath || '');
  const lastMountedSubPathRef = useRef(null);

  // Keep subPathRef in sync for remounting
  useEffect(() => {
    subPathRef.current = subPath || '';
  }, [subPath]);

  useEffect(() => {
    let cancelled = false;

    function cleanupPlugin() {
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch {
          // best-effort cleanup
        }
        cleanupRef.current = null;
      }
      if (window.__lamalibrePlugins?.[pluginName]) {
        delete window.__lamalibrePlugins[pluginName];
      }
    }

    function mountPlugin() {
      const pluginEntry = window.__lamalibrePlugins?.[pluginName];
      if (!pluginEntry || typeof pluginEntry.mount !== 'function') {
        setError('Plugin did not register a mount function');
        setLoading(false);
        return;
      }

      // Report pages metadata to the parent for sidebar injection
      if (onPagesDiscovered && Array.isArray(pluginEntry.pages)) {
        onPagesDiscovered(pluginEntry.pages);
      }

      try {
        const isDesktop = !!window.__TAURI_INTERNALS__;
        const panelUrl = isDesktop
          ? `http://127.0.0.1:${AGENT_PANEL_DEFAULT_PORT}`
          : window.location.origin;

        const ctx = {
          mountPoint: mountRef.current,
          panelUrl,
          // Plugins mount at /<name>/ on the agent daemon (matches both the
          // desktop-loaded panel and the Authelia-protected plugin tunnel
          // flow, where nginx rewrites herd.example.com/x -> :9393/herd/x).
          basePath: `/${pluginName}`,
          subPath: subPathRef.current,
          theme: HOST_THEME,
        };

        const result = pluginEntry.mount(ctx);
        if (result && typeof result === 'object' && typeof result.unmount === 'function') {
          cleanupRef.current = result.unmount;
        } else if (typeof result === 'function') {
          cleanupRef.current = result;
        }
        lastMountedSubPathRef.current = subPathRef.current;

        setLoading(false);
      } catch (err) {
        setError(`[mount] ${errorMessage(err)}`);
        setLoading(false);
      }
    }

    async function loadBundle() {
      setError(null);
      setLoading(true);
      cleanupPlugin();

      let bundle;
      try {
        bundle = await client.fetchAgentPluginBundle(pluginName);
      } catch (err) {
        if (!cancelled) {
          const msg = typeof err === 'string' ? err : err?.message || String(err);
          setError(`[fetch] ${msg}`);
          setLoading(false);
        }
        return;
      }

      if (cancelled) return;

      if (!bundle?.source) {
        setError('[fetch] Bundle response was empty or invalid');
        setLoading(false);
        return;
      }

      try {
        const evalFn = new Function(bundle.source);
        evalFn();
      } catch (err) {
        if (!cancelled) {
          setError(`[eval] ${errorMessage(err)}`);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) mountPlugin();
    }

    loadBundle();

    return () => {
      cancelled = true;
      cleanupPlugin();
    };
  }, [pluginName, client, retryCount]);

  // Re-mount when subPath changes (unmount old, mount new with updated subPath).
  useEffect(() => {
    if (loading || error) return;
    // Skip if this subPath was already mounted by the initial loadBundle effect
    if (lastMountedSubPathRef.current === (subPath || '')) return;

    const pluginEntry = window.__lamalibrePlugins?.[pluginName];
    if (!pluginEntry || typeof pluginEntry.mount !== 'function') return;

    // Cleanup previous mount
    if (cleanupRef.current) {
      try {
        cleanupRef.current();
      } catch {
        /* best-effort */
      }
      cleanupRef.current = null;
    }

    // Clear mount point
    if (mountRef.current) {
      mountRef.current.innerHTML = '';
    }

    try {
      const isDesktop = !!window.__TAURI_INTERNALS__;
      const panelUrl = isDesktop
        ? `http://127.0.0.1:${AGENT_PANEL_DEFAULT_PORT}`
        : window.location.origin;

      const ctx = {
        mountPoint: mountRef.current,
        panelUrl,
        // Plugins mount at /<name>/ on the agent daemon (see initial mount).
        basePath: `/${pluginName}`,
        subPath: subPath || '',
        theme: HOST_THEME,
      };

      const result = pluginEntry.mount(ctx);
      if (result && typeof result === 'object' && typeof result.unmount === 'function') {
        cleanupRef.current = result.unmount;
      } else if (typeof result === 'function') {
        cleanupRef.current = result;
      }
      lastMountedSubPathRef.current = subPath || '';
    } catch (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(`[mount] ${errorMessage(err)}`);
    }
  }, [subPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {!onPagesDiscovered && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-4"
        >
          <ChevronLeft size={14} />
          Back to Plugins
        </button>
      )}

      {loading && <div className="text-zinc-500 text-sm">Loading plugin panel...</div>}

      {error && (
        <div className="rounded-lg bg-zinc-900 border border-red-800/50 p-4">
          <div className="flex items-center gap-2 text-red-400 text-sm mb-3">
            <AlertCircle size={16} />
            {error}
          </div>
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
          >
            Retry
          </button>
        </div>
      )}

      <div ref={mountRef} />
    </div>
  );
}

function PluginCard({
  plugin,
  onEnable,
  onDisable,
  onUninstall,
  onOpen,
  onUpdate,
  updateInfo,
  isActing,
  isUpdating,
}) {
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
              <span className="flex items-center gap-2 text-xs">
                <span className="text-red-400">Uninstall?</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmUninstall(false);
                    onUninstall(plugin.name);
                  }}
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
        <label className="block text-xs text-zinc-400 mb-1" htmlFor="agent-plugin-package-name">
          Package name
        </label>
        <input
          id="agent-plugin-package-name"
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

function PanelNotRunning({ onStart, isStarting }) {
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
      <AlertCircle size={32} className="text-zinc-500 mx-auto mb-4" />
      <h2 className="text-white font-semibold mb-2">Agent Plugin Server Not Running</h2>
      <p className="text-zinc-400 text-sm mb-6 max-w-md mx-auto">
        The agent plugin server needs to be running to manage plugins. Start it to install, enable,
        and configure plugins on this agent.
      </p>
      <button
        type="button"
        disabled={isStarting}
        onClick={onStart}
        className="inline-flex items-center gap-2 rounded bg-cyan-600 px-5 py-2 text-sm text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play size={16} />
        {isStarting ? 'Starting...' : 'Start Plugin Server'}
      </button>
    </div>
  );
}

export { AgentPluginPanel };

export default function AgentPluginsPage({ onOpenPlugin }) {
  const client = useAgentClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [openPlugin, setOpenPlugin] = useState(null);

  // Fetch plugins directly — if the panel isn't running, the query will error
  const pluginsQuery = useQuery({
    queryKey: ['agent-plugins'],
    queryFn: () => client.getAgentPlugins(),
    refetchInterval: 10000,
    retry: 1,
  });

  // Derive panel status from the plugins query
  const panelRunning = pluginsQuery.isSuccess;

  const startPanelMutation = useMutation({
    mutationFn: () => client.startAgentPanel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      addToast('Plugin server started');
    },
    onError: (err) => addToast(errorMessage(err) || 'Failed to start plugin server', 'error'),
  });

  const stopPanelMutation = useMutation({
    mutationFn: () => client.stopAgentPanel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      addToast('Plugin server stopped');
    },
    onError: (err) => addToast(errorMessage(err) || 'Failed to stop plugin server', 'error'),
  });

  // Check for updates on all installed plugins
  const installedList = pluginsQuery.data?.plugins || [];
  const updatesQuery = useQuery({
    queryKey: [
      'agent-plugin-updates',
      installedList.map((p) => `${p.name}@${p.version}`).join(','),
    ],
    queryFn: async () => {
      const results = {};
      await Promise.all(
        installedList.map(async (p) => {
          try {
            results[p.name] = await client.checkAgentPluginUpdate(p.name);
          } catch {
            // Silently skip — network errors shouldn't block the UI
          }
        }),
      );
      return results;
    },
    enabled: installedList.length > 0,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const updateInfoMap = updatesQuery.data || {};

  const installMutation = useMutation({
    mutationFn: (packageName) => client.installAgentPlugin(packageName),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      addToast(`Plugin "${data.plugin?.name || 'unknown'}" installed`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const enableMutation = useMutation({
    mutationFn: (name) => client.enableAgentPlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      addToast(`Plugin "${data.name}" enabled — panel server is restarting...`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const disableMutation = useMutation({
    mutationFn: (name) => client.disableAgentPlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      addToast(`Plugin "${data.name}" disabled — panel server is restarting...`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const uninstallMutation = useMutation({
    mutationFn: (name) => client.uninstallAgentPlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      addToast(`Plugin "${data.name}" uninstalled`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: (name) => client.updateAgentPlugin(name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plugins'] });
      queryClient.invalidateQueries({ queryKey: ['agent-plugin-updates'] });
      const p = data.plugin || data;
      addToast(`Plugin "${p.name || 'unknown'}" updated to v${p.version || '?'}`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const isActing =
    installMutation.isPending ||
    enableMutation.isPending ||
    disableMutation.isPending ||
    uninstallMutation.isPending ||
    updateMutation.isPending;

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

  const handleUpdate = useCallback((name) => updateMutation.mutate(name), [updateMutation]);

  const plugins = pluginsQuery.data?.plugins;
  const installedNames = new Set((plugins || []).map((p) => p.packageName));

  // If a plugin panel is open, show it
  if (openPlugin) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <AgentPluginPanel
          pluginName={openPlugin}
          client={client}
          onBack={() => setOpenPlugin(null)}
          subPath=""
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Plugins</h1>
          <p className="text-zinc-500 text-sm mt-1">Install, enable, and manage agent plugins</p>
        </div>
        {panelRunning && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Server running
            </span>
            <button
              type="button"
              disabled={stopPanelMutation.isPending}
              onClick={() => stopPanelMutation.mutate()}
              className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Square size={10} />
              {stopPanelMutation.isPending ? 'Stopping...' : 'Stop'}
            </button>
          </div>
        )}
      </div>

      {/* Panel server not running */}
      {pluginsQuery.isError ? (
        <PanelNotRunning
          onStart={() => startPanelMutation.mutate()}
          isStarting={startPanelMutation.isPending}
        />
      ) : (
        <>
          {/* Custom install form */}
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5 mb-8">
            <h2 className="text-sm font-semibold text-zinc-300 mb-4">Install Custom Plugin</h2>
            <InstallForm onInstall={handleInstall} isInstalling={installMutation.isPending} />
            {installMutation.isPending && (
              <p className="text-xs text-zinc-500 mt-2">Installing...</p>
            )}
          </div>

          {/* Unified plugin grid: installed first, then available */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-zinc-300 mb-3">Plugins</h2>
            {pluginsQuery.isLoading ? (
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
                {plugins?.map((plugin) => (
                  <PluginCard
                    key={plugin.name}
                    plugin={plugin}
                    onEnable={handleEnable}
                    onDisable={handleDisable}
                    onUninstall={handleUninstall}
                    onOpen={(name) => (onOpenPlugin ? onOpenPlugin(name) : setOpenPlugin(name))}
                    onUpdate={handleUpdate}
                    updateInfo={updateInfoMap[plugin.name]}
                    isActing={isActing}
                    isUpdating={updateMutation.isPending}
                  />
                ))}
                {/* Available but not yet installed */}
                {KNOWN_PLUGINS.filter((kp) => !installedNames.has(kp.packageName)).map((plugin) => (
                  <AvailablePluginCard
                    key={plugin.name}
                    plugin={plugin}
                    installed={false}
                    onInstall={handleInstall}
                    isInstalling={installMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
