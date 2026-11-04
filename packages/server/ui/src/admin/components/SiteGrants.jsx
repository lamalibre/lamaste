import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, Loader2, Plus, Trash2, User, Users } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { relativeTime } from '../lib/formatters.js';
import { explainSiteGrantRefusal, principalKey, siteGrantBody } from '../lib/site-grants.js';

/**
 * Refetch what a grant on a plugin's site changes: its web surface (the
 * grants, who lacks one) and Gatekeeper's grants.
 */
function invalidateSiteGrants(queryClient, pluginName) {
  queryClient.invalidateQueries({ queryKey: ['plugin-web-surface', pluginName] });
  queryClient.invalidateQueries({ queryKey: ['gatekeeper-grants'] });
}

/** A grant's answer may carry `warnings` (the domains' rendering): each one a toast. */
function toastWarnings(addToast, data) {
  for (const warning of Array.isArray(data?.warnings) ? data.warnings : []) {
    if (typeof warning?.message === 'string') addToast(warning.message, 'error');
  }
}

/**
 * Give and revoke grants on site `site` of plugin `pluginName`. A refusal
 * is a toast with what lifts it.
 */
export function useSiteGrantMutations(pluginName, site) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const refused = (err) => {
    const { message, hint } = explainSiteGrantRefusal(err);
    addToast(hint ? `${message} — ${hint}` : message, 'error');
  };
  const grant = useMutation({
    mutationFn: (principal) => client.createGatekeeperGrant(siteGrantBody(principal, site.id)),
    onSuccess: (data, principal) => {
      invalidateSiteGrants(queryClient, pluginName);
      addToast(
        `${principal.principalType === 'group' ? `Group ${principal.principalId}` : principal.principalId} may reach ${site.fqdn}`,
      );
      toastWarnings(addToast, data);
    },
    onError: (err) => {
      invalidateSiteGrants(queryClient, pluginName);
      refused(err);
    },
  });
  const revoke = useMutation({
    mutationFn: (g) => client.revokeGatekeeperGrant(g.grantId),
    onSuccess: (data, g) => {
      invalidateSiteGrants(queryClient, pluginName);
      // Another grant may still admit them (a group of theirs, their own):
      // the list of members without a grant says who lost the site.
      addToast(
        `The grant on ${site.fqdn} to ${g.principalType === 'group' ? `group ${g.principalId}` : g.principalId} is revoked`,
      );
      toastWarnings(addToast, data);
    },
    onError: (err) => {
      invalidateSiteGrants(queryClient, pluginName);
      refused(err);
    },
  });
  return { grant, revoke, busy: grant.isPending || revoke.isPending };
}

/** A one-click grant of the site to one principal. */
export function GrantSiteButton({ onGrant, busy, label = 'Grant the site', title }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onGrant}
      title={title}
      className="inline-flex items-center gap-1 rounded bg-cyan-600/20 px-1.5 py-0.5 text-cyan-300 hover:bg-cyan-600/40 disabled:opacity-50"
    >
      <KeyRound size={10} /> {label}
    </button>
  );
}

/** One grant: who, since when, revoke behind a confirmation. */
function GrantRow({ grant, now, onRevoke, busy }) {
  const [confirming, setConfirming] = useState(false);
  const Icon = grant.principalType === 'user' ? User : Users;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-zinc-900 px-2 py-1.5">
      <span className="inline-flex items-center gap-1">
        <Icon
          size={11}
          className={grant.principalType === 'user' ? 'text-blue-400' : 'text-purple-400'}
        />
        <span className="font-mono text-zinc-200">{grant.principalId}</span>
        {grant.principalType === 'group' && <span className="text-zinc-600">group</span>}
      </span>
      <span className="text-zinc-600" title={new Date(grant.createdAt).toLocaleString()}>
        granted {relativeTime(grant.createdAt, now)}
      </span>
      <span className="ml-auto">
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <span className="text-zinc-400">Revoke the site?</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onRevoke(grant);
              }}
              className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-500 disabled:opacity-50"
            >
              Revoke
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded bg-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-600"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            title="Revoke this grant: they no longer reach the site, whatever their roles"
            className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 size={12} />
          </button>
        )}
      </span>
    </li>
  );
}

