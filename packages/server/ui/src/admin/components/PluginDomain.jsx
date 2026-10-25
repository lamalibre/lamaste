import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe2 } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { useDomains } from './DomainChoice.jsx';
import { activeDomainNames, explainDomainRefusal, primaryDomainName } from '../lib/domains.js';

/**
 * The domain a plugin belongs to — its OIDC clients' issuer and sign-in,
 * its user and web surfaces, its audience — and a move to another active
 * domain (refused while one of its surfaces is served). Shown only once
 * the relay has two active domains.
 */
export default function PluginDomain({ plugin }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const { data: domains = [] } = useDomains();
  const names = activeDomainNames(domains);
  const current = plugin.domain ?? primaryDomainName(domains);
  const [target, setTarget] = useState('');
  const move = useMutation({
    mutationFn: (domain) => client.setPluginDomain(plugin.name, domain),
    onSuccess: (result) => {
      setTarget('');
      addToast(`${plugin.name} now belongs to ${result.domain}`);
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['domains'] });
    },
    onError: (err) => addToast(explainDomainRefusal(err), 'error'),
  });
  if (names.length < 2) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
      <Globe2 size={14} className="text-cyan-400" />
      <span>
        Domain <span className="font-mono text-zinc-200">{current}</span>
      </span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        disabled={move.isPending}
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
      >
        <option value="">Move to…</option>
        {names
          .filter((n) => n !== current)
          .map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
      </select>
      <button
        type="button"
        disabled={!target || move.isPending}
        onClick={() => move.mutate(target)}
        className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50"
      >
        Move
      </button>
    </div>
  );
}
