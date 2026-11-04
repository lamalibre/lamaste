import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import {
  AlertTriangle,
  AppWindow,
  Key,
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  User,
  Users,
  Globe,
  Puzzle,
  UsersRound,
} from 'lucide-react';
import {
  SITE_RESOURCE,
  explainSiteGrantRefusal,
  grantableSites,
  missingSiteAccessText,
  siteAccessOf,
  siteGrantBody,
  siteGrantsDecide,
  siteOfRoute,
} from '../lib/site-grants.js';
import { siteOwnerRoute } from '../lib/web-surface.js';

/** What a grant change may change beyond the grants: plugins' people and web surfaces. */
function invalidateGrantViews(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['gatekeeper-grants'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-entitlements'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-audience'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-identity'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-web-surface'] });
}

const RESOURCE_TYPES = [
  { type: 'tunnel', label: 'Tunnel', plural: 'Tunnels' },
  { type: SITE_RESOURCE, label: 'Site', plural: 'Sites' },
  { type: 'plugin', label: 'Plugin', plural: 'Plugins' },
];

/** Whether a grant is an entitlement: a plugin grant whose context names roles. */
function isEntitlement(grant) {
  const roles = grant.context?.roles;
  return grant.resourceType === 'plugin' && Array.isArray(roles) && roles.length > 0;
}

/** A grant's context: its roles as badges, anything else as `key: value`. */
function GrantContext({ context }) {
  const entries = Object.entries(context ?? {});
  if (entries.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-zinc-600">
      {entries.map(([key, value]) =>
        key === 'roles' && Array.isArray(value) ? (
          <span key={key} className="inline-flex items-center gap-1">
            roles
            {value.map((role) => (
              <span
                key={String(role)}
                className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-cyan-400"
              >
                {String(role)}
              </span>
            ))}
          </span>
        ) : (
          <span key={key}>
            ({key}: {value !== null && typeof value === 'object' ? JSON.stringify(value) : value})
          </span>
        ),
      )}
    </span>
  );
}