/** Give a user or a Lamaste group the site. */
function AddSiteGrant({ taken, onGrant, busy }) {
  const client = useAdminClient();
  const [principalType, setPrincipalType] = useState('user');
  const [principalId, setPrincipalId] = useState('');
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => client.getUsers() });
  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
    retry: false,
  });
  const free = (id) => !taken.has(principalKey({ principalType, principalId: id }));
  const options =
    principalType === 'user'
      ? (usersQuery.data?.users ?? [])
          .filter((u) => free(u.username))
          .map((u) => ({
            id: u.username,
            label: `${u.username}${u.status === 'disabled' ? ' (disabled)' : ''}`,
          }))
      : (groupsQuery.data?.groups ?? [])
          .filter((g) => free(g.name))
          .map((g) => ({ id: g.name, label: g.name }));
  const listError =
    principalType === 'user'
      ? usersQuery.isError && usersQuery.data === undefined && 'Users could not be listed'
      : groupsQuery.isError &&
        groupsQuery.data === undefined &&
        `Lamaste groups could not be listed: ${errorMessage(groupsQuery.error)}`;

  const submit = (e) => {
    e.preventDefault();
    if (!principalId) return;
    onGrant({ principalType, principalId }, () => setPrincipalId(''));
  };

  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {['user', 'group'].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              setPrincipalType(type);
              setPrincipalId('');
            }}
            className={`rounded px-2 py-0.5 ${principalType === type ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {type === 'user' ? 'User' : 'Group'}
          </button>
        ))}
        <select
          value={principalId}
          onChange={(e) => setPrincipalId(e.target.value)}
          aria-label={principalType === 'user' ? 'User' : 'Lamaste group'}
          className="min-w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200 focus:border-cyan-400 focus:outline-none"
        >
          <option value="">
            {principalType === 'user' ? 'Select a user…' : 'Select a Lamaste group…'}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !principalId}
          className="flex items-center gap-1 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Grant the site
        </button>
      </div>
      {listError && <p className="text-red-400">{listError}</p>}
    </form>
  );
}

/**
 * Who may reach a restricted web surface's site: the members of the
 * plugin's audience no grant admits (each with a one-click grant), the
 * grants on the site (users and Lamaste groups, each revocable) and a form
 * to add one. Roles — People — decide what a member may do in the plugin;
 * a grant here is what lets them reach it at all.
 */
export default function SiteGrantsSection({ plugin, site, now }) {
  const { grant, revoke, busy } = useSiteGrantMutations(plugin.name, site);
  const grants = site.grants;
  const missing = site.membersWithoutGrant;
  const taken = new Set((grants ?? []).map(principalKey));

  return (
    <div className="space-y-2">
      <p className="mb-1.5 text-zinc-500">Who may reach the site (restricted):</p>
      <p className="text-zinc-400">
        A member of its audience reaches{' '}
        <span className="font-mono text-zinc-300">{site.fqdn}</span> only with a grant here — to
        them, or to a Lamaste group they are in. Their roles (People) decide what they may do in it;
        a role alone lets nobody in.
      </p>
      {grants === null ? (
        <p className="flex items-start gap-1.5 text-red-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Gatekeeper could not be read — the site’s grants are unknown for now.
        </p>
      ) : (
        <>
          {missing?.length > 0 && (
            <div className="space-y-1 rounded border border-yellow-500/30 bg-yellow-500/5 p-2">
              <p className="flex items-start gap-1.5 text-yellow-400">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {missing.length} member{missing.length === 1 ? '' : 's'} of its audience cannot
                reach the site: entitled, but no grant names them or a group they are in.
              </p>
              <ul className="flex flex-wrap gap-2">
                {missing.map((m) => (
                  <li
                    key={m.userId}
                    className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-2 py-0.5"
                  >
                    <span className="font-mono text-zinc-200">{m.username}</span>
                    <GrantSiteButton
                      busy={busy}
                      label="Grant"
                      title={`Let ${m.username} reach ${site.fqdn}`}
                      onGrant={() =>
                        grant.mutate({ principalType: 'user', principalId: m.username })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {grants.length === 0 ? (
            <p className="text-zinc-600">No grants yet — nobody reaches the site.</p>
          ) : (
            <ul className="space-y-1">
              {grants.map((g) => (
                <GrantRow
                  key={g.grantId}
                  grant={g}
                  now={now}
                  busy={busy}
                  onRevoke={(it) => revoke.mutate(it)}
                />
              ))}
            </ul>
          )}
          <AddSiteGrant
            taken={taken}
            busy={busy}
            onGrant={(principal, done) => grant.mutate(principal, { onSuccess: done })}
          />
        </>
      )}
    </div>
  );
}
