import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Smartphone, XCircle } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { ConfirmDialog, Modal } from './Dialog.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { relativeTime } from '../lib/formatters.js';
import { filterGrantsByPerson, grantEndText } from '../lib/native-apps.js';

/** Refetch every view of native grants. */
export function invalidateNativeGrants(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['native-grants'] });
  queryClient.invalidateQueries({ queryKey: ['user-native-grants'] });
}

function when(iso) {
  return iso ? <span title={iso}>{relativeTime(iso)}</span> : <span>—</span>;
}

/**
 * A table of grants — one person signed in on one device with one native
 * client: who, which device, since when, last used, until when, and an End
 * button for a live one. `showClient` adds the client's id (a person's
 * devices across clients).
 */
export function NativeGrantsTable({ grants, showClient = false, showPerson = true }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState(null);
  const revoke = useMutation({
    mutationFn: (grant) => client.revokeNativeGrant(grant.clientId, grant.grantId),
    onSuccess: () => {
      invalidateNativeGrants(queryClient);
      toast('Grant ended — that device is signed out');
      setTarget(null);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setTarget(null);
    },
  });

  if (grants.length === 0) {
    return <p className="text-xs text-zinc-500">No grants.</p>;
  }
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-800 text-zinc-500">
            <tr>
              {showPerson && <th className="px-3 py-2">Person</th>}
              {showClient && <th className="px-3 py-2">Client</th>}
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">Signed in</th>
              <th className="px-3 py-2">Last used</th>
              <th className="px-3 py-2">Ends</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {grants.map((g) => (
              <tr key={g.grantId} className="align-top">
                {showPerson && (
                  <td className="px-3 py-2 font-mono text-cyan-400">{g.username ?? g.userId}</td>
                )}
                {showClient && <td className="px-3 py-2 font-mono text-zinc-300">{g.clientId}</td>}
                <td className="px-3 py-2 text-zinc-300">
                  {g.deviceName ?? <span className="text-zinc-500">unnamed</span>}
                  {g.userAgent && <div className="text-zinc-500">{g.userAgent}</div>}
                </td>
                <td className="px-3 py-2 text-zinc-400">{when(g.createdAt)}</td>
                <td className="px-3 py-2 text-zinc-400">{when(g.lastUsedAt)}</td>
                <td className="px-3 py-2 text-zinc-400">
                  {g.status === 'live' ? (
                    when(g.expiresAt)
                  ) : (
                    <span className="text-zinc-500">
                      ended {relativeTime(g.endedAt)} — {grantEndText(g.endedReason)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {g.status === 'live' && (
                    <button
                      type="button"
                      onClick={() => setTarget(g)}
                      className="inline-flex items-center gap-1 rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                      title="End this grant: the device is signed out"
                    >
                      <XCircle size={14} /> End
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <ConfirmDialog
          title="End this grant?"
          message={`${target.username ?? target.userId} is signed out on ${target.deviceName ?? 'this device'} at once; its access tokens stop working.`}
          confirmLabel="End grant"
          destructive
          isPending={revoke.isPending}
          onConfirm={() => revoke.mutate(target)}
          onCancel={() => setTarget(null)}
        />
      )}
    </>
  );
}

/** A native client's grants, live or ended, filterable by person. */
export function ClientGrants({ clientId }) {
  const client = useAdminClient();
  const [status, setStatus] = useState('live');
  const [person, setPerson] = useState('');
  const grants = useQuery({
    queryKey: ['native-grants', clientId, status],
    queryFn: () => client.listNativeGrants(clientId, { status }),
    refetchInterval: 30000,
  });
  const list = filterGrantsByPerson(grants.data?.grants ?? [], person);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder="Filter by person"
          aria-label="Filter by person"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Grant status"
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
        >
          <option value="live">live</option>
          <option value="ended">ended</option>
          <option value="all">all</option>
        </select>
      </div>
      {grants.isLoading ? (
        <p className="text-xs text-zinc-500">Loading grants…</p>
      ) : grants.isError ? (
        <p className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle size={14} /> {errorMessage(grants.error)}
        </p>
      ) : (
        <NativeGrantsTable grants={list} />
      )}
    </div>
  );
}

/** A person's devices: their grants with every native client. */
export function UserNativeGrantsModal({ username, onClose }) {
  const client = useAdminClient();
  const grants = useQuery({
    queryKey: ['user-native-grants', username],
    queryFn: () => client.getUserNativeGrants(username, { status: 'all' }),
  });
  const list = grants.data?.grants ?? [];
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-white">
        <Smartphone size={18} className="text-cyan-400" /> Devices of {username}
      </h2>
      <p className="mb-4 text-sm text-zinc-400">
        Native app sign-ins, one per device. Ending one signs that device out at once.
      </p>
      {grants.isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : grants.isError ? (
        <p className="text-xs text-red-400">{errorMessage(grants.error)}</p>
      ) : (
        <NativeGrantsTable grants={list} showClient showPerson={false} />
      )}
    </Modal>
  );
}
