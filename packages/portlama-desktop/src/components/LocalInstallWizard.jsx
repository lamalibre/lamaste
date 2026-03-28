import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import {
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  HardDrive,
  Rocket,
  Info,
  Shield,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Step definitions for progress display
// ---------------------------------------------------------------------------

const INSTALL_STEPS = [
  { key: 'check_environment', label: 'Checking environment', cmd: 'detect-os && detect-ip' },
  { key: 'harden_system', label: 'Hardening system', cmd: 'ufw + fail2ban + ssh-harden' },
  { key: 'install_node', label: 'Installing Node.js 20', cmd: 'apt install nodejs' },
  { key: 'generate_certs', label: 'Generating mTLS certificates', cmd: 'openssl genrsa + pkcs12' },
  { key: 'configure_nginx', label: 'Configuring nginx', cmd: 'nginx sites-enabled' },
  { key: 'deploy_panel', label: 'Deploying panel', cmd: 'npm install + systemctl start' },
  { key: 'import_certs', label: 'Importing certificates', cmd: 'cp client.p12 ~/.portlama/' },
  { key: 'save_registry', label: 'Saving configuration', cmd: 'write servers.json' },
];

const REDEPLOY_STEPS = [
  { key: 'check_environment', label: 'Checking environment', cmd: 'detect-os && detect-ip' },
  { key: 'redeploy_panel', label: 'Redeploying panel', cmd: 'npm install + systemctl restart' },
  { key: 'import_certs', label: 'Importing certificates', cmd: 'cp client.p12 ~/.portlama/' },
  { key: 'save_registry', label: 'Saving configuration', cmd: 'write servers.json' },
];

const IMPORT_STEPS = [
  { key: 'import_certs', label: 'Importing certificates', cmd: 'cp client.p12 ~/.portlama/' },
  { key: 'save_registry', label: 'Saving configuration', cmd: 'write servers.json' },
];

const LABEL_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <span className="text-cyan-400 font-mono inline-block w-[1ch]">{SPINNER_FRAMES[frame]}</span>;
}

// ---------------------------------------------------------------------------
// Step 0: Overview
// ---------------------------------------------------------------------------

