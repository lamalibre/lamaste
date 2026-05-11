import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Terminal,
  Rocket,
  Server,
  Globe,
  Info,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Step definitions for progress display
// ---------------------------------------------------------------------------

const INSTALL_STEPS = [
  { key: 'check_node', label: 'Checking Node.js' },
  { key: 'install_agent_cli', label: 'Installing lamaste-agent' },
  { key: 'create_directories', label: 'Creating directories' },
  { key: 'generate_keypair', label: 'Generating keypair' },
  { key: 'enroll_panel', label: 'Enrolling with panel' },
  { key: 'create_agent_dirs', label: 'Creating agent directories' },
  { key: 'import_cert', label: 'Storing certificate' },
  { key: 'save_ca', label: 'Saving CA certificate' },
  { key: 'verify_connectivity', label: 'Verifying connectivity' },
  { key: 'install_chisel', label: 'Installing Chisel' },
  { key: 'fetch_config', label: 'Fetching configuration' },
  { key: 'write_service', label: 'Writing service config' },
  { key: 'unload_previous', label: 'Unloading previous agent' },
  { key: 'load_service', label: 'Starting agent' },
  { key: 'verify_running', label: 'Verifying agent' },
  { key: 'save_config', label: 'Saving configuration' },
];

const LABEL_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?$/;

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

const DEFAULT_CAPABILITIES = ['tunnels:read', 'tunnels:write', 'services:read'];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <span className="text-cyan-400 font-mono inline-block w-[1ch]">{SPINNER_FRAMES[frame]}</span>;
}

// ---------------------------------------------------------------------------
// Step 0: Server Selection
// ---------------------------------------------------------------------------

