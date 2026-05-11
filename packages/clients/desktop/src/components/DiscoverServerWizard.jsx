import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import {
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Server,
  Search,
  ArrowRight,
  ChevronLeft,
  ExternalLink,
  Key,
  Copy,
  Check,
  Terminal,
  Shield,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { errorMessage } from '@lamalibre/lamaste-server-ui/lib/errorMessage.js';

const DOCS_CERT_RECOVERY = 'https://lamalibre.github.io/lamaste/02-guides/disaster-recovery.html#scenario-6-admin-certificate-lost-hardware-bound-or-2fa-locked-out';

export default function DiscoverServerWizard({ onClose }) {
  const queryClient = useQueryClient();
  // token | scanning | results | register | ssh-setup | ssh-recovering
  const [step, setStep] = useState('token');
  const [token, setToken] = useState('');
  const [tokenLoading, setTokenLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [servers, setServers] = useState([]);
  const [selected, setSelected] = useState(null);

  // Register form
  const [label, setLabel] = useState('');
  const [p12Path, setP12Path] = useState('');
  const [p12Password, setP12Password] = useState('');
  const [registering, setRegistering] = useState(false);

  // SSH recovery state
  const [sshPublicKey, setSshPublicKey] = useState('');
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState('');
  const [sshKnownHostsPath, setSshKnownHostsPath] = useState('');
  const [sshKeyDir, setSshKeyDir] = useState('');
  const [sshGenerating, setSshGenerating] = useState(false);
  const [sshConnecting, setSshConnecting] = useState(false);
  const [sshConnected, setSshConnected] = useState(false);
  const [sshRecoveryStep, setSshRecoveryStep] = useState('');
  const [sshRecovering, setSshRecovering] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pre-fill token from keychain on mount
  useEffect(() => {
    invoke('get_cloud_token', { provider: 'digitalocean' })
      .then((stored) => {
        if (stored) setToken(stored);
      })
      .catch(() => {})
      .finally(() => setTokenLoading(false));
  }, []);

  // Cleanup SSH keys on unmount if they were generated
  useEffect(() => {
    return () => {
      if (sshKeyDir) {
        invoke('cleanup_recovery_ssh_key', { dir: sshKeyDir }).catch(() => {});
      }
    };
  }, [sshKeyDir]);

  async function handleValidateAndScan() {
    setError('');
    setValidating(true);
    try {
      const result = await invoke('validate_cloud_token', {
        provider: 'digitalocean',
        token: token.trim(),
      });
      if (!result.valid) {
        setError(
          result.missingScopes?.length > 0
            ? `Token is missing required scopes: ${result.missingScopes.join(', ')}`
            : 'Token is invalid',
        );
        return;
      }
      // Store token for future use
      await invoke('store_cloud_token', {
        provider: 'digitalocean',
        token: token.trim(),
      });
    } catch (err) {
      setError(errorMessage(err));
      return;
    } finally {
      setValidating(false);
    }

    // Start scanning
    setStep('scanning');
    setScanning(true);
    try {
      const results = await invoke('discover_servers', { token: token.trim() });
      setServers(results);
      setStep('results');
    } catch (err) {
      setError(errorMessage(err));
      setStep('token');
    } finally {
      setScanning(false);
    }
  }

  function handleSelect(server) {
    setSelected(server);
    setLabel(
      server.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 63) || 'my-server',
    );
    setStep('register');
  }

  async function handleRegister() {
    if (!selected) return;
    setError('');
    setRegistering(true);
    try {
      // 1. Register the server
      const entry = await invoke('register_discovered_server', {
        dropletId: selected.dropletId,
        ip: selected.ip || '',
        region: selected.region,
        createdAt: selected.createdAt,
        domain: selected.domains[0] ?? null,
        panelUrl: selected.panelUrl,
        label: label.trim(),
      });

      // 2. Import admin P12 if provided
      if (p12Path.trim() && p12Password.trim()) {
        try {
          await invoke('import_admin_cert', {
            serverId: entry.id,
            p12Path: p12Path.trim(),
            p12Password: p12Password.trim(),
          });
        } catch (err) {
          // Server registered but cert import failed — not fatal
          console.error('P12 import failed:', err);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['servers'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRegistering(false);
    }
  }

  async function handleStartSSHRecovery() {
    setError('');
    setSshGenerating(true);
    try {
      const keyPair = await invoke('generate_recovery_ssh_key');
      setSshPublicKey(keyPair.publicKey);
      setSshPrivateKeyPath(keyPair.privateKeyPath);
      setSshKnownHostsPath(keyPair.knownHostsPath);
      setSshKeyDir(keyPair.dir);
      setSshConnected(false);
      setStep('ssh-setup');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSshGenerating(false);
    }
  }

  async function handleCopyCommand() {
    try {
      await navigator.clipboard.writeText(sshAddCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback — select the text for manual copy
    }
  }

  async function handleTestSSH() {
    setError('');
    setSshConnecting(true);
    try {
      await invoke('test_recovery_ssh', {
        ip: selected.ip,
        privateKeyPath: sshPrivateKeyPath,
        knownHostsPath: sshKnownHostsPath,
      });
      setSshConnected(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSshConnecting(false);
    }
  }

  async function handleSSHRecover() {
    if (!selected) return;
    setError('');
    setSshRecovering(true);
    setStep('ssh-recovering');

    try {
      // Step 1: Reset admin cert via SSH (before registration so the
      // server doesn't appear in the sidebar while this runs)
      setSshRecoveryStep('Resetting admin certificate on server...');
      const result = await invoke('recover_admin_via_ssh', {
        ip: selected.ip,
        privateKeyPath: sshPrivateKeyPath,
        knownHostsPath: sshKnownHostsPath,
      });

      // Step 2: Register server (cert is now ready on disk)
      setSshRecoveryStep('Registering server...');
      const entry = await invoke('register_discovered_server', {
        dropletId: selected.dropletId,
        ip: selected.ip || '',
        region: selected.region,
        createdAt: selected.createdAt,
        domain: selected.domains[0] ?? null,
        panelUrl: selected.panelUrl,
        label: label.trim(),
      });

      // Step 3: Import recovered P12
      setSshRecoveryStep('Importing certificate...');
      await invoke('import_admin_cert', {
        serverId: entry.id,
        p12Path: result.p12Path,
        p12Password: result.p12Password,
      });

      // Step 4: Upgrade to hardware-bound (macOS only, non-fatal)
      setSshRecoveryStep('Upgrading to hardware-bound certificate...');
      try {
        await invoke('upgrade_admin_to_hardware_bound', { serverId: entry.id });
      } catch (upgradeErr) {
        console.warn('Hardware-bound upgrade skipped:', upgradeErr);
      }

      // Step 5: Cleanup SSH keys
      setSshRecoveryStep('Cleaning up...');
      await invoke('cleanup_recovery_ssh_key', { dir: sshKeyDir });
      setSshKeyDir(''); // Prevent double-cleanup on unmount

      setSshRecoveryStep('done');
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    } catch (err) {
      setError(errorMessage(err));
      setSshRecoveryStep('');
    } finally {
      setSshRecovering(false);
    }
  }

  async function handleBackFromSSH() {
    // Cleanup the generated SSH key when going back
    if (sshKeyDir) {
      await invoke('cleanup_recovery_ssh_key', { dir: sshKeyDir }).catch(() => {});
      setSshKeyDir('');
      setSshPublicKey('');
      setSshPrivateKeyPath('');
      setSshKnownHostsPath('');
      setSshConnected(false);
    }
    setError('');
    setStep('register');
  }

  const sshAddCommand = selected?.ip
    ? `echo '${sshPublicKey}' >> /root/.ssh/authorized_keys`
    : '';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Search size={14} className="text-cyan-400" />
            Discover Existing Server
          </h2>
          <button
            onClick={onClose}
            disabled={registering || sshRecovering}
            className="text-zinc-500 hover:text-white disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step 1: Token */}
        {step === 'token' && (
          <>
            <p className="text-xs text-zinc-400 mb-4">
              Enter your DigitalOcean API token to scan for existing Lamaste servers.
            </p>
            <div className="mb-4">
              <label className="text-xs text-zinc-400 block mb-1">API Token</label>
              {tokenLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
                  <Loader2 size={12} className="animate-spin" />
                  Checking keychain...
                </div>
              ) : (
                <input
                  type="password"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setError(''); }}
                  placeholder="dop_v1_..."
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
                />
              )}
            </div>

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleValidateAndScan}
                disabled={!token.trim() || validating || tokenLoading}
                className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                {validating ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Search size={12} />
                )}
                Validate & Scan
              </button>
            </div>
          </>
        )}

        {/* Scanning */}
        {step === 'scanning' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 size={32} className="text-cyan-400 animate-spin mb-4" />
            <p className="text-sm text-zinc-400">Scanning for Lamaste servers...</p>
            <p className="text-xs text-zinc-600 mt-1">Checking droplets and DNS records</p>
          </div>
        )}

        {/* Step 2: Results */}
        {step === 'results' && (
          <>
            {servers.length === 0 ? (
              <div className="flex flex-col items-center py-8">
                <Server size={32} className="text-zinc-600 mb-4" />
                <p className="text-sm text-zinc-400">No Lamaste-managed droplets found</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Check your DigitalOcean dashboard for any untagged droplets.
                </p>
                <button
                  onClick={() => { setStep('token'); setError(''); }}
                  className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white mt-4"
                >
                  Back
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-zinc-400 mb-3">
                  Found {servers.length} managed droplet{servers.length !== 1 ? 's' : ''}. Select one to register.
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {servers.map((s) => (
                    <button
                      key={s.dropletId}
                      type="button"
                      onClick={() => handleSelect(s)}
                      className="w-full text-left bg-zinc-950 border border-zinc-800 rounded-lg p-3 hover:border-cyan-400/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-white">{s.name}</span>
                        <div className="flex items-center gap-1.5">
                          {s.healthy ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                              healthy
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                              unreachable
                            </span>
                          )}
                          <ArrowRight size={12} className="text-zinc-600" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>{s.ip}</span>
                        <span>{s.region}</span>
                        {s.domains.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Globe size={10} />
                            {s.domains[0]}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-start mt-4">
                  <button
                    onClick={() => { setStep('token'); setError(''); }}
                    className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white flex items-center gap-1"
                  >
                    <ChevronLeft size={12} />
                    Back
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* Step 3: Register */}
        {step === 'register' && selected && (
          <>
            <button
              onClick={() => { setStep('results'); setError(''); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 mb-3"
            >
              <ChevronLeft size={12} />
              Back to results
            </button>

            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 mb-4">
              <div className="text-sm font-medium text-white mb-1">{selected.name}</div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>{selected.ip}</span>
                <span>{selected.region}</span>
                {selected.domains.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Globe size={10} />
                    {selected.domains[0]}
                  </span>
                )}
              </div>
              {selected.panelUrl && (
                <div className="text-xs text-zinc-600 mt-1 font-mono">{selected.panelUrl}</div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Label</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="border-t border-zinc-800 pt-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-zinc-400">
                    Admin Certificate (P12)
                  </p>
                  <button
                    type="button"
                    onClick={() => open(DOCS_CERT_RECOVERY)}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    How to get the certificate?
                    <ExternalLink size={9} />
                  </button>
                </div>

                <div>
                  <label className="text-xs text-zinc-500 block mb-1">P12 file path</label>
                  <input
                    type="text"
                    value={p12Path}
                    onChange={(e) => setP12Path(e.target.value)}
                    placeholder="~/Downloads/client.p12"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>
                <div className="mt-2">
                  <label className="text-xs text-zinc-500 block mb-1">P12 password</label>
                  <input
                    type="password"
                    value={p12Password}
                    onChange={(e) => setP12Password(e.target.value)}
                    placeholder="Certificate password"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
                  />
                </div>
                {!p12Path.trim() && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleStartSSHRecovery}
                      disabled={!selected.ip || sshGenerating}
                      className="w-full text-xs px-3 py-2 rounded border border-cyan-400/30 bg-cyan-400/5 text-cyan-400 hover:bg-cyan-400/10 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {sshGenerating ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Terminal size={12} />
                      )}
                      Recover via SSH
                    </button>
                    <p className="text-[10px] text-zinc-600 mt-1.5 text-center">
                      Generates an SSH key, resets the admin cert on the server, and imports it automatically.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={!label.trim() || registering}
                className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                {registering ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={12} />
                )}
                Register Server
              </button>
            </div>
          </>
        )}

        {/* Step 4: SSH Setup — show public key and test connection */}
        {step === 'ssh-setup' && selected && (
          <>
            <button
              onClick={handleBackFromSSH}
              disabled={sshConnecting}
              className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 mb-3 disabled:opacity-50"
            >
              <ChevronLeft size={12} />
              Back to registration
            </button>

            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Key size={12} className="text-cyan-400" />
                  <p className="text-xs text-zinc-300 font-medium">
                    Step 1: Add this SSH key to your droplet
                  </p>
                </div>
                <p className="text-[11px] text-zinc-500 mb-2">
                  Open the{' '}
                  <button
                    type="button"
                    onClick={() => open(`https://cloud.digitalocean.com/droplets/${selected.dropletId}/console`)}
                    className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5"
                  >
                    DigitalOcean console
                    <ExternalLink size={8} />
                  </button>
                  {' '}and run:
                </p>
                <div className="relative">
                  <pre className="bg-zinc-950 border border-zinc-800 rounded p-2.5 text-[11px] text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {sshAddCommand}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopyCommand}
                    className="absolute top-1.5 right-1.5 text-zinc-500 hover:text-white p-1 rounded bg-zinc-800/80"
                    title="Copy command"
                  >
                    {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={12} className="text-cyan-400" />
                  <p className="text-xs text-zinc-300 font-medium">
                    Step 2: Verify connection
                  </p>
                </div>
                <p className="text-[11px] text-zinc-500 mb-2">
                  After adding the key, click below to test SSH connectivity to {selected.ip}.
                </p>

                {sshConnected ? (
                  <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/20">
                    <CheckCircle2 size={12} className="text-green-400" />
                    <p className="text-xs text-green-400">SSH connection successful</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleTestSSH}
                    disabled={sshConnecting}
                    className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {sshConnecting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Terminal size={12} />
                    )}
                    Check Connection
                  </button>
                )}
              </div>
            </div>

            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={handleBackFromSSH}
                disabled={sshConnecting}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSSHRecover}
                disabled={!sshConnected || !label.trim()}
                className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Key size={12} />
                Recover & Register
              </button>
            </div>
          </>
        )}

        {/* Step 5: SSH Recovery in progress */}
        {step === 'ssh-recovering' && (
          <div className="py-6">
            {sshRecoveryStep === 'done' ? (
              <div className="flex flex-col items-center">
                <CheckCircle2 size={32} className="text-green-400 mb-4" />
                <p className="text-sm text-white mb-1">Admin access recovered</p>
                <p className="text-xs text-zinc-400 text-center mb-5">
                  The server has been registered and the admin certificate imported.
                </p>
                <button
                  onClick={onClose}
                  className="text-xs px-4 py-2 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1.5"
                >
                  <CheckCircle2 size={12} />
                  Done
                </button>
              </div>
            ) : sshRecovering ? (
              <div className="flex flex-col items-center">
                <Loader2 size={32} className="text-cyan-400 animate-spin mb-4" />
                <p className="text-sm text-white mb-1">Recovering admin access...</p>
                <p className="text-xs text-zinc-400">{sshRecoveryStep}</p>
                <p className="text-[10px] text-zinc-600 mt-3">
                  This may take a minute while the server generates new certificates.
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center">
                <AlertTriangle size={32} className="text-red-400 mb-4" />
                <p className="text-sm text-white mb-1">Recovery failed</p>
                <p className="text-xs text-red-400 text-center mb-4">{error}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setError(''); setStep('ssh-setup'); }}
                    className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSSHRecover}
                    className="text-xs px-3 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1.5"
                  >
                    <Terminal size={12} />
                    Retry
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