function OverviewStep({ existingInstall, label, setLabel, skipHarden, setSkipHarden }) {
  return (
    <div className="space-y-3 text-xs">
      {existingInstall && (
        <div className="rounded bg-amber-500/5 border border-amber-500/20 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-400 font-medium mb-1">Existing installation detected</p>
              <p className="text-zinc-400 leading-relaxed">
                A Portlama installation was found at <code className="text-zinc-300">/etc/portlama/</code>.
                You can import it into the desktop app without reinstalling, or run the installer
                to update the panel files.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded bg-zinc-950 border border-zinc-800 p-3">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-cyan-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-cyan-400 font-medium mb-1.5">What will be installed</p>
            <ul className="text-zinc-400 space-y-1 leading-relaxed">
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>nginx reverse proxy with mTLS client certificates</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>Portlama panel server and client (Node.js 20)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>UFW firewall rules (ports 22, 80, 443, 9292)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>fail2ban intrusion prevention</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-zinc-600 select-none">&#8226;</span>
                <span>1GB swap file and SSH hardening</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded bg-amber-500/5 border border-amber-500/20 p-3">
        <div className="flex items-start gap-2">
          <Shield size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-400 font-medium mb-1">Requires root access</p>
            <p className="text-zinc-400 leading-relaxed">
              The installer runs via <code className="text-zinc-300">pkexec</code> and will prompt for your
              password. System services, firewall rules, and certificates require root privileges.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Server label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value.toLowerCase())}
            placeholder="local"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-400"
          />
          {label && !LABEL_REGEX.test(label) && (
            <p className="text-red-400 text-[10px] mt-1">
              Lowercase letters, numbers, and hyphens only. Must start/end with a letter or number.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={skipHarden}
            onChange={(e) => setSkipHarden(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-800 text-cyan-400 focus:ring-cyan-400"
          />
          Skip OS hardening (swap, UFW, fail2ban, SSH)
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Progress
// ---------------------------------------------------------------------------

function ProgressStep({ steps, installing, installError, installSuccess }) {
  const currentIdx = steps.findIndex((s) => s.key === installing);
  const currentStep = currentIdx >= 0 ? steps[currentIdx] : null;

  return (
    <div className="space-y-2">
      {steps.map((step, stepIdx) => {
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

      {currentStep && !installError && !installSuccess && (
        <div className="mt-3 rounded bg-zinc-950 border border-zinc-800 px-3 py-2 font-mono text-xs flex items-center gap-2">
          <BrailleSpinner />
          <span className="text-zinc-500">$</span>
          <span className="text-zinc-300">{currentStep.cmd}</span>
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
            <p className="text-xs text-green-400 font-medium">Server installed successfully!</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Wizard
// ---------------------------------------------------------------------------

export default function LocalInstallWizard({ existingInstall, onClose }) {
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [label, setLabel] = useState('local');
  const [skipHarden, setSkipHarden] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [installError, setInstallError] = useState(null);
  const [installSuccess, setInstallSuccess] = useState(false);
  const [activeSteps, setActiveSteps] = useState(INSTALL_STEPS);
  const [lastAction, setLastAction] = useState(null); // 'install' or 'import'

  // Listen for local-install-progress events from the Rust backend
  useEffect(() => {
    const unlisten = listen('local-install-progress', (event) => {
      const { step: s, status } = event.payload;
      if (s && (status === 'running' || status === 'complete')) {
        setInstalling(s);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const startInstall = async () => {
    setLastAction('install');
    const steps = existingInstall ? REDEPLOY_STEPS : INSTALL_STEPS;
    setActiveSteps(steps);
    setStep(1);
    setInstalling(steps[0].key);
    setInstallError(null);
    setInstallSuccess(false);

    try {
      await invoke('start_local_install', {
        label: label || 'local',
        skipHarden,
      });
      setInstallSuccess(true);
      setInstalling('save_registry');
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['local-install-available'] });
    } catch (err) {
      setInstallError(err.toString());
    }
  };

  const startImport = async () => {
    setLastAction('import');
    setActiveSteps(IMPORT_STEPS);
    setStep(1);
    setInstalling(IMPORT_STEPS[0].key);
    setInstallError(null);
    setInstallSuccess(false);

    try {
      await invoke('import_existing_local_install', {
        label: label || 'local',
      });
      setInstallSuccess(true);
      setInstalling('save_registry');
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['local-install-available'] });
    } catch (err) {
      setInstallError(err.toString());
    }
  };

  const canProceed = () => {
    const l = label || 'local';
    return LABEL_REGEX.test(l);
  };

  const stepIcons = [Info, Rocket];
  const stepLabels = ['Setup', 'Install'];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <HardDrive size={14} className="text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Install Local Server</h2>
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
                    i === step
                      ? 'bg-cyan-400/10 text-cyan-400'
                      : i < step
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
          {step === 0 && (
            <OverviewStep
              existingInstall={existingInstall}
              label={label}
              setLabel={setLabel}
              skipHarden={skipHarden}
              setSkipHarden={setSkipHarden}
            />
          )}
          {step === 1 && (
            <ProgressStep
              steps={activeSteps}
              installing={installing}
              installError={installError}
              installSuccess={installSuccess}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
          <div>
            {step === 0 && existingInstall && (
              <button
                onClick={startImport}
                disabled={!canProceed()}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-30 flex items-center gap-1"
              >
                Import Existing
              </button>
            )}
          </div>

          {step === 0 ? (
            <button
              onClick={startInstall}
              disabled={!canProceed()}
              className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-30 flex items-center gap-1"
            >
              {existingInstall ? 'Update & Import' : 'Install'}
              <ChevronRight size={12} />
            </button>
          ) : installSuccess ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => open('https://127.0.0.1:9292')}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 flex items-center gap-1"
              >
                <ExternalLink size={10} />
                Open Panel
              </button>
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded bg-green-400/10 text-green-400 hover:bg-green-400/20 flex items-center gap-1"
              >
                <CheckCircle2 size={12} />
                Done
              </button>
            </div>
          ) : installError ? (
            <button
              onClick={lastAction === 'import' ? startImport : startInstall}
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
