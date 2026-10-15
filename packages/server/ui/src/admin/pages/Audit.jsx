import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, CheckCheck, ScrollText } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';

const PAGE = 50;

const LEVEL_STYLE = {
  info: 'text-cyan-400',
  warning: 'text-yellow-400',
  critical: 'text-red-400',
};

function Notifications() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => client.getNotifications({ limit: 50 }),
    refetchInterval: 30000,
  });
  const markAll = useMutation({
    mutationFn: () => client.markNotificationsRead({ all: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const notifications = query.data?.notifications ?? [];
  const unread = query.data?.unread ?? 0;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
          <Bell size={14} className="text-cyan-400" /> Notifications
          {unread > 0 && (
            <span className="rounded-full bg-cyan-500/20 px-2 text-xs text-cyan-400">{unread}</span>
          )}
        </h2>
        {unread > 0 && (
          <button
            type="button"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            <CheckCheck size={12} /> Mark all read
          </button>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-xs text-zinc-500">Nothing to report.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {notifications.map((n) => (
            <li key={n.id} className={`flex gap-3 ${n.read ? 'opacity-60' : ''}`}>
              <span className="shrink-0 text-zinc-500">{new Date(n.at).toLocaleString()}</span>
              <span className={`shrink-0 ${LEVEL_STYLE[n.level] ?? 'text-zinc-400'}`}>
                {n.level}
              </span>
              <span className="shrink-0 font-mono text-zinc-500">{n.source}</span>
              {/* Plain text: a plugin hook may have written it. */}
              <span className="text-zinc-300 break-words">{n.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDetails(details) {
  return Object.entries(details ?? {})
    .map(([k, v]) => `${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('  ');
}

/**
 * The panel's audit log — approvals of relay hooks, auto-approve changes,
 * hostings, installs, updates, uninstalls, and what plugins' hooks report
 * through the audit effect — with the panel notifications above it.
 */
export default function Audit() {
  const client = useAdminClient();
  const [plugin, setPlugin] = useState('');
  const [action, setAction] = useState('');
  const filters = { plugin: plugin.trim() || undefined, action: action.trim() || undefined };

  const query = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) =>
      client.getAuditLog({ ...filters, limit: PAGE, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: undefined,
    getNextPageParam: (last) =>
      last.entries.length === PAGE ? last.entries[last.entries.length - 1].id : undefined,
    refetchInterval: 30000,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Audit</h1>
        <p className="text-zinc-500 text-sm mt-1">
          What administrators decided and what plugins&apos; hooks reported — metadata only, never a
          request or response body.
        </p>
      </div>

      <Notifications />

      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <ScrollText size={14} className="text-cyan-400" />
          <h2 className="text-sm font-semibold text-zinc-300 mr-4">Audit log</h2>
          <input
            type="text"
            value={plugin}
            onChange={(e) => setPlugin(e.target.value)}
            placeholder="plugin"
            className="w-36 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-cyan-400"
          />
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="action, or prefix ending in ."
            className="w-56 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-cyan-400"
          />
        </div>
        {query.isError ? (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} /> Failed to load the audit log
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-zinc-500">{query.isLoading ? 'Loading…' : 'No entries.'}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="pb-2 pr-3 font-normal">When</th>
                <th className="pb-2 pr-3 font-normal">Action</th>
                <th className="pb-2 pr-3 font-normal">Actor</th>
                <th className="pb-2 pr-3 font-normal">Plugin</th>
                <th className="pb-2 font-normal">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-zinc-800 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500">
                    {new Date(e.at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-cyan-400">{e.action}</td>
                  <td className="py-1.5 pr-3 font-mono text-zinc-300">{e.actor}</td>
                  <td className="py-1.5 pr-3 font-mono text-zinc-300">{e.plugin ?? ''}</td>
                  <td className="py-1.5 font-mono text-zinc-500 break-all">
                    {formatDetails(e.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {query.hasNextPage && (
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
            className="mt-3 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Load older
          </button>
        )}
      </div>
    </div>
  );
}
