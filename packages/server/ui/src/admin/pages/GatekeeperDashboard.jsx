import { useQuery } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { Shield, Users, Key, Globe, Loader2 } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

export default function GatekeeperDashboardPage() {
  const client = useAdminClient();

  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
    refetchInterval: 30_000,
  });

  const grantsQuery = useQuery({
    queryKey: ['gatekeeper-grants'],
    queryFn: () => client.getGatekeeperGrants(),
    refetchInterval: 30_000,
  });

  const tunnelsQuery = useQuery({
    queryKey: ['tunnels'],
    queryFn: () => client.getTunnels(),
    refetchInterval: 30_000,
  });

  const groups = groupsQuery.data?.groups || [];
  const grants = grantsQuery.data?.grants || [];
  const tunnels = tunnelsQuery.data?.tunnels || [];

  const restrictedTunnels = tunnels.filter((t) => t.accessMode === 'restricted');
  const uniqueUsers = new Set(
    grants.filter((g) => g.principalType === 'user').map((g) => g.principalId),
  );

  const isLoading = groupsQuery.isLoading || grantsQuery.isLoading || tunnelsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 p-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-cyan-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Gatekeeper</h1>
      </div>

      <p className="text-sm text-zinc-500">
        Access control overview. Manage groups and grants to control who can access your tunnels and plugins.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Groups" value={groups.length} color="text-purple-400" />
        <StatCard icon={Key} label="Grants" value={grants.length} color="text-cyan-400" />
        <StatCard icon={Users} label="Users with access" value={uniqueUsers.size} color="text-blue-400" />
        <StatCard icon={Globe} label="Restricted tunnels" value={restrictedTunnels.length} color="text-orange-400" />
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-sm font-medium text-zinc-300 mb-3">Recent Grants</h2>
        {grants.length === 0 ? (
          <p className="text-xs text-zinc-600">No grants yet.</p>
        ) : (
          <div className="space-y-2">
            {grants
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 10)
              .map((g) => (
                <div key={g.grantId} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">
                    <span className={g.principalType === 'user' ? 'text-blue-400' : 'text-purple-400'}>
                      {g.principalId}
                    </span>
                    {' '}<span className="text-zinc-600">can access</span>{' '}
                    <span className={g.resourceType === 'tunnel' ? 'text-green-400' : 'text-orange-400'}>
                      {g.resourceId}
                    </span>
                  </span>
                  <span className="text-zinc-600">{new Date(g.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