function CreateGrantModal({ onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [principalType, setPrincipalType] = useState('user');
  const [principalId, setPrincipalId] = useState('');
  const [resourceType, setResourceType] = useState('tunnel');
  const [resourceId, setResourceId] = useState('');
  const [target, setTarget] = useState('');
  const [apiError, setApiError] = useState(null);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => client.getUsers() });
  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
  });
  const tunnelsQuery = useQuery({ queryKey: ['tunnels'], queryFn: () => client.getTunnels() });
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: () => client.getSites() });
  const pluginsQuery = useQuery({ queryKey: ['plugins'], queryFn: () => client.getPlugins() });

  const mutation = useMutation({
    mutationFn: (data) => client.createGatekeeperGrant(data),
    onSuccess: () => {
      invalidateGrantViews(queryClient);
      onClose();
    },
    onError: (err) => {
      const { message, hint } = explainSiteGrantRefusal(err);
      setApiError(hint ? `${message} — ${hint}` : message);
    },
  });

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setApiError(null);
      if (!principalId || !resourceId) return;
      if (resourceType === SITE_RESOURCE) {
        mutation.mutate(siteGrantBody({ principalType, principalId }, resourceId));
        return;
      }
      const context = {};
      if (resourceType === 'plugin' && target) context.target = target;
      mutation.mutate({ principalType, principalId, resourceType, resourceId, context });
    },
    [principalType, principalId, resourceType, resourceId, target, mutation],
  );

  const users = usersQuery.data?.users || [];
  const groups = groupsQuery.data?.groups || [];
  const tunnels = (tunnelsQuery.data?.tunnels || []).filter((t) => t.type !== 'panel');
  const sites = grantableSites(sitesQuery.data?.sites, pluginsQuery.data?.plugins);
  const chosenSite = resourceType === SITE_RESOURCE ? sites.find((x) => x.id === resourceId) : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">Create Grant</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-2">Principal</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => {
                  setPrincipalType('user');
                  setPrincipalId('');
                }}
                className={`px-3 py-1 text-xs rounded ${principalType === 'user' ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
              >
                User
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrincipalType('group');
                  setPrincipalId('');
                }}
                className={`px-3 py-1 text-xs rounded ${principalType === 'group' ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
              >
                Group
              </button>
            </div>
            <select
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100"
            >
              <option value="">Select {principalType}...</option>
              {principalType === 'user'
                ? users.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.username}
                    </option>
                  ))
                : groups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name}
                    </option>
                  ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Resource</label>
            <div className="flex gap-2 mb-2">
              {RESOURCE_TYPES.map(({ type, label }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setResourceType(type);
                    setResourceId('');
                  }}
                  className={`px-3 py-1 text-xs rounded ${resourceType === type ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {resourceType === SITE_RESOURCE ? (
              <div className="space-y-2">
                <select
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="">Select a plugin’s site...</option>
                  {sites.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-zinc-500">
                  A plugin’s web surface in restricted mode admits a member of its audience only
                  with a grant on its site — to them, or to a Lamaste group they are in. Their roles
                  come from the plugin’s People panel. A static site takes no grant: its access is
                  its allowed users (Sites).
                </p>
                {chosenSite && !chosenSite.restricted && (
                  <p className="text-xs text-yellow-400">
                    This web surface is authenticated: every member of its audience reaches it, so a
                    grant on it counts for nothing.
                  </p>
                )}
              </div>
            ) : resourceType === 'tunnel' ? (
              <select
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Select tunnel...</option>
                {tunnels.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fqdn} ({t.subdomain})
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  placeholder="@lamalibre/plugin-name"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100"
                />
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="Target: local or agent:<label>"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100"
                />
                <p className="text-xs text-zinc-500">
                  A grant made here carries no roles and never makes anyone a member of a
                  plugin&apos;s audience. Give users and groups an agent-hosted plugin&apos;s roles
                  in the People panel on its card under Plugins.
                </p>
              </div>
            )}
          </div>

          {apiError && <p className="text-sm text-red-400">{apiError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !principalId || !resourceId}
              className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PrincipalBadge({ type, id }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {type === 'user' ? (
        <User className="w-3 h-3 text-blue-400" />
      ) : (
        <Users className="w-3 h-3 text-purple-400" />
      )}
      <span className="text-zinc-200">{id}</span>
    </span>
  );
}

function ResourceBadge({ type, id, tunnels, sites }) {
  if (type === SITE_RESOURCE) {
    const site = sites.find((x) => x.id === id);
    const route = site ? siteOwnerRoute(site) : null;
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <AppWindow className="w-3 h-3 text-cyan-400" />
        <span className="text-zinc-200">{site ? site.fqdn : id}</span>
        <span className="text-zinc-500">
          {route ? `site — web surface of ${route}` : site ? 'site' : 'site (deleted)'}
        </span>
      </span>
    );
  }
  if (type === 'tunnel') {
    const tunnel = tunnels.find((t) => t.id === id);
    const label = tunnel ? tunnel.fqdn : id;
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <Globe className="w-3 h-3 text-green-400" />
        <span className="text-zinc-200">{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Puzzle className="w-3 h-3 text-orange-400" />
      <span className="text-zinc-200">{id}</span>
    </span>
  );
}

/**
 * What an entitlement lacks on its plugin's restricted web surface — a
 * site grant admitting its principal — with a one-click grant; nothing when
 * the plugin has no such site, or the principal reaches it.
 */
function MissingSiteAccess({ grant, site, siteGrants, groups, onGrant, busy }) {
  const access = siteAccessOf(grant, siteGrants, groups);
  const text = missingSiteAccessText(grant, access, site.fqdn);
  if (!text) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-400"
        title={text}
      >
        <AlertTriangle className="w-3 h-3" />
        {grant.principalType === 'user'
          ? 'no site access'
          : `${access.without.length} without site access`}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={onGrant}
        title={`${text}. Grant ${site.fqdn}.`}
        className="inline-flex items-center gap-1 rounded bg-cyan-600/20 px-1.5 py-0.5 text-cyan-300 hover:bg-cyan-600/40 disabled:opacity-50"
      >
        <KeyRound className="w-3 h-3" /> Grant the site
      </button>
    </span>
  );
}

/**
 * Gatekeeper's grants. A plugin grant with `context.roles` is an
 * entitlement on an agent-hosted plugin (who is in its audience, with which
 * roles): it is shown here with its roles and managed in the plugin's
 * People panel — `onOpenPlugins`, when the host passes it, opens the
 * Plugins page. On a plugin whose web surface is restricted, an entitlement
 * whose principal holds no grant on its site is marked: the roles let them
 * in nowhere. A site grant names a plugin's site (its web surface).
 */
export default function GatekeeperGrantsPage({ onOpenPlugins }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [grantError, setGrantError] = useState(null);

  const grantsQuery = useQuery({
    queryKey: ['gatekeeper-grants'],
    queryFn: () => client.getGatekeeperGrants(),
    refetchInterval: 10_000,
  });

  const tunnelsQuery = useQuery({
    queryKey: ['tunnels'],
    queryFn: () => client.getTunnels(),
  });
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: () => client.getSites() });
  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId) => client.revokeGatekeeperGrant(grantId),
    // A revoked role or site grant changes a plugin's people and web surface.
    onSuccess: () => invalidateGrantViews(queryClient),
  });
  const grantSiteMutation = useMutation({
    mutationFn: ({ principal, siteId }) =>
      client.createGatekeeperGrant(siteGrantBody(principal, siteId)),
    onSuccess: () => {
      setGrantError(null);
      invalidateGrantViews(queryClient);
    },
    onError: (err) => {
      const { message, hint } = explainSiteGrantRefusal(err);
      setGrantError(hint ? `${message} — ${hint}` : message);
    },
  });

  const allGrants = grantsQuery.data?.grants || [];
  const tunnels = tunnelsQuery.data?.tunnels || [];
  const sites = sitesQuery.data?.sites || [];
  const groups = groupsQuery.data?.groups;
  const grants = filterType ? allGrants.filter((g) => g.resourceType === filterType) : allGrants;

  /** The restricted site of the plugin an entitlement names, with its grants; null otherwise. */
  const restrictedSiteOf = (grant) => {
    if (!isEntitlement(grant) || !groups) return null;
    const site = siteOfRoute(sites, grant.resourceId);
    if (!site || !siteGrantsDecide(site)) return null;
    return {
      site,
      siteGrants: allGrants.filter(
        (g) => g.resourceType === SITE_RESOURCE && g.resourceId === site.id,
      ),
    };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Access Grants</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded"
        >
          <Plus className="w-4 h-4" /> Create Grant
        </button>
      </div>

      <div className="flex gap-2">
        {[{ type: '', plural: 'All' }, ...RESOURCE_TYPES].map(({ type, plural }) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-3 py-1 text-xs rounded ${filterType === type ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {plural}
          </button>
        ))}
      </div>

      {grantError && <p className="text-sm text-red-400">{grantError}</p>}

      {grantsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : grants.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
          No grants yet.
        </div>
      ) : (
        <div className="space-y-2">
          {grants.map((grant) => {
            const restricted = restrictedSiteOf(grant);
            return (
              <div
                key={grant.grantId}
                className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded-lg"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <PrincipalBadge type={grant.principalType} id={grant.principalId} />
                  <span className="text-zinc-600 text-xs">
                    {isEntitlement(grant) ? 'holds roles on' : 'can access'}
                  </span>
                  <ResourceBadge
                    type={grant.resourceType}
                    id={grant.resourceId}
                    tunnels={tunnels}
                    sites={sites}
                  />
                  <GrantContext context={grant.context} />
                  {isEntitlement(grant) && (
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <UsersRound className="w-3 h-3" />
                      plugin roles — managed in its People panel
                      {onOpenPlugins && (
                        <button
                          type="button"
                          onClick={onOpenPlugins}
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          (open Plugins)
                        </button>
                      )}
                    </span>
                  )}
                  {restricted && (
                    <MissingSiteAccess
                      grant={grant}
                      site={restricted.site}
                      siteGrants={restricted.siteGrants}
                      groups={groups}
                      busy={grantSiteMutation.isPending}
                      onGrant={() =>
                        grantSiteMutation.mutate({
                          principal: {
                            principalType: grant.principalType,
                            principalId: grant.principalId,
                          },
                          siteId: restricted.site.id,
                        })
                      }
                    />
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-600">
                    {new Date(grant.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => {
                      if (confirm('Revoke this grant?')) revokeMutation.mutate(grant.grantId);
                    }}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <CreateGrantModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
