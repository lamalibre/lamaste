import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { MessageSquare, Trash2, Loader2 } from 'lucide-react';

export default function GatekeeperAccessRequestsPage() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const [limit] = useState(50);

  const logQuery = useQuery({
    queryKey: ['gatekeeper-access-log', limit],
    queryFn: () => client.getAccessRequestLog(limit, 0),
    refetchInterval: 15_000,
  });

  const clearMutation = useMutation({
    mutationFn: () => client.clearAccessRequestLog(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gatekeeper-access-log'] }),
  });

  const entries = logQuery.data?.entries || [];
  const total = logQuery.data?.total || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Access Requests</h1>
        </div>
        {entries.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Clear all access request logs?')) clearMutation.mutate();
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-400 hover:text-red-400 border border-zinc-700 rounded"
          >
            <Trash2 className="w-4 h-4" /> Clear Log
          </button>
        )}
      </div>

      <p className="text-sm text-zinc-500">
        Denied access attempts. Shows users who tried to access restricted tunnels without grants.
        {total > 0 && <span className="text-zinc-400"> ({total} total entries)</span>}
      </p>

      {logQuery.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center text-zinc-500">
          No access requests logged.
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Time</th>
                <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">User</th>
                <th className="text-left px-4 py-2 text-xs text-zinc-500 font-medium">Resource</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-2 text-xs text-zinc-500">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-zinc-300">{entry.username}</td>
                  <td className="px-4 py-2 text-zinc-300">
                    {entry.resourceFqdn || entry.resourceId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
