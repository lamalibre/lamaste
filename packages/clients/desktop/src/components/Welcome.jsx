import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Terminal,
  Cloud,
  Search,
  Plus,
  HardDrive,
  Monitor,
  LogIn,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Loader2,
  ExternalLink,
  X,
  Rocket,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import CreateServerWizard from './CreateServerWizard.jsx';
import DiscoverServerWizard from './DiscoverServerWizard.jsx';
import AddManagedServer from './AddManagedServer.jsx';
import LocalInstallWizard from './LocalInstallWizard.jsx';
import { desktopUserAccessClient as userAccessClient } from '../lib/desktop-user-access-client.js';

const LABEL_REGEX = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?$/;

const AGENT_INSTALL_STEPS = [
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

function normalizeAddress(input) {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = url.hostname;
    return host.startsWith('panel.') ? host.slice(6) : host;
  } catch {
    return trimmed;
  }
}

function FadeIn({ children, className = '' }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`transition-all duration-300 ease-out ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      } ${className}`}
    >
      {children}
    </div>
  );
}

function PathCard({ icon: Icon, title, description, action, disabled, disabledHint }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : action}
      disabled={disabled}
      className={`group relative text-left rounded-lg border p-5 transition-all duration-200 ${
        disabled
          ? 'border-zinc-800 bg-zinc-900/40 cursor-not-allowed opacity-50'
          : 'border-zinc-800 bg-zinc-900 hover:border-cyan-400/50 hover:shadow-lg hover:shadow-cyan-400/5'
      }`}
    >
      {!disabled && (
        <ArrowRight
          size={14}
          className="absolute top-5 right-5 text-zinc-700 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition"
        />
      )}
      <div className="flex items-start gap-3 pr-7">
        <div
          className={`rounded-md p-2.5 transition ${
            disabled
              ? 'bg-zinc-800/50 text-zinc-600'
              : 'bg-cyan-400/10 text-cyan-400 group-hover:bg-cyan-400/15'
          }`}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            {disabled && disabledHint && (
              <span className="text-[10px] text-zinc-500 border border-zinc-800 rounded px-1.5 py-0.5">
                {disabledHint}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">{description}</p>
        </div>
      </div>
    </button>
  );
}

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-cyan-400 transition"
    >
      <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition" />
      Back
    </button>
  );
}

function CloseButton({ onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Skip onboarding"
      aria-label="Skip onboarding"
      className={`p-2 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/80 transition focus:outline-none focus:ring-2 focus:ring-cyan-400/40 ${className}`}
    >
      <X size={16} />
    </button>
  );
}

