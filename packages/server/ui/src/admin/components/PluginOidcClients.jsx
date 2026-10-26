import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, X } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { externalUserIds } from '../lib/domains.js';

/** The Gatekeeper resource type of a grant on an OIDC client. */
const OIDC_CLIENT_RESOURCE = 'oidc-client';

const SELECT_CLASS =
  'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none';

/** Grant one client to a user or a Lamaste group. */
function GrantForm({ clientId, candidates, groups, onGrant, busy }) {
  const [principal, setPrincipal] = useState('');
  const [type, id] = principal.split(':', 2);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <select
        value={principal}
        onChange={(e) => setPrincipal(e.target.value)}
        disabled={busy}
        aria-label={`Grant ${clientId} to`}
        className={SELECT_CLASS}
      >
        <option value="">Grant to…</option>
        {candidates.length > 0 && (
          <optgroup label="External members">
            {candidates.map((u) => (
              <option key={u.username} value={`user:${u.username}`}>
                {u.username}
              </option>
            ))}
          </optgroup>
        )}
        {groups.length > 0 && (
          <optgroup label="Lamaste groups">
            {groups.map((g) => (
              <option key={g.name} value={`group:${g.name}`}>
                {g.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button
        type="button"
        disabled={!principal || busy}
        onClick={() => {
          onGrant({ principalType: type, principalId: id });
          setPrincipal('');
        }}
        className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50"
      >
        <Plus size={12} /> Grant
      </button>
    </div>
  );
}

/**
 * The OIDC clients a plugin declares that sign users in, and who is
 * granted each: members of the plugin's domain sign in without a grant; an
 * external member only with one — a Gatekeeper grant on the client, to
 * them or a Lamaste group they belong to. Nothing for a plugin without
 * such a client.
 */
export default function PluginOidcClients({ plugin }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const clientsQuery = useQuery({
    queryKey: ['plugin-oidc-clients', plugin.name],
    queryFn: () => client.getPluginOidcClients(plugin.name),
    staleTime: 30_000,
  });
  const userFacing = (clientsQuery.data?.clients ?? []).filter((c) => c.userFacing);
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => client.getUsers(),
    enabled: userFacing.length > 0,
  });
  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
    enabled: userFacing.length > 0,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['plugin-oidc-clients', plugin.name] });
  const onError = (err) => addToast(errorMessage(err), 'error');
  const grant = useMutation({
    mutationFn: ({ clientId, principalType, principalId }) =>
      client.createGatekeeperGrant({
        principalType,
        principalId,
        resourceType: OIDC_CLIENT_RESOURCE,
        resourceId: clientId,
      }),
    onSuccess: invalidate,
    onError,
  });
  const revoke = useMutation({
    mutationFn: (grantId) => client.revokeGatekeeperGrant(grantId),
    onSuccess: invalidate,
    onError,
  });

  if (userFacing.length === 0) return null;
  const externals = externalUserIds(usersQuery.data?.users, plugin.domain);
  const candidates = (usersQuery.data?.users ?? [])
    .filter((u) => externals.has(u.userId))
    .sort((a, b) => a.username.localeCompare(b.username));
  const groups = groupsQuery.data?.groups ?? [];
  const busy = grant.isPending || revoke.isPending;

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
      <p className="mb-2 flex items-center gap-2 text-zinc-300">
        <KeyRound size={14} className="text-cyan-400" /> OIDC sign-in — members of{' '}
        <span className="font-mono">{plugin.domain}</span> sign in; external members only when
        granted
      </p>
      <div className="space-y-3">
        {userFacing.map((c) => (
          <div key={c.id}>
            <p className="font-mono text-zinc-200">
              {c.id}
              {c.name ? <span className="ml-2 font-sans text-zinc-500">{c.name}</span> : null}
            </p>
            {c.grants === null ? (
              <p className="text-amber-300">Gatekeeper could not be read: grants unknown.</p>
            ) : (c.grants ?? []).length === 0 ? (
              <p className="text-zinc-600">No grants: no external member signs in.</p>
            ) : (
              <ul className="mt-1 flex flex-wrap gap-1">
                {c.grants.map((g) => (
                  <li
                    key={g.grantId}
                    className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 font-mono text-zinc-300"
                  >
                    {g.principalType === 'group' ? `group:${g.principalId}` : g.principalId}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => revoke.mutate(g.grantId)}
                      title="Revoke"
                      aria-label={`Revoke ${g.principalId}`}
                      className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <GrantForm
              clientId={c.id}
              candidates={candidates}
              groups={groups}
              busy={busy}
              onGrant={(principal) => grant.mutate({ clientId: c.id, ...principal })}
            />
          </div>
        ))}
      </div>
      {clientsQuery.isFetching && <Loader2 size={12} className="mt-2 animate-spin" />}
    </div>
  );
}
