import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

const DOMAIN_PATTERN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DomainStep({ domain: existingDomain, onComplete }) {
  const [domain, setDomain] = useState(existingDomain ?? '');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (body) => {
      const response = await fetch('/api/onboarding/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Request failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'status'] });
      onComplete();
    },
  });

  function validate() {
    const errors = {};
    if (!DOMAIN_PATTERN.test(domain)) {
      errors.domain = 'Enter a valid domain name (e.g. example.com)';
    }
    if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email address';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    mutation.mutate({ domain: domain.trim(), email: email.trim() });
  }

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Configure your domain</h2>
      <p className="mb-6 text-sm text-zinc-400">
        Enter the domain you want to use for Lamaste. You will need to configure DNS records in the
        next step.
      </p>

      {mutation.isError && (
        <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {mutation.error.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="domain" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Domain
          </label>
          <input
            id="domain"
            type="text"
            placeholder="example.com"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setFieldErrors((prev) => ({ ...prev, domain: undefined }));
            }}
            className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
          {fieldErrors.domain && <p className="mt-1 text-xs text-red-400">{fieldErrors.domain}</p>}
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Used for Let&apos;s Encrypt certificate registration
          </p>
          {fieldErrors.email && <p className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-md bg-cyan-500 px-6 py-2 font-medium text-white transition-colors hover:bg-cyan-600 disabled:opacity-50"
          >
            {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
            {mutation.isPending ? 'Saving...' : 'Save & Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
