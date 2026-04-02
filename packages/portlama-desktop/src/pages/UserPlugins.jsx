import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Download,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Server,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { desktopUserAccessClient as client } from '../lib/desktop-user-access-client.js';
import { desktopLocalPluginClient as localClient } from '../lib/desktop-local-plugin-client.js';

function GrantCard({ grant, localPlugins, onInstall, onUninstall, isInstalling }) {
  const pluginName = grant.pluginName;
  const displayName = grant.plugin?.displayName || grant.plugin?.name || pluginName;
  const description = grant.plugin?.description || '';
  const target = grant.target || 'local';
  const isAgentSide = target.startsWith('agent:');

  // Agent-side grants: show "Open in Browser" instead of install/uninstall
  if (isAgentSide) {
    const agentLabel = grant.agentLabel || target.slice('agent:'.length);
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Package size={16} className="text-cyan-400" />
          <span className="text-white font-semibold">{displayName}</span>
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
            <Server size={10} />
            Agent: {agentLabel}
          </span>
        </div>
        {description && <p className="text-zinc-400 text-sm mb-2">{description}</p>}
        <p className="text-zinc-500 text-xs mb-4 font-mono">{pluginName}</p>

        <div className="flex gap-2">
          {grant.tunnelUrl ? (
            <button
              type="button"
              onClick={() => open(grant.tunnelUrl)}
              className="flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500"
            >
              <ExternalLink size={12} />
              Open in Browser
            </button>
          ) : (
            <span className="text-xs text-zinc-500">
              Tunnel not configured — contact administrator
            </span>
          )}
        </div>
      </div>
    );
  }

  // Local grants: existing behavior
  const isUsed = grant.used;
  const localPlugin = localPlugins?.find((p) => p.packageName === pluginName);
  const isInstalled = !!localPlugin;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Package size={16} className="text-cyan-400" />
        <span className="text-white font-semibold">{displayName}</span>
        {isInstalled && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
            Installed
          </span>
        )}
        {isUsed && !isInstalled && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">
            Used
          </span>
        )}
      </div>
      {description && <p className="text-zinc-400 text-sm mb-2">{description}</p>}
      <p className="text-zinc-500 text-xs mb-4 font-mono">{pluginName}</p>

      <div className="flex gap-2">
        {!isUsed && !isInstalled && (
          <button
            type="button"
            disabled={isInstalling}
            onClick={() => onInstall(grant.grantId, pluginName)}
            className="flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isInstalling ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            Install
          </button>
        )}
        {isInstalled && (
          <button
            type="button"
            onClick={() => onUninstall(localPlugin.name)}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600"
          >
            <Trash2 size={12} />
            Uninstall
          </button>
        )}
        {isUsed && !isInstalled && (
          <span className="text-xs text-zinc-500">Grant consumed — plugin may be installed on another device</span>
        )}
      </div>
    </div>
  );
}

export default function UserPlugins() {
  const queryClient = useQueryClient();
  const [installingGrant, setInstallingGrant] = useState(null);

  const { data: pluginsData, isLoading, error } = useQuery({
    queryKey: ['user-access-plugins'],
    queryFn: () => client.getPlugins(),
    refetchInterval: 10_000,
  });

  const { data: localPluginsData } = useQuery({
    queryKey: ['local-plugins'],
    queryFn: () => localClient.getPlugins(),
    refetchInterval: 10_000,
  });

  const installMutation = useMutation({
    mutationFn: async ({ grantId, packageName }) => {
      setInstallingGrant(grantId);
      return client.installPlugin(grantId, packageName);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-access-plugins'] });
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
      setInstallingGrant(null);
    },
    onError: () => {
      setInstallingGrant(null);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (name) => {
      // Disable first if enabled, then uninstall
      try {
        await localClient.disablePlugin(name);
      } catch {
        // May already be disabled
      }
      return localClient.uninstallPlugin(name);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local-plugins'] });
    },
  });

  const grants = pluginsData?.grants || [];
  const localPlugins = localPluginsData?.plugins || localPluginsData || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="rounded-lg bg-zinc-900 border border-red-500/20 p-6 text-center max-w-md">
          <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-400">{error?.toString() || 'Failed to load plugins'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-white">My Plugins</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Plugins granted to you by an administrator. Install locally or access agent-hosted plugins in your browser.
        </p>
      </div>

      {installMutation.error && (
        <div className="flex items-center gap-2 rounded bg-red-500/10 border border-red-500/20 px-3 py-2 mb-4">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <span className="text-xs text-red-400">
            {installMutation.error?.toString() || 'Installation failed'}
          </span>
        </div>
      )}

      {uninstallMutation.error && (
        <div className="flex items-center gap-2 rounded bg-red-500/10 border border-red-500/20 px-3 py-2 mb-4">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <span className="text-xs text-red-400">
            {uninstallMutation.error?.toString() || 'Uninstallation failed'}
          </span>
        </div>
      )}

      {installMutation.isSuccess && (
        <div className="flex items-center gap-2 rounded bg-green-500/10 border border-green-500/20 px-3 py-2 mb-4">
          <CheckCircle2 size={14} className="text-green-400 shrink-0" />
          <span className="text-xs text-green-400">Plugin installed successfully</span>
        </div>
      )}

      {grants.length === 0 ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
          <Package size={32} className="text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">No plugins have been granted to your account yet.</p>
          <p className="text-zinc-500 text-xs mt-1">
            Contact an administrator to request access.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {grants.map((grant) => (
            <GrantCard
              key={grant.grantId}
              grant={grant}
              localPlugins={localPlugins}
              onInstall={(grantId, packageName) =>
                installMutation.mutate({ grantId, packageName })
              }
              onUninstall={(name) => uninstallMutation.mutate(name)}
              isInstalling={installingGrant === grant.grantId && installMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