function ServerSelectionStep({
  servers,
  serversLoading,
  serverSource,
  setServerSource,
  selectedServerId,
  setSelectedServerId,
  manualPanelUrl,
  setManualPanelUrl,
  manualToken,
  setManualToken,
  label,
  setLabel,
}) {
  const handleServerChange = (serverId) => {
    setSelectedServerId(serverId);
    const server = servers.find((s) => s.id === serverId);
    if (server && !label) {
      setLabel(server.label || '');
    }
  };

  const handleSourceChange = (source) => {
    setServerSource(source);
    if (source === 'manual') {
      setSelectedServerId(null);
    }
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded bg-zinc-950 border border-zinc-800 p-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-cyan-400 font-medium mb-1.5">What will be installed</p>
            <ul className="text-zinc-400 space-y-1 leading-relaxed">
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>lamaste-agent CLI (via npm, if not already installed)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>mTLS certificate enrolled with your server</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>Chisel tunnel client as a system service</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Server source selection */}
      <div className="space-y-2">
        <label className="block text-xs text-zinc-400 mb-1">Connect to</label>

        {servers.length > 0 && (
          <label
            className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer ${
              serverSource === 'managed'
                ? 'border-cyan-400/40 bg-cyan-400/5'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <input
              type="radio"
              name="serverSource"
              checked={serverSource === 'managed'}
              onChange={() => handleSourceChange('managed')}
              className="text-cyan-400 focus:ring-cyan-400"
            />
            <Server size={12} className={serverSource === 'managed' ? 'text-cyan-400' : 'text-zinc-500'} />
            <span className={serverSource === 'managed' ? 'text-zinc-200' : 'text-zinc-400'}>
              Select a managed server
            </span>
          </label>
        )}

        <label
          className={`flex items-center gap-2 p-2.5 rounded border cursor-pointer ${
            serverSource === 'manual'
              ? 'border-cyan-400/40 bg-cyan-400/5'
              : 'border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <input
            type="radio"
            name="serverSource"
            checked={serverSource === 'manual'}
            onChange={() => handleSourceChange('manual')}
            className="text-cyan-400 focus:ring-cyan-400"
          />
          <Globe size={12} className={serverSource === 'manual' ? 'text-cyan-400' : 'text-zinc-500'} />
          <span className={serverSource === 'manual' ? 'text-zinc-200' : 'text-zinc-400'}>
            Enter URL manually
          </span>
        </label>
      </div>

      {/* Managed server dropdown */}
      {serverSource === 'managed' && servers.length > 0 && (
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Server</label>
          <select
            value={selectedServerId || ''}
            onChange={(e) => handleServerChange(e.target.value)}
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-400"
          >
            <option value="" disabled>
              {serversLoading ? 'Loading servers...' : 'Select a server'}
            </option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.panel_url})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Manual URL + token */}
      {serverSource === 'manual' && (
        <>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Panel URL</label>
            <input
              type="text"
              value={manualPanelUrl}
              onChange={(e) => setManualPanelUrl(e.target.value)}
              placeholder="https://1.2.3.4:9292"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Enrollment token</label>
            <input
              type="password"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Paste enrollment token from panel"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
            />
          </div>
        </>
      )}

      {/* Agent label */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Agent label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase())}
          placeholder="my-server"
          className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400"
        />
        {label && !LABEL_REGEX.test(label) && (
          <p className="text-red-400 text-[10px] mt-1">
            Lowercase letters, numbers, and hyphens only. Must start/end with a letter or number.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Installation Progress
// ---------------------------------------------------------------------------

function ProgressStep({ installing, installError, installSuccess }) {
  const currentIdx = INSTALL_STEPS.findIndex((s) => s.key === installing);

  return (
    <div className="space-y-2">
      {INSTALL_STEPS.map((step, stepIdx) => {
        const isPast = installSuccess || (currentIdx >= 0 && currentIdx > stepIdx);
        const isCurrent = installing === step.key;

        return (
          <div key={step.key} className="flex items-center gap-2 text-xs">
            {isCurrent && installError ? (
              <XCircle size={12} className="text-red-400" />
            ) : isCurrent ? (
              <Loader2 size={12} className="animate-spin text-cyan-400" />
            ) : isPast ? (
              <CheckCircle2 size={12} className="text-green-400" />
            ) : (
              <div className="w-3 h-3 rounded-full border border-zinc-700" />
            )}
            <span
              className={
                isCurrent && installError
                  ? 'text-red-400'
                  : isCurrent
                    ? 'text-cyan-400'
                    : isPast
                      ? 'text-zinc-400'
                      : 'text-zinc-600'
              }
            >
              {step.label}
            </span>
          </div>
        );
      })}

      {installing && !installError && !installSuccess && (
        <div className="mt-3 rounded bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-xs flex items-center gap-2">
          <BrailleSpinner />
          <span className="text-zinc-500">$</span>
          <span className="text-zinc-300">lamaste-agent setup</span>
        </div>
      )}

      {installError && (
        <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{installError}</p>
        </div>
      )}

      {installSuccess && (
        <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-400" />
            <p className="text-xs text-green-400 font-medium">Agent installed and connected!</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export default function InstallAgentWizard({ onClose }) {
  const queryClient = useQueryClient();

  const [wizardStep, setWizardStep] = useState(0);
  const [serverSource, setServerSource] = useState('manual');
  const [selectedServerId, setSelectedServerId] = useState(null);
  const [manualPanelUrl, setManualPanelUrl] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [label, setLabel] = useState('');
  const [installing, setInstalling] = useState(null);
  const [installError, setInstallError] = useState(null);
  const [installSuccess, setInstallSuccess] = useState(false);
  const [tokenGenerating, setTokenGenerating] = useState(false);
  // Cache managed-server token + URL so retries reuse the same token
  const managedTokenRef = useRef(null);

  const serversQuery = useQuery({
    queryKey: ['servers'],
    queryFn: () => invoke('get_servers'),
    staleTime: 30000,
  });

  const servers = serversQuery.data || [];

  // Auto-select managed mode if servers exist on initial load
  const initialSourceRef = useRef(false);
  useEffect(() => {
    if (!initialSourceRef.current && servers.length > 0) {
      initialSourceRef.current = true;
      setServerSource('managed');
    }
  }, [servers.length]);

  // Listen for agent-install-progress events from the Rust backend
  useEffect(() => {
    const unlisten = listen('agent-install-progress', (event) => {
      const { step: s, status } = event.payload;
      if (s && (status === 'running' || status === 'complete' || status === 'skipped')) {
        setInstalling(s);
        // Token was consumed by enrollment — clear cache so retry creates a fresh one
        if (s === 'enroll_panel' && status === 'complete') {
          managedTokenRef.current = null;
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const canProceed = () => {
    if (!label || !LABEL_REGEX.test(label)) return false;
    if (serverSource === 'managed') {
      return !!selectedServerId;
    }
    return manualPanelUrl.startsWith('https://') && manualToken.length > 0;
  };

  /**
   * Resolve credentials (panelUrl + token), then launch the install.
   */
  const startInstall = async () => {
    setWizardStep(1);
    setInstallError(null);
    setInstallSuccess(false);
    setInstalling(null);

    try {
      let panelUrl;
      let token;

      if (serverSource === 'managed') {
        // Reuse cached token on retry (avoids 409 "active token already exists")
        if (managedTokenRef.current && managedTokenRef.current.label === label
            && managedTokenRef.current.serverId === selectedServerId) {
          panelUrl = managedTokenRef.current.panelUrl;
          token = managedTokenRef.current.token;
        } else {
          // Auto-generate enrollment token from managed server
          setTokenGenerating(true);
          const server = servers.find((s) => s.id === selectedServerId);
          if (!server) {
            throw new Error('Selected server no longer available. Please try again.');
          }
          panelUrl = server.panelUrl;

          // Ensure this server is active for admin commands
          await invoke('set_active_server', { serverId: selectedServerId });

          // Revoke any stale token and agent cert from a previous failed attempt
          try {
            await invoke('admin_revoke_enrollment_token', { label });
          } catch {
            // Ignore — no stale token or endpoint not yet deployed
          }
          try {
            await invoke('admin_revoke_agent_cert', { label });
          } catch {
            // Ignore — no existing cert for this label
          }

          const result = await invoke('admin_create_enrollment_token', {
            data: { label, capabilities: DEFAULT_CAPABILITIES, allowedSites: [] },
          });
          token = result.token;
          managedTokenRef.current = { label, serverId: selectedServerId, panelUrl, token };
          setTokenGenerating(false);
        }
      } else {
        panelUrl = manualPanelUrl.replace(/\/+$/, '');
        token = manualToken.trim();
      }

      await runInstall(panelUrl, token);
    } catch (err) {
      setTokenGenerating(false);
      setInstallError(err.toString());
      revokeTokenOnFailure();
    }
  };

  /**
   * Run the actual agent install after credentials and Keychain are ready.
   */
  const runInstall = async (panelUrl, token) => {
    try {
      setInstalling(INSTALL_STEPS[0].key);
      await invoke('install_agent', { label, panelUrl, token });
      setInstallSuccess(true);
      setInstalling('save_config');
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (err) {
      setInstallError(err.toString());
      revokeTokenOnFailure();
    }
  };

  /** Best-effort revoke of managed-server enrollment token on failure. */
  const revokeTokenOnFailure = () => {
    if (serverSource === 'managed' && managedTokenRef.current) {
      invoke('admin_revoke_enrollment_token', { label: managedTokenRef.current.label }).catch(() => {});
      managedTokenRef.current = null;
    }
  };

  const stepIcons = [Server, Rocket];
  const stepLabels = ['Server', 'Install'];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Install Agent</h2>
          </div>
          <button
            onClick={onClose}
            disabled={installing && !installSuccess && !installError}
            className="text-zinc-500 hover:text-white disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-zinc-800">
          {stepLabels.map((s, i) => {
            const Icon = stepIcons[i];
            return (
              <div key={s} className="flex items-center gap-1">
                <div
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                    i === wizardStep
                      ? 'bg-cyan-400/10 text-cyan-400'
                      : i < wizardStep
                        ? 'text-green-400'
                        : 'text-zinc-600'
                  }`}
                >
                  <Icon size={10} />
                  {s}
                </div>
                {i < stepLabels.length - 1 && (
                  <ChevronRight size={12} className="text-zinc-700" />
                )}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-5 py-4 min-h-[240px] max-h-[420px] overflow-y-auto">
          {wizardStep === 0 && (
            <ServerSelectionStep
              servers={servers}
              serversLoading={serversQuery.isLoading}
              serverSource={serverSource}
              setServerSource={setServerSource}
              selectedServerId={selectedServerId}
              setSelectedServerId={setSelectedServerId}
              manualPanelUrl={manualPanelUrl}
              setManualPanelUrl={setManualPanelUrl}
              manualToken={manualToken}
              setManualToken={setManualToken}
              label={label}
              setLabel={setLabel}
            />
          )}
          {wizardStep === 1 && (
            tokenGenerating ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400 py-8 justify-center">
                <Loader2 size={14} className="animate-spin text-cyan-400" />
                Generating enrollment token...
              </div>
            ) : (
              <ProgressStep
                installing={installing}
                installError={installError}
                installSuccess={installSuccess}
              />
            )
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
          <div />

          {wizardStep === 0 ? (
            <button
              onClick={startInstall}
              disabled={!canProceed()}
              className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-30 flex items-center gap-1"
            >
              Install
              <ChevronRight size={12} />
            </button>
          ) : installSuccess ? (
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded bg-green-400/10 text-green-400 hover:bg-green-400/20 flex items-center gap-1"
            >
              <CheckCircle2 size={12} />
              Done
            </button>
          ) : installError ? (
            <button
              onClick={startInstall}
              className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>

    </div>
  );
}
