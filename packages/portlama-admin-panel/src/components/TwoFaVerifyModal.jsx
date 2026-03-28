import { useState, useRef, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';

export default function TwoFaVerifyModal({ onVerified }) {
  const client = useAdminClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleChange(e) {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (code.length !== 6) {
      setError('Enter a 6-digit code');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const data = await client.verify2fa(code);

      if (data.verified) {
        onVerified();
      } else {
        setError('Verification failed. Please try again.');
      }
    } catch (err) {
      const msg = err?.message || String(err);
      setError(msg === '2fa_required' ? 'Session expired' : msg || 'Verification failed');
    } finally {
      setIsSubmitting(false);
      setCode('');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-lg bg-zinc-800 p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-cyan-400" />
          <h2 className="text-lg font-bold text-white">Two-Factor Authentication</h2>
        </div>

        <p className="mb-4 text-sm text-zinc-400">
          Enter the 6-digit code from your authenticator app to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={handleChange}
            placeholder="000000"
            maxLength={6}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting || code.length !== 6}
            className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {isSubmitting ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-600">
          Lost your authenticator? Run <code className="text-zinc-500">sudo portlama-reset-admin</code> on the server.
        </p>
      </div>
    </div>
  );
}
