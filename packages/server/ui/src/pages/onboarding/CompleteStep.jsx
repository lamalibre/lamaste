import { useState } from 'react';
import { ShieldCheck, Copy, Eye, EyeOff, ExternalLink } from 'lucide-react';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 inline-flex items-center text-zinc-500 transition-colors hover:text-zinc-300"
      title="Copy to clipboard"
    >
      <Copy size={14} />
      {copied && <span className="ml-1 text-xs text-green-400">Copied</span>}
    </button>
  );
}

/**
 * Returns the URL only if it uses the https: scheme, preventing XSS via
 * javascript: or data: URLs and open-redirect via arbitrary schemes.
 * Uses the URL constructor to parse and re-emit the href, which breaks
 * any taint chain from unvalidated server responses.
 * @param {string} url
 * @returns {string}
 */
function safeHttpsUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return parsed.href;
  } catch {
    /* invalid URL */
  }
  return '';
}

export default function CompleteStep({ result, ip }) {
  const [passwordVisible, setPasswordVisible] = useState(false);

  const adminUsername = result?.adminUsername || 'admin';
  const adminPassword = result?.adminPassword || '';
  const panelUrl = safeHttpsUrl(result?.panelUrl || '');
  const authUrl = safeHttpsUrl(result?.authUrl || '');
  const ipUrl = `https://${ip}:9292`;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 text-center">
        <ShieldCheck size={48} className="mx-auto mb-3 text-green-400" />
        <h2 className="text-2xl font-bold text-white">Lamaste is ready!</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Your stack is fully configured and operational.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-zinc-700 bg-zinc-800 p-6">
        <h3 className="mb-1 font-semibold text-white">Admin Credentials</h3>
        <p className="mb-4 text-sm text-amber-400">
          Save these credentials — they won&apos;t be shown again.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Username</span>
            <span className="inline-flex items-center font-mono text-sm text-white">
              {adminUsername}
              <CopyButton text={adminUsername} />
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Password</span>
            <span className="inline-flex items-center font-mono text-sm text-white">
              {passwordVisible ? adminPassword : '\u2022'.repeat(16)}
              <button
                type="button"
                onClick={() => setPasswordVisible((v) => !v)}
                className="ml-2 text-zinc-500 transition-colors hover:text-zinc-300"
                title={passwordVisible ? 'Hide password' : 'Show password'}
              >
                {passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <CopyButton text={adminPassword} />
            </span>
          </div>
        </div>
      </div>

      <div className="mb-5 space-y-2">
        <h3 className="text-sm font-semibold text-zinc-300">Access URLs</h3>

        <div className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <span className="text-sm text-zinc-400">Panel</span>
          <a
            href={panelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
          >
            {panelUrl}
            <ExternalLink size={12} />
          </a>
        </div>

        <div className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <span className="text-sm text-zinc-400">Auth Portal</span>
          <a
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
          >
            {authUrl}
            <ExternalLink size={12} />
          </a>
        </div>

        <div className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <span className="text-sm text-zinc-400">IP Access</span>
          <span className="text-sm text-zinc-400">
            {ipUrl} <span className="text-xs text-zinc-500">(requires client certificate)</span>
          </span>
        </div>
      </div>

      <p className="mb-6 text-xs text-zinc-400">
        On your first login to {authUrl ? new URL(authUrl).hostname : 'the auth portal'}, you will
        be prompted to set up two-factor authentication (TOTP). Use an authenticator app like Google
        Authenticator or Authy.
      </p>

      <div className="flex justify-center">
        <a
          href="/"
          className="rounded-md bg-cyan-500 px-8 py-2.5 font-medium text-white transition-colors hover:bg-cyan-600"
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
