import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Shield,
  Loader2,
  ExternalLink,
  AlertTriangle,
  Download,
  RefreshCw,
  Globe,
  Check,
  SkipForward,
  X,
} from 'lucide-react';
import { useAgentClient } from '../context/AgentClientContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';

export default function SettingsPage({ agentLabel, onUninstalled }) {
  const client = useAgentClient();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [uninstallConfirm, setUninstallConfirm] = useState(false);
  const [uninstallNameInput, setUninstallNameInput] = useState('');
  const [uninstallSteps, setUninstallSteps] = useState(null);

  const configQuery = useQuery({
    queryKey: ['agent', 'config'],
    queryFn: () => client.getConfig(),
  });

  const rotateMutation = useMutation({
    mutationFn: () => client.rotateCertificate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'config'] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: () => client.downloadCertificate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'config'] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: () => client.uninstallAgent(),
    onSuccess: (data) => {
      queryClient.removeQueries({ queryKey: ['agent'] });
      setUninstallSteps(data?.steps || []);
    },
    onError: (err) => {
      toast(errorMessage(err) || 'Uninstall failed', 'error');
    },
  });

  const panelExposeQuery = useQuery({
    queryKey: ['agent', 'panel-expose-status'],
    queryFn: () => client.getPanelExposeStatus(),
  });

  const togglePanelMutation = useMutation({
    mutationFn: (enabled) => client.togglePanelExpose(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', 'panel-expose-status'] });
    },
  });

  const handleOpenPanel = async () => {
    try {
      const url = await client.getPanelUrl();
      await client.openExternal(url);
    } catch (err) {
      toast(err?.message || 'Failed to open panel', 'error');
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
              <label className="text-xs text-zinc-500 block mb-0.5">Auth Method</label>
              <p className="text-sm text-zinc-200 font-mono truncate">
                {config.authMethod === 'keychain'
                  ? 'Keychain (hardware-bound)'
                  : config.p12Path || 'P12'}
              </p>
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
          Opens the Lamaste web panel in your default browser (requires imported certificate).
        </p>
      </div>

      {/* Web Panel */}
      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3 flex items-center gap-2">
          <Globe size={14} className="text-cyan-400" />
          Web Panel
        </h2>
        {panelExposeQuery.isError ? (
          <p className="text-zinc-500 text-sm">
            Not available (agent may lack{' '}
            <span className="font-mono text-zinc-400">panel:expose</span> capability)
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-300">Expose management panel</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {panelExposeQuery.data?.enabled ? (
                    <>
                      Accessible at{' '}
                      <span className="font-mono text-cyan-400">{panelExposeQuery.data.fqdn}</span>
                    </>
                  ) : (
                    'Make this agent panel accessible via a web subdomain'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => togglePanelMutation.mutate(!panelExposeQuery.data?.enabled)}
                disabled={togglePanelMutation.isPending || panelExposeQuery.isPending}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  panelExposeQuery.data?.enabled ? 'bg-cyan-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    panelExposeQuery.data?.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {togglePanelMutation.isPending && (
              <div className="flex items-center gap-2 text-xs text-zinc-400 mt-2">
                <Loader2 size={12} className="animate-spin" />
                {panelExposeQuery.data?.enabled ? 'Retracting...' : 'Exposing...'}
              </div>
            )}
            {togglePanelMutation.isError && (
              <p className="text-red-400 text-xs mt-2">
                {togglePanelMutation.error?.message || 'Failed to toggle web panel'}
              </p>
            )}
          </>
        )}
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
            {rotateMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Rotate Certificate
          </button>
          <button
            onClick={() => downloadMutation.mutate()}
            disabled={rotateMutation.isPending || downloadMutation.isPending}
            className="flex items-center gap-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloadMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            Download Certificate
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Rotate generates a new certificate on the server and downloads it. Download re-fetches the
          current certificate.
        </p>
        {rotateMutation.isSuccess && (
          <p className="text-green-400 text-xs mt-2">
            Certificate rotated
            {rotateMutation.data?.expiresAt
              ? ` — expires ${new Date(rotateMutation.data.expiresAt).toLocaleDateString()}`
              : ''}
            .
            {rotateMutation.data?.warning && (
              <span className="text-amber-400"> Warning: {rotateMutation.data.warning}</span>
            )}
          </p>
        )}
        {rotateMutation.isError && (
          <p className="text-red-400 text-xs mt-2">
            {rotateMutation.error?.message || 'Rotation failed'}
          </p>
        )}
        {downloadMutation.isSuccess && (
          <p className="text-green-400 text-xs mt-2">
            Certificate saved to {downloadMutation.data}
          </p>
        )}
        {downloadMutation.isError && (
          <p className="text-red-400 text-xs mt-2">
            {downloadMutation.error?.message || 'Download failed'}
          </p>
        )}
      </div>

      {/* About */}
      <div className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-zinc-400 mb-3">About</h2>
        <p className="text-sm text-zinc-300">Lamaste Desktop v0.1.0</p>
        <p className="text-xs text-zinc-500 mt-1">Cross-platform tunnel agent with system tray</p>
      </div>

      {/* Danger Zone */}
      <div className="mt-4 bg-zinc-900 border border-red-500/30 rounded-lg p-5">
        <h2 className="text-xs font-medium uppercase text-red-400 mb-3 flex items-center gap-2">
          <AlertTriangle size={14} />
          Danger Zone
        </h2>
        {uninstallSteps ? (
          /* Post-uninstall: show step results */
          <div className="space-y-3">
            <p className="text-sm text-zinc-300 font-medium">
              Agent{' '}
              {agentLabel ? <span className="font-mono text-cyan-400">{agentLabel}</span> : ''}{' '}
              uninstalled
            </p>
            <div className="space-y-1.5">
              {uninstallSteps.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {s.status === 'complete' && (
                    <Check size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
                  )}
                  {s.status === 'skipped' && (
                    <SkipForward size={13} className="text-zinc-500 mt-0.5 flex-shrink-0" />
                  )}
                  {s.status === 'warning' && (
                    <AlertTriangle size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  )}
                  {s.status === 'failed' && (
                    <X size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    <span
                      className={
                        s.status === 'complete'
                          ? 'text-zinc-300'
                          : s.status === 'skipped'
                            ? 'text-zinc-500'
                            : s.status === 'warning'
                              ? 'text-amber-400'
                              : 'text-red-400'
                      }
                    >
                      {s.step}
                    </span>
                    <span className="text-zinc-600 ml-1.5">{s.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            {onUninstalled ? (
              <button
                onClick={onUninstalled}
                className="mt-2 rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
              >
                Done
              </button>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">
                Agent has been uninstalled. You can close this page.
              </p>
            )}
          </div>
        ) : !uninstallConfirm ? (
          <>
            <button
              onClick={() => {
                setUninstallConfirm(true);
                setUninstallNameInput('');
              }}
              className="flex items-center gap-2 rounded bg-red-600/20 border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-600/30"
            >
              Uninstall Agent
            </button>
            <p className="text-xs text-zinc-500 mt-2">
              Remove all Lamaste agent files including the chisel binary, configuration, and logs.
            </p>
          </>
        ) : (
          <div className="rounded bg-red-600/10 border border-red-500/30 p-4">
            <p className="text-sm text-red-300 mb-3">
              This will remove all Lamaste agent files including the chisel binary, configuration,
              and logs. This cannot be undone.
            </p>
            {agentLabel && (
              <div className="mb-3">
                <label className="text-xs text-zinc-400 block mb-1">
                  Type <span className="font-mono text-red-400">{agentLabel}</span> to confirm
                </label>
                <input
                  type="text"
                  value={uninstallNameInput}
                  onChange={(e) => setUninstallNameInput(e.target.value)}
                  placeholder={agentLabel}
                  className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-500/50"
                  autoFocus
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => uninstallMutation.mutate()}
                disabled={
                  uninstallMutation.isPending || (agentLabel && uninstallNameInput !== agentLabel)
                }
                className="flex items-center gap-2 rounded bg-red-600 hover:bg-red-500 px-4 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uninstallMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Uninstall
              </button>
              <button
                onClick={() => setUninstallConfirm(false)}
                disabled={uninstallMutation.isPending}
                className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {uninstallMutation.isError && (
              <p className="text-red-400 text-xs mt-2">
                {uninstallMutation.error?.message || 'Uninstall failed'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
