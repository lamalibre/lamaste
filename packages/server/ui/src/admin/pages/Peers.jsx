import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Cable, Trash2, Upload } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { ConfirmDialog } from '../components/Dialog.jsx';
import RefreshNote from '../components/RefreshNote.jsx';
import { usePeers } from '../components/PluginPeers.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { failedWithoutData } from '../lib/query-refresh.js';
import { channelStateText, parseShelfScopes, pendingReasonText } from '../lib/peers.js';

/** A shelf id: a DNS label. */
const SHELF_ID_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Apply a shelf's scope graph by hand: its id and the shelf manifest's
 * `scopes` block (or the whole manifest). Shelf applies a shelf from its own
 * page the same way; the relay checks every edge against the installed
 * plugins' declarations.
 */
function ApplyForm() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [shelfId, setShelfId] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const apply = useMutation({
    mutationFn: ({ id, scopes }) => client.applyPeerShelf(id, scopes),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      addToast(`Shelf "${id}" applied`);
      setText('');
      setError(null);
    },
    onError: (err) => setError(err.code ? `${errorMessage(err)} (${err.code})` : errorMessage(err)),
  });
  const submit = (e) => {
    e.preventDefault();
    if (!SHELF_ID_RE.test(shelfId)) {
      setError('A shelf id is a DNS label: lower-case letters, digits and hyphens');
      return;
    }
    const parsed = parseShelfScopes(text);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    apply.mutate({ id: shelfId, scopes: parsed.scopes });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={shelfId}
        onChange={(e) => setShelfId(e.target.value.trim())}
        placeholder="shelf id, e.g. company-ops"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={'{ "directory:read": { "provider": "directory", "consumers": ["leave"] } }'}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white"
      />
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle size={12} /> {error}
        </p>
      )}
      <button
        type="submit"
        disabled={apply.isPending || !shelfId || !text}
        className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        <Upload size={14} />
        {apply.isPending ? 'Applying…' : 'Apply'}
      </button>
    </form>
  );
}

/**
 * Calls and events between app plugins: the shelves applied to this relay
 * and their edges — effective, or pending with the reason — the consumers'
 * peer channels, and removing a shelf.
 */
export default function Peers() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const peersQuery = usePeers();
  const [removing, setRemoving] = useState(null);
  const remove = useMutation({
    mutationFn: (id) => client.removePeerShelf(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['peers'] });
      addToast(`Shelf "${id}" removed — its edges no longer grant anything`);
      setRemoving(null);
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
      setRemoving(null);
    },
  });
  const view = peersQuery.data;
  const channels = Object.entries(view?.channels ?? {});

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-white">
          <Cable size={20} /> Peers
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Calls and events between app plugins. A plugin may call another only along an edge an
          applied shelf grants, and only the endpoints and events the provider declares.
        </p>
      </div>

      <RefreshNote query={peersQuery} />
      {failedWithoutData(peersQuery) ? (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-sm text-red-400">
          <AlertCircle size={16} /> Failed to load the peers state
        </div>
      ) : (
        <>
          {(view?.shelves ?? []).length === 0 && !peersQuery.isLoading && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
              No shelf is applied: no plugin may call another.
            </div>
          )}
          {(view?.shelves ?? []).map((shelf) => (
            <div key={shelf.shelfId} className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-mono text-sm font-semibold text-zinc-200">{shelf.shelfId}</h2>
                  <p className="text-xs text-zinc-500">
                    applied {new Date(shelf.appliedAt).toLocaleString()}
                    {shelf.appliedBy ? ` by ${shelf.appliedBy}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRemoving(shelf.shelfId)}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-red-400"
                >
                  <Trash2 size={12} /> Remove
                </button>
              </div>
              {shelf.edges.length === 0 ? (
                <p className="text-xs text-zinc-500">No edges.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="py-1 font-normal">consumer</th>
                      <th className="py-1 font-normal">scope</th>
                      <th className="py-1 font-normal">provider</th>
                      <th className="py-1 font-normal">state</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shelf.edges.map((edge) => (
                      <tr key={`${edge.consumer} ${edge.scope}`} className="text-zinc-300">
                        <td className="py-1 font-mono">{edge.consumer}</td>
                        <td className="py-1 font-mono">{edge.scope}</td>
                        <td className="py-1 font-mono">{edge.provider}</td>
                        <td className="py-1">
                          {edge.state === 'effective' ? (
                            <span className="text-green-400">effective</span>
                          ) : (
                            <span className="text-yellow-400/90">
                              pending — {pendingReasonText(edge.reason)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}

          {channels.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">Peer channels</h2>
              <ul className="space-y-1 text-xs">
                {channels.map(([consumer, channel]) => (
                  <li key={consumer} className="text-zinc-300">
                    <span className="font-mono">{consumer}</span>{' '}
                    <span
                      className={
                        channel.state === 'attached' ? 'text-green-400' : 'text-yellow-400/90'
                      }
                    >
                      {channelStateText(channel)}
                    </span>
                    {channel.lastError && (
                      <span className="text-zinc-500"> — {channel.lastError}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">Apply a shelf</h2>
        <ApplyForm />
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove shelf "${removing}"?`}
          message="Its edges stop granting anything: the calls and event subscriptions only it grants stop at once."
          confirmLabel="Remove"
          destructive
          isPending={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
