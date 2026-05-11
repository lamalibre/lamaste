import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { Key, Plus, Trash2, Loader2, User, Users, Globe, Puzzle } from 'lucide-react';
import { errorMessage } from '../lib/errorMessage.js';

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

  const mutation = useMutation({
    mutationFn: (data) => client.createGatekeeperGrant(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatekeeper-grants'] });
      onClose();
    },
    onError: (err) => setApiError(errorMessage(err)),
  });

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      setApiError(null);
      if (!principalId || !resourceId) return;
      const context = {};
      if (resourceType === 'plugin' && target) context.target = target;
      mutation.mutate({ principalType, principalId, resourceType, resourceId, context });
    },
    [principalType, principalId, resourceType, resourceId, target, mutation],
  );

  const users = usersQuery.data?.users || [];
  const groups = groupsQuery.data?.groups || [];
  const tunnels = (tunnelsQuery.data?.tunnels || []).filter((t) => t.type !== 'panel');

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
              <button
                type="button"
                onClick={() => {
                  setResourceType('tunnel');
                  setResourceId('');
                }}
                className={`px-3 py-1 text-xs rounded ${resourceType === 'tunnel' ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
              >
                Tunnel
              </button>
              <button
                type="button"
                onClick={() => {
                  setResourceType('plugin');
                  setResourceId('');
                }}
                className={`px-3 py-1 text-xs rounded ${resourceType === 'plugin' ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
              >
                Plugin
              </button>
            </div>
            {resourceType === 'tunnel' ? (
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

function ResourceBadge({ type, id, tunnels }) {
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

export default function GatekeeperGrantsPage() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterType, setFilterType] = useState('');

  const grantsQuery = useQuery({
    queryKey: ['gatekeeper-grants'],
    queryFn: () => client.getGatekeeperGrants(),
    refetchInterval: 10_000,
  });

  const tunnelsQuery = useQuery({
    queryKey: ['tunnels'],
    queryFn: () => client.getTunnels(),
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId) => client.revokeGatekeeperGrant(grantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gatekeeper-grants'] }),
  });

  let grants = grantsQuery.data?.grants || [];
  const tunnels = tunnelsQuery.data?.tunnels || [];

  if (filterType) {
    grants = grants.filter((g) => g.resourceType === filterType);
  }

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
        {['', 'tunnel', 'plugin'].map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-3 py-1 text-xs rounded ${filterType === type ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {type === '' ? 'All' : type === 'tunnel' ? 'Tunnels' : 'Plugins'}
          </button>
        ))}
      </div>

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
          {grants.map((grant) => (
            <div
              key={grant.grantId}
              className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded-lg"
            >
              <div className="flex items-center gap-4">
                <PrincipalBadge type={grant.principalType} id={grant.principalId} />
                <span className="text-zinc-600 text-xs">can access</span>
                <ResourceBadge type={grant.resourceType} id={grant.resourceId} tunnels={tunnels} />
                {grant.context && Object.keys(grant.context).length > 0 && (
                  <span className="text-xs text-zinc-600">
                    (
                    {Object.entries(grant.context)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(', ')}
                    )
                  </span>
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
          ))}
        </div>
      )}

      {showCreate && <CreateGrantModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