export default function Welcome({ onSkip }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState('landing');
  const [mode, setMode] = useState('idle'); // 'idle' | 'url' | 'waiting'
  const [addressInput, setAddressInput] = useState('');
  const [signInError, setSignInError] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);
  const [activeDomain, setActiveDomain] = useState('');

  const [agentLabel, setAgentLabel] = useState('');
  const [agentPanelUrl, setAgentPanelUrl] = useState('');
  const [agentToken, setAgentToken] = useState('');
  const [agentInstallStep, setAgentInstallStep] = useState(null);
  const [agentInstallError, setAgentInstallError] = useState(null);
  const [agentInstallSuccess, setAgentInstallSuccess] = useState(false);

  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [showDiscoverWizard, setShowDiscoverWizard] = useState(false);
  const [showAddManaged, setShowAddManaged] = useState(false);
  const [showLocalInstall, setShowLocalInstall] = useState(false);

  useEffect(() => {
    let unlisten;
    listen('agent-install-progress', (event) => {
      const { step, status } = event.payload || {};
      if (step && (status === 'running' || status === 'complete' || status === 'skipped')) {
        setAgentInstallStep(step);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const localInstallQuery = useQuery({
    queryKey: ['local-install-available'],
    queryFn: () => invoke('check_local_install_available'),
    staleTime: 60000,
  });

  const localAvailable =
    !!localInstallQuery.data?.available && !localInstallQuery.data?.alreadyInRegistry;
  const localHint =
    localInstallQuery.data?.platform === 'macos'
      ? 'Linux only'
      : localInstallQuery.data?.alreadyInRegistry
        ? 'Installed'
        : undefined;

  const startSignIn = () => {
    setSignInError('');
    setMode('url');
  };

  const cancelSignIn = () => {
    setMode('idle');
    setSignInError('');
    setSignInLoading(false);
  };

  const handleContinue = async () => {
    const domain = normalizeAddress(addressInput);
    if (!domain) {
      setSignInError('Enter the link or address your administrator sent you.');
      return;
    }
    setSignInError('');
    setSignInLoading(true);
    try {
      await userAccessClient.startLogin(domain);
      setActiveDomain(domain);
      setMode('waiting');
    } catch (err) {
      setSignInError(err?.toString() || 'Could not open your browser.');
    } finally {
      setSignInLoading(false);
    }
  };

  const cancelWaiting = () => {
    setMode('url');
    setSignInLoading(false);
  };

  const handleAddressKeyDown = (e) => {
    if (e.key === 'Enter') handleContinue();
    if (e.key === 'Escape') cancelSignIn();
  };

  const agentInstalling = agentInstallStep !== null && !agentInstallSuccess && !agentInstallError;
  const labelValid = agentLabel.length > 0 && LABEL_REGEX.test(agentLabel);
  const canInstallAgent =
    labelValid && agentPanelUrl.trim().startsWith('https://') && agentToken.trim().length > 0;

  const handleInstallAgent = async (e) => {
    e?.preventDefault();
    if (!canInstallAgent || agentInstalling) return;
    setAgentInstallError(null);
    setAgentInstallSuccess(false);
    setAgentInstallStep(AGENT_INSTALL_STEPS[0].key);
    try {
      await invoke('install_agent', {
        label: agentLabel,
        panelUrl: agentPanelUrl.trim().replace(/\/+$/, ''),
        token: agentToken.trim(),
      });
      setAgentInstallSuccess(true);
      setAgentInstallStep('save_config');
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (err) {
      setAgentInstallError(err?.toString() || 'Install failed.');
    }
  };

  const anyWizardOpen =
    showCreateWizard || showDiscoverWizard || showAddManaged || showLocalInstall;

  return (
    <>
      {onSkip && !anyWizardOpen && view === 'landing' && (
        <CloseButton onClick={onSkip} className="fixed top-3 right-3 z-40" />
      )}

      {view === 'landing' && (
        <div className="min-h-screen flex flex-col bg-zinc-950 relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/4 h-[420px] bg-cyan-400/5 blur-3xl"
          />

          <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative">
            <div className="flex items-center gap-3 mb-3">
              <Terminal size={32} className="text-cyan-400" />
              <h1 className="text-4xl font-bold text-white tracking-tight">Welcome to Lamaste</h1>
            </div>
            <p className="text-sm text-zinc-400 max-w-md text-center leading-relaxed mb-10">
              Self-hosted secure tunneling without touching SSH.
            </p>

            <div className="w-full max-w-md min-h-[200px] flex flex-col items-center">
              {mode === 'idle' && (
                <FadeIn key="idle" className="flex flex-col items-center">
                  <button
                    type="button"
                    autoFocus
                    onClick={startSignIn}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-cyan-400 px-10 py-3 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 transition shadow-lg shadow-cyan-400/20 min-w-[280px] focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
                  >
                    <LogIn size={16} />
                    Sign in
                  </button>
                  <p className="text-xs text-zinc-500 mt-3 text-center max-w-xs">
                    Use the invite link your administrator sent you.
                  </p>
                </FadeIn>
              )}

              {mode === 'url' && (
                <FadeIn key="url" className="w-full">
                  <div className="space-y-3">
                    <input
                      type="text"
                      autoFocus
                      value={addressInput}
                      onChange={(e) => setAddressInput(e.target.value)}
                      onKeyDown={handleAddressKeyDown}
                      placeholder="https://panel.example.com"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 transition"
                    />

                    {signInError && (
                      <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                        <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                        <span className="text-xs text-red-400 leading-relaxed">{signInError}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={signInLoading || !addressInput.trim()}
                      onClick={handleContinue}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-cyan-400/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
                    >
                      {signInLoading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <LogIn size={16} />
                      )}
                      Continue
                    </button>
                  </div>

                  <p className="text-[11px] text-zinc-600 leading-relaxed text-center mt-4">
                    A link, a URL, or just the domain — we&apos;ll figure it out.
                  </p>

                  <div className="mt-5 text-center">
                    <button
                      type="button"
                      onClick={cancelSignIn}
                      className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-cyan-400 transition"
                    >
                      <ArrowLeft size={12} />
                      Back
                    </button>
                  </div>
                </FadeIn>
              )}

              {mode === 'waiting' && (
                <FadeIn key="waiting" className="w-full">
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center rounded-full bg-cyan-400/10 p-4 mb-4">
                      <Loader2 size={28} className="text-cyan-400 animate-spin" />
                    </div>
                    <h2 className="text-lg font-bold text-white mb-2 tracking-tight">
                      Finish signing in your browser
                    </h2>
                    <p className="text-sm text-zinc-400 leading-relaxed max-w-xs mx-auto">
                      We&apos;ll continue automatically once you&apos;re authenticated.
                    </p>
                    {activeDomain && (
                      <p className="text-xs text-zinc-500 mt-3 inline-flex items-center gap-1.5">
                        <ExternalLink size={11} />
                        Signing in to{' '}
                        <span className="text-zinc-300 font-medium">{activeDomain}</span>
                      </p>
                    )}
                    <div className="mt-6">
                      <button
                        type="button"
                        onClick={cancelWaiting}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </FadeIn>
              )}
            </div>
          </main>

          <footer className="border-t border-zinc-800/80 relative">
            <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setView('server')}
                className="group inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-cyan-400 transition"
              >
                <Cloud size={12} className="group-hover:text-cyan-400 transition" />
                Set up a server
                <ArrowRight
                  size={11}
                  className="text-zinc-700 group-hover:text-cyan-400 transition"
                />
              </button>
              <span className="text-[10px] uppercase tracking-wider text-zinc-700">
                Administrator?
              </span>
              <button
                type="button"
                onClick={() => setView('agent')}
                className="group inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-cyan-400 transition"
              >
                <Monitor size={12} className="group-hover:text-cyan-400 transition" />
                Connect a machine
                <ArrowRight
                  size={11}
                  className="text-zinc-700 group-hover:text-cyan-400 transition"
                />
              </button>
            </div>
          </footer>
        </div>
      )}

      {view === 'server' && (
        <FadeIn key="server-view">
          <div className="min-h-screen bg-zinc-950 overflow-y-auto relative">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-cyan-400/5 blur-3xl"
            />

            <div className="max-w-3xl mx-auto px-6 py-12 relative">
              <div className="flex items-center justify-between mb-8">
                <BackButton onClick={() => setView('landing')} />
                {onSkip && <CloseButton onClick={onSkip} className="-mr-2" />}
              </div>

              <header className="text-center mb-10">
                <div className="inline-flex items-center justify-center rounded-full bg-cyan-400/10 p-3 mb-4">
                  <Cloud size={24} className="text-cyan-400" />
                </div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  Set up a server
                </h1>
                <p className="text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
                  A Lamaste server runs the panel, terminates TLS, and routes tunnels. Pick
                  whichever fits where it should live.
                </p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PathCard
                  icon={Cloud}
                  title="Create on DigitalOcean"
                  description="Spin up a new droplet with Lamaste pre-installed. A $6/mo box is enough to run the panel and a handful of tunnels."
                  action={() => setShowCreateWizard(true)}
                />
                <PathCard
                  icon={Search}
                  title="Discover existing droplets"
                  description="Already have Lamaste running on DO? Paste a token and we'll find the tagged droplets and register them."
                  action={() => setShowDiscoverWizard(true)}
                />
                <PathCard
                  icon={Plus}
                  title="Add an existing server"
                  description="Connect to a Lamaste panel by URL. Useful when the server lives elsewhere — a colleague's box, a home lab, a different provider."
                  action={() => setShowAddManaged(true)}
                />
                <PathCard
                  icon={HardDrive}
                  title="Install locally"
                  description="Turn this Linux machine into a Lamaste server. Uses your sudo password once, then runs as a system service."
                  action={() => setShowLocalInstall(true)}
                  disabled={!localAvailable}
                  disabledHint={localHint}
                />
              </div>

              <div className="mt-10 pt-6 border-t border-zinc-800/80 flex justify-center">
                <button
                  type="button"
                  onClick={() => setView('agent')}
                  className="group inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-cyan-400 transition"
                >
                  <Monitor size={12} className="group-hover:text-cyan-400 transition" />
                  Connecting a machine instead?
                  <ArrowRight
                    size={11}
                    className="text-zinc-700 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition"
                  />
                </button>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {view === 'agent' && (
        <FadeIn key="agent-view">
          <div className="min-h-screen bg-zinc-950 overflow-y-auto relative">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-cyan-400/5 blur-3xl"
            />

            <div className="max-w-3xl mx-auto px-6 py-12 relative">
              <div className="flex items-center justify-between mb-8">
                <BackButton onClick={() => setView('landing')} />
                {onSkip && <CloseButton onClick={onSkip} className="-mr-2" />}
              </div>

              <header className="text-center mb-10">
                <div className="inline-flex items-center justify-center rounded-full bg-cyan-400/10 p-3 mb-4">
                  <Monitor size={24} className="text-cyan-400" />
                </div>
                <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
                  Connect a machine
                </h1>
                <p className="text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
                  Enroll this computer as an agent. Paste your panel URL and an enrollment token
                  from your Lamaste server.
                </p>
              </header>

              <form onSubmit={handleInstallAgent} className="max-w-md mx-auto">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                      Panel URL
                    </label>
                    <input
                      type="text"
                      value={agentPanelUrl}
                      onChange={(e) => setAgentPanelUrl(e.target.value)}
                      placeholder="https://panel.example.com"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      disabled={agentInstalling || agentInstallSuccess}
                      className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 transition disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                      Enrollment token
                    </label>
                    <input
                      type="password"
                      value={agentToken}
                      onChange={(e) => setAgentToken(e.target.value)}
                      placeholder="Paste the token from your panel"
                      disabled={agentInstalling || agentInstallSuccess}
                      className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 transition font-mono disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                      Label
                    </label>
                    <input
                      type="text"
                      value={agentLabel}
                      onChange={(e) => setAgentLabel(e.target.value.toLowerCase())}
                      placeholder="my-machine"
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      disabled={agentInstalling || agentInstallSuccess}
                      className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 transition disabled:opacity-60"
                    />
                    {agentLabel && !labelValid && (
                      <p className="text-red-400 text-[11px] mt-1.5">
                        Lowercase letters, numbers, and hyphens. Must start and end with a letter or
                        number.
                      </p>
                    )}
                  </div>

                  {agentInstallError && (
                    <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-red-400 leading-relaxed">
                        {agentInstallError}
                      </span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!canInstallAgent || agentInstalling || agentInstallSuccess}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-cyan-400/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
                  >
                    {agentInstalling ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : agentInstallSuccess ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Rocket size={16} />
                    )}
                    {agentInstallSuccess
                      ? 'Installed'
                      : agentInstalling
                        ? 'Installing…'
                        : 'Install agent'}
                  </button>
                </div>

                {agentInstallStep && (
                  <div className="mt-4 rounded-md bg-zinc-900 border border-zinc-800 p-3 flex items-center gap-3">
                    {agentInstallError ? (
                      <XCircle size={14} className="text-red-400 shrink-0" />
                    ) : agentInstallSuccess ? (
                      <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                    ) : (
                      <Loader2 size={14} className="animate-spin text-cyan-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-200 font-medium truncate">
                        {agentInstallSuccess
                          ? 'Connected'
                          : AGENT_INSTALL_STEPS.find((s) => s.key === agentInstallStep)?.label ||
                            'Starting…'}
                      </div>
                      {!agentInstallSuccess && !agentInstallError && (
                        <div className="text-[10px] text-zinc-500">
                          Step{' '}
                          {Math.max(
                            1,
                            AGENT_INSTALL_STEPS.findIndex((s) => s.key === agentInstallStep) + 1,
                          )}{' '}
                          of {AGENT_INSTALL_STEPS.length}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </form>

              <div className="mt-10 pt-6 border-t border-zinc-800/80 flex justify-center">
                <button
                  type="button"
                  onClick={() => setView('server')}
                  className="group inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-cyan-400 transition"
                >
                  <Cloud size={12} className="group-hover:text-cyan-400 transition" />
                  Setting up a server instead?
                  <ArrowRight
                    size={11}
                    className="text-zinc-700 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition"
                  />
                </button>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {showCreateWizard && <CreateServerWizard onClose={() => setShowCreateWizard(false)} />}
      {showDiscoverWizard && <DiscoverServerWizard onClose={() => setShowDiscoverWizard(false)} />}
      {showAddManaged && <AddManagedServer onClose={() => setShowAddManaged(false)} />}
      {showLocalInstall && (
        <LocalInstallWizard
          existingInstall={localInstallQuery.data?.existingInstall}
          onClose={() => setShowLocalInstall(false)}
        />
      )}
    </>
  );
}
