import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import RefreshNote from './RefreshNote.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { failedWithoutData } from '../lib/query-refresh.js';
import { normaliseScopeInput, scopeInputError } from '../lib/trustedScopes.js';

/**
 * The relay's trusted publisher scopes: the npm scopes whose plugins this
 * relay installs and runs. `@lamalibre` is built in; an administrator adds
 * scopes whose publisher they trust as much — such a plugin runs with the
 * same privileges as Lamalibre's own, including its admin page in this
 * panel. Adding needs the registry credential's registry to host the scope;
 * removing is refused while a plugin or a push-install policy uses it.
 */
export default function TrustedScopesSection() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [input, setInput] = useState('');

  const scopesQuery = useQuery({
    queryKey: ['trusted-scopes'],
    queryFn: () => client.getTrustedScopes(),
    refetchInterval: 60000,
  });

  const onChanged = (data) => queryClient.setQueryData(['trusted-scopes'], data);

  const addMutation = useMutation({
    mutationFn: (scope) => client.addTrustedScope(scope),
    onSuccess: (data, scope) => {
      onChanged(data);
      setInput('');
      addToast(`${scope} is now a trusted publisher scope`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (scope) => client.removeTrustedScope(scope),
    onSuccess: (data, scope) => {
      onChanged(data);
      addToast(`${scope} is no longer trusted`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  if (failedWithoutData(scopesQuery)) {
    return <RefreshNote query={scopesQuery} />;
  }
  const view = scopesQuery.data;
  const scope = normaliseScopeInput(input);
  const inputError = input.trim() ? scopeInputError(scope) : null;
  const busy = addMutation.isPending || removeMutation.isPending;

  const handleAdd = (e) => {
    e.preventDefault();
    if (!scope || inputError) return;
    addMutation.mutate(scope);
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BadgeCheck size={14} className="text-cyan-400" />
        <h3 className="text-sm font-semibold text-zinc-300">Trusted publishers</h3>
      </div>
      <p className="flex items-start gap-2 text-xs text-zinc-400">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-400" />
        Plugins install only from these npm scopes. A plugin from a trusted scope runs with the same
        privileges as Lamalibre&apos;s own — on this relay, on agents and in this panel. Trust a
        scope only when you trust its publisher as much.
      </p>
      {!view ? (
        <Loader2 size={14} className="animate-spin text-zinc-500" />
      ) : (
        <ul className="flex flex-wrap gap-2">
          <li className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
            {view.builtIn}
            <span className="text-zinc-500">built in</span>
          </li>
          {view.additional.map((s) => (
            <li
              key={s}
              className="inline-flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-200"
            >
              {s}
              <button
                type="button"
                onClick={() => removeMutation.mutate(s)}
                disabled={busy}
                className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                title={`Stop trusting ${s}`}
                aria-label={`Stop trusting ${s}`}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAdd} className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-zinc-400 mb-1" htmlFor="trusted-scope">
            Trust another scope
          </label>
          <input
            id="trusted-scope"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="@example"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-cyan-400"
          />
          {inputError && <p className="mt-1 text-xs text-red-400">{inputError}</p>}
        </div>
        <button
          type="submit"
          disabled={busy || !scope || Boolean(inputError)}
          className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-1.5 text-sm text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          Trust
        </button>
      </form>
    </section>
  );
}
