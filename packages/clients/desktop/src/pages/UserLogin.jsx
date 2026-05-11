import { useState } from 'react';
import { LogIn, AlertCircle, Loader2, ArrowLeft, ExternalLink } from 'lucide-react';
import { desktopUserAccessClient as client } from '../lib/desktop-user-access-client.js';

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

export default function UserLogin({ onBack }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [waitingForCallback, setWaitingForCallback] = useState(false);
  const [activeDomain, setActiveDomain] = useState('');

  const handleLogin = async () => {
    const domain = normalizeAddress(input);
    if (!domain) {
      setError('Enter the link or address your administrator sent you.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await client.startLogin(domain);
      setActiveDomain(domain);
      setWaitingForCallback(true);
      setLoading(false);
    } catch (err) {
      setError(err?.toString() || 'Could not open your browser.');
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  if (waitingForCallback) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-zinc-950 px-6 py-12">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center rounded-full bg-cyan-400/10 p-4 mb-5">
            <Loader2 size={28} className="text-cyan-400 animate-spin" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2 tracking-tight">
            Finish signing in your browser
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed mb-1">
            We'll continue automatically once you're authenticated.
          </p>
          {activeDomain && (
            <p className="text-xs text-zinc-500 mt-3 inline-flex items-center gap-1.5">
              <ExternalLink size={11} />
              Signing in to <span className="text-zinc-300 font-medium">{activeDomain}</span>
            </p>
          )}
          <div className="mt-8">
            <button
              type="button"
              onClick={() => {
                setWaitingForCallback(false);
                setLoading(false);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full bg-zinc-950 px-6 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center rounded-full bg-cyan-400/10 p-4 mb-4">
            <LogIn size={28} className="text-cyan-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Paste the link your administrator sent you. We'll open your browser to finish signing in.
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://panel.example.com"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 transition"
          />

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <span className="text-xs text-red-400 leading-relaxed">{error}</span>
            </div>
          )}

          <button
            type="button"
            disabled={loading || !input.trim()}
            onClick={handleLogin}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-cyan-400/20 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            Continue
          </button>
        </div>

        <p className="text-[11px] text-zinc-600 leading-relaxed text-center mt-6">
          A link, a URL, or just the domain — we'll figure it out.
        </p>

        {onBack && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-cyan-400 transition"
            >
              <ArrowLeft size={12} />
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
