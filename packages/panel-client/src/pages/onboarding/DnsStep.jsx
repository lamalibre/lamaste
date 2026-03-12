import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, AlertTriangle, Copy, Loader2 } from 'lucide-react';

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

function DnsRecord({ type, name, value }) {
  return (
    <tr className="border-b border-zinc-700 last:border-b-0">
      <td className="px-3 py-2.5 font-mono text-sm text-cyan-400">{type}</td>
      <td className="px-3 py-2.5 font-mono text-sm text-zinc-300">{name}</td>
      <td className="px-3 py-2.5 font-mono text-sm text-zinc-300">
        <span className="inline-flex items-center">
          {value}
          <CopyButton text={value} />
        </span>
      </td>
    </tr>
  );
}

function VerificationResult({ result }) {
  if (!result) return null;

  return (
    <div className="mt-5 space-y-3 rounded-md border border-zinc-700 bg-zinc-900 p-4">
      <div className="flex items-start gap-2">
        {result.ok ? (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-400" />
        ) : (
          <XCircle size={18} className="mt-0.5 shrink-0 text-red-400" />
        )}
        <div className="text-sm">
          <span className={result.ok ? 'text-green-400' : 'text-red-400'}>
            {result.domain}
          </span>
          {result.ok ? (
            <span className="text-zinc-400"> resolves to {result.expectedIp}</span>
          ) : result.resolvedIps.length > 0 ? (
            <span className="text-zinc-400"> resolves to {result.resolvedIps.join(', ')} (expected {result.expectedIp})</span>
          ) : (
            <span className="text-zinc-400"> does not resolve</span>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2">
        {result.wildcardOk ? (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-400" />
        ) : (
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-yellow-400" />
        )}
        <div className="text-sm">
          <span className={result.wildcardOk ? 'text-green-400' : 'text-yellow-400'}>
            *.{result.domain}
          </span>
          {result.wildcardOk ? (
            <span className="text-zinc-400"> resolves to {result.expectedIp}</span>
          ) : (
            <span className="text-zinc-400"> not configured — you can add individual subdomain records later</span>
          )}
        </div>
      </div>

      <p className="text-sm text-zinc-400">{result.message}</p>
    </div>
  );
}

export default function DnsStep({ domain, ip, onComplete, onBack }) {
  const [result, setResult] = useState(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/onboarding/verify-dns', {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Verification failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ['onboarding', 'status'] });
      }
    },
  });

  function handleVerify() {
    mutation.mutate();
  }

  function handleContinue() {
    onComplete();
  }

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Configure DNS records</h2>
      <p className="mb-5 text-sm text-zinc-400">
        Add these DNS records at your domain registrar or DNS provider.
      </p>

      {mutation.isError && (
        <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {mutation.error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-zinc-700">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-zinc-700 bg-zinc-800/50">
              <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Type</th>
              <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Name</th>
              <th className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Value</th>
            </tr>
          </thead>
          <tbody className="bg-zinc-900">
            <DnsRecord type="A" name={domain} value={ip} />
            <DnsRecord type="A" name={`*.${domain}`} value={ip} />
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs italic text-zinc-500">
        DNS propagation can take up to 48 hours, but usually completes within a few minutes.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        The wildcard record (*.{domain}) allows Portlama to create subdomains for your tunnels
        automatically.
      </p>

      <VerificationResult result={result} />

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Back
        </button>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleVerify}
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-md bg-cyan-500 px-6 py-2 font-medium text-white transition-colors hover:bg-cyan-600 disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
            {mutation.isPending ? 'Verifying...' : 'Verify DNS'}
          </button>

          {result?.ok && (
            <button
              type="button"
              onClick={handleContinue}
              className="rounded-md bg-green-600 px-6 py-2 font-medium text-white transition-colors hover:bg-green-700"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
