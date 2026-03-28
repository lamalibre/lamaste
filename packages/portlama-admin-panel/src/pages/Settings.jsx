import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck, Copy, Check, AlertTriangle } from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';

// --- Settings Page ---

export default function Settings({ hasDomain }) {
  const client = useAdminClient();
  const toast = useToast();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({ queryKey: ['settings-2fa'], queryFn: () => client.get2faStatus() });

  const [setupData, setSetupData] = useState(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [copied, setCopied] = useState(false);

  const status = statusQuery.data || { enabled: false, setupComplete: false };

  const setupMutation = useMutation({
    mutationFn: () => client.setup2fa(),
    onSuccess: (data) => setSetupData(data),
  });

  const confirmMutation = useMutation({
    mutationFn: (code) => client.confirm2fa(code),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setSetupData(null);
      setConfirmCode('');
      toast('Two-factor authentication enabled');
    },
  });

  const disableMutation = useMutation({
    mutationFn: (code) => client.disable2fa(code),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setDisableCode('');
      toast('Two-factor authentication disabled');
    },
  });

  function handleCopySecret() {
    if (!setupData?.manualKey) return;
    navigator.clipboard.writeText(setupData.manualKey).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        toast('Failed to copy to clipboard', 'error');
      },
    );
  }

  function handleConfirmSubmit(e) {
    e.preventDefault();
    if (confirmCode.length !== 6) return;
    confirmMutation.mutate(confirmCode);
  }

  function handleDisableSubmit(e) {
    e.preventDefault();
    if (disableCode.length !== 6) return;
    disableMutation.mutate(disableCode);
  }

  if (statusQuery.isLoading) {
    return (
      <div className="p-6">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="mt-4 text-sm text-red-400">Failed to load settings. Please try again.</p>
      </div>
    );
  }

  const confirmError = confirmMutation.error?.message;
  const disableError = disableMutation.error?.message;
  const setupError = setupMutation.error?.message;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Configure panel security settings.</p>
      </div>

      {/* 2FA Section */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-white">Two-Factor Authentication</h2>
          {status.enabled && (
            <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
              Enabled
            </span>
          )}
        </div>

        {/* --- Disabled state --- */}
        {!status.enabled && !setupData && (
          <div>
            <p className="mb-4 text-sm text-zinc-400">
              Add a second layer of protection to the admin panel. When enabled, you will need both
              your mTLS certificate and a TOTP code from your authenticator app to access the panel.
            </p>

            {!hasDomain && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-400" />
                <p className="text-sm text-yellow-400">
                  A domain must be configured before enabling 2FA. Enabling 2FA disables IP:9292
                  access.
                </p>
              </div>
            )}

            {setupError && <p className="mb-3 text-sm text-red-400">{setupError}</p>}

            <button
              type="button"
              onClick={() => setupMutation.mutate()}
              disabled={!hasDomain || setupMutation.isPending}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {setupMutation.isPending ? 'Setting up...' : 'Enable Two-Factor Authentication'}
            </button>

            {hasDomain && (
              <p className="mt-3 text-xs text-zinc-600">
                This will disable IP:9292 access. The panel will only be accessible via domain.
              </p>
            )}
          </div>
        )}

        {/* --- Setup state (QR code shown) --- */}
        {!status.enabled && setupData && (
          <div>
            <p className="mb-4 text-sm text-zinc-400">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
            </p>

            <div className="mb-4 flex justify-center">
              <div className="rounded-lg bg-zinc-950 p-4">
                <QRCodeSVG value={setupData.uri} size={200} bgColor="transparent" fgColor="#ffffff" />
              </div>
            </div>

            <p className="mb-2 text-sm text-zinc-400">Or enter this code manually:</p>
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-3">
              <code className="flex-1 font-mono text-sm tracking-wider text-cyan-400">
                {setupData.manualKey?.replace(/(.{4})/g, '$1 ').trim()}
              </code>
              <button
                type="button"
                onClick={handleCopySecret}
                className="text-zinc-500 hover:text-zinc-300"
                title="Copy secret"
              >
                {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            </div>

            <form onSubmit={handleConfirmSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-zinc-400">
                  Enter the code from your authenticator to confirm
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-center text-lg tracking-[0.2em] text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {confirmError && <p className="text-sm text-red-400">{confirmError}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSetupData(null);
                    setConfirmCode('');
                    confirmMutation.reset();
                  }}
                  className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmMutation.isPending || confirmCode.length !== 6}
                  className="flex-1 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {confirmMutation.isPending ? 'Confirming...' : 'Confirm & Enable'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* --- Enabled state --- */}
        {status.enabled && (
          <div>
            <p className="mb-4 text-sm text-zinc-400">
              Two-factor authentication is active. The panel requires both your mTLS certificate and
              a TOTP code.
            </p>

            <div className="mb-4 rounded-lg border border-zinc-700 bg-zinc-950 p-3">
              <p className="text-xs text-zinc-500">
                Recovery: if you lose access to your authenticator, run{' '}
                <code className="text-zinc-400">sudo portlama-reset-admin</code> on the server via
                the DigitalOcean console. This will reset admin auth to P12 and disable 2FA.
              </p>
            </div>

            <form onSubmit={handleDisableSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-zinc-400">
                  Enter a TOTP code to disable 2FA
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-center text-lg tracking-[0.2em] text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {disableError && <p className="text-sm text-red-400">{disableError}</p>}

              <button
                type="submit"
                disabled={disableMutation.isPending || disableCode.length !== 6}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {disableMutation.isPending ? 'Disabling...' : 'Disable Two-Factor Authentication'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
