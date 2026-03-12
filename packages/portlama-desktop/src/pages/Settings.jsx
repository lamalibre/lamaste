import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { Settings, Shield, Loader2, ExternalLink, AlertTriangle, Download, RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [uninstallConfirm, setUninstallConfirm] = useState(false);

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: () => invoke('get_config'),
  });

  const rotateMutation = useMutation({
    mutationFn: () => invoke('rotate_certificate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: () => invoke('download_certificate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: () => invoke('uninstall_agent'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  const handleOpenPanel = async () => {
    try {
      const url = await invoke('get_panel_url');
      await open(url);
    } catch {
      // ignore
    }
  };

  const config = configQuery.data;

  return (
    <div className="p-6">
      <h1 className="text-lg font-bold text-white mb-6">Settings</h1>

      {/* Configuration */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="text-xs font-medium uppercase text-zinc-400 flex items-center gap-2">
          <Settings size={14} className="text-cyan-400" />
          Configuration
        </h2>

        {config ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-0.5">Panel URL</label>
              <p className="text-sm text-zinc-200 font-mono">{config.panelUrl}</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-0.5">Domain</label>
              <p className="text-sm text-zinc-200 font-mono">{config.domain || 'N/A'}</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-0.5">Certificate</label>
              <p className="text-sm text-zinc-200 font-mono truncate">{config.p12Path}</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-0.5">Chisel Version</label>
              <p className="text-sm text-zinc-200 font-mono">{config.chiselVersion || 'N/A'}</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-0.5">Configured At</label>
              <p className="text-sm text-zinc-200">
                {config.setupAt ? new Date(config.setupAt).toLocaleString() : 'N/A'}
              </p>
            </div>
            {config.updatedAt && (
              <div>
                <label className="text-xs text-zinc-500 block mb-0.5">Last Updated</label>
                <p className="text-sm text-zinc-200">
                  {new Date(config.updatedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        ) : configQuery.isError ? (
          <p className="text-red-400 text-sm">Failed to load configuration</p>
        ) : (
          <p className="text-zinc-500 text-sm">Loading...</p>
        )}
      </div>

      {/* Panel Link */}
      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3 flex items-center gap-2">
          <ExternalLink size={14} className="text-cyan-400" />
          Panel
        </h2>
        <button
          onClick={handleOpenPanel}
          className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          <ExternalLink size={14} />
          Open Panel in Browser
        </button>
        <p className="text-xs text-zinc-500 mt-2">
          Opens the Portlama web panel in your default browser (requires imported certificate).
        </p>
      </div>

      {/* Certificate Management */}
      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3 flex items-center gap-2">
          <Shield size={14} className="text-cyan-400" />
          Certificate
        </h2>
        <div className="flex gap-3">
          <button
            onClick={() => rotateMutation.mutate()}
            disabled={rotateMutation.isPending || downloadMutation.isPending}
            className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rotateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Rotate Certificate
          </button>
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={rotateMutation.isPending || downloadMutation.isPending}
            className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloadMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download Certificate
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Rotate generates a new certificate on the server and downloads it. Download re-fetches the current certificate.
        </p>
        {rotateMutation.isSuccess && (
          <p className="text-green-400 text-xs mt-2">
            Certificate rotated{rotateMutation.data?.expiresAt ? ` — expires ${new Date(rotateMutation.data.expiresAt).toLocaleDateString()}` : ''}.
            {rotateMutation.data?.warning && <span className="text-amber-400"> Warning: {rotateMutation.data.warning}</span>}
          </p>
        )}
        {rotateMutation.isError && (
          <p className="text-red-400 text-xs mt-2">{rotateMutation.error?.message || 'Rotation failed'}</p>
        )}
        {downloadMutation.isSuccess && (
          <p className="text-green-400 text-xs mt-2">Certificate saved to {downloadMutation.data}</p>
        )}
        {downloadMutation.isError && (
          <p className="text-red-400 text-xs mt-2">{downloadMutation.error?.message || 'Download failed'}</p>
        )}
      </div>

      {/* About */}
      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3">About</h2>
        <p className="text-sm text-zinc-300">Portlama Desktop v0.1.0</p>
        <p className="text-xs text-zinc-500 mt-1">
          Cross-platform tunnel agent with system tray
        </p>
      </div>

      {/* Danger Zone */}
      <div className="mt-4 bg-zinc-900 border border-red-500/30 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-red-400 mb-3 flex items-center gap-2">
          <AlertTriangle size={14} />
          Danger Zone
        </h2>
        {!uninstallConfirm ? (
          <>
            <button
              onClick={() => setUninstallConfirm(true)}
              className="flex items-center gap-2 rounded bg-red-600/20 border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-600/30"
            >
              Uninstall Agent
            </button>
            <p className="text-xs text-zinc-500 mt-2">
              Remove all Portlama agent files including the chisel binary, configuration, and logs.
            </p>
          </>
        ) : (
          <div className="rounded bg-red-600/10 border border-red-500/30 p-4">
            <p className="text-sm text-red-300 mb-3">
              This will remove all Portlama agent files including the chisel binary, configuration, and logs. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => uninstallMutation.mutate()}
                disabled={uninstallMutation.isPending}
                className="flex items-center gap-2 rounded bg-red-600 hover:bg-red-500 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {uninstallMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Uninstall
              </button>
              <button
                onClick={() => setUninstallConfirm(false)}
                className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
            {uninstallMutation.isError && (
              <p className="text-red-400 text-xs mt-2">{uninstallMutation.error?.message || 'Uninstall failed'}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
