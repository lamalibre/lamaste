import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Cable } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { Modal, DialogButtons } from './Dialog.jsx';
import {
  breakReasonText,
  channelStateText,
  declaresPeers,
  edgesOf,
  pendingReasonText,
} from '../lib/peers.js';

/** The relay's peers state, shared by every card and the Peers page. */
export function usePeers() {
  const client = useAdminClient();
  return useQuery({
    queryKey: ['peers'],
    queryFn: () => client.getPeers(),
    refetchInterval: 10_000,
  });
}

/**
 * A `peers` block an approval covers: the scopes the plugin provides —
 * endpoints and events other plugins may reach, by major — and the scopes it
 * consumes, with the events it subscribes to.
 */
export function PeersBlockView({ block }) {
  const provides = Object.entries(block?.provides ?? {});
  const consumes = Object.entries(block?.consumes ?? {});
  return (
    <div className="space-y-1 text-zinc-400">
      {provides.map(([scope, entry]) => (
        <div key={`p ${scope}`}>
          <span className="text-zinc-500">provides </span>
          <span className="font-mono text-zinc-300" title={entry.description}>
            {scope}
          </span>
          <span className="text-zinc-500"> (major {entry.majors.join(', ')}) — </span>
          <span className="font-mono text-zinc-300">
            {entry.endpoints.map((e) => `${e.method} ${e.path}`).join(', ')}
          </span>
          {entry.events.length > 0 && (
            <span>
              <span className="text-zinc-500"> · events </span>
              <span className="font-mono text-zinc-300">{entry.events.join(', ')}</span>
            </span>
          )}
        </div>
      ))}
      {consumes.map(([scope, entry]) => (
        <div key={`c ${scope}`}>
          <span className="text-zinc-500">consumes </span>
          <span className="font-mono text-zinc-300" title={entry.reason}>
            {scope}
          </span>
          <span className="text-zinc-500">
            {' '}
            (major {entry.major}
            {entry.required ? ', required' : ', optional'})
          </span>
          {entry.events.length > 0 && (
            <span>
              <span className="text-zinc-500"> · subscribes to </span>
              <span className="font-mono text-zinc-300">{entry.events.join(', ')}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * What an update changes in the plugin's `peers` block
 * (`pendingUpdate.peers`: `{ before, after, diff, breaks }`): the new block,
 * and the edges granted consumers rely on that it would end or narrow.
 */
export function PeersChanges({ peers }) {
  if (!peers) return null;
  return (
    <div className="space-y-2">
      <p className="text-zinc-500">
        Peers — what this version lets other plugins call and receive, and what it calls itself:
      </p>
      {peers.after ? (
        <PeersBlockView block={peers.after} />
      ) : (
        <p className="text-zinc-400">This version declares no peers block.</p>
      )}
      {peers.breaks.length > 0 && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">
          <p className="mb-1 flex items-center gap-1">
            <AlertTriangle size={12} /> It breaks plugins that rely on it:
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {peers.breaks.map((b) => (
              <li key={`${b.consumer} ${b.scope} ${b.reason}`}>
                <span className="font-mono">{b.consumer}</span> on{' '}
                <span className="font-mono">{b.scope}</span>: {breakReasonText(b.reason)}
                {b.endpoints && <span className="font-mono"> ({b.endpoints.join(', ')})</span>}
                {b.events && <span className="font-mono"> ({b.events.join(', ')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EdgeRow({ edge, other }) {
  return (
    <li className="flex flex-wrap items-center gap-x-1">
      <span className="font-mono text-zinc-300">{other}</span>
      <span className="text-zinc-500">·</span>
      <span className="font-mono text-zinc-400">{edge.scope}</span>
      {edge.state === 'effective' ? (
        <span className="text-green-400">effective</span>
      ) : (
        <span className="text-yellow-400/90" title={pendingReasonText(edge.reason)}>
          pending — {pendingReasonText(edge.reason)}
        </span>
      )}
      <span className="text-zinc-600">({edge.shelves.join(', ')})</span>
    </li>
  );
}

/**
 * A plugin card's Peers section: what it provides and consumes, the applied
 * edges into and out of it (effective, or pending with the reason, and the
 * shelves that grant them), its peer channel — the relay's way in for the
 * calls it makes — and whether its agent half answered the peers protocol
 * for its installed version.
 */
export default function PluginPeers({ plugin }) {
  const peersQuery = usePeers();
  if (!declaresPeers(plugin.peers)) return null;
  const route = plugin.route ?? plugin.name;
  const view = peersQuery.data;
  const { incoming, outgoing } = edgesOf(view, route);
  const consumes = Object.keys(plugin.peers.consumes ?? {}).length > 0;
  const channel = view?.channels?.[route];
  const ready = view?.readiness?.[route];

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3 text-xs space-y-2">
      <div className="flex items-center gap-2 text-zinc-300">
        <Cable size={13} />
        <span className="font-semibold">Peers</span>
        <span className={ready ? 'text-green-400' : 'text-zinc-500'}>
          {ready ? `ready (${ready.version})` : 'not ready'}
        </span>
        {consumes && (
          <span
            className={channel?.state === 'attached' ? 'text-green-400' : 'text-yellow-400/90'}
            title={channel?.lastError ?? undefined}
          >
            · channel {channelStateText(channel)}
          </span>
        )}
      </div>
      <PeersBlockView block={plugin.peers} />
      {peersQuery.isError && (
        <p className="text-red-400">The relay&apos;s peers state could not be read.</p>
      )}
      {incoming.length > 0 && (
        <div>
          <p className="flex items-center gap-1 text-zinc-500">
            <ArrowDownLeft size={12} /> called by
          </p>
          <ul className="space-y-0.5 pl-4">
            {incoming.map((edge) => (
              <EdgeRow key={`${edge.consumer} ${edge.scope}`} edge={edge} other={edge.consumer} />
            ))}
          </ul>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <p className="flex items-center gap-1 text-zinc-500">
            <ArrowUpRight size={12} /> calls
          </p>
          <ul className="space-y-0.5 pl-4">
            {outgoing.map((edge) => (
              <EdgeRow key={`${edge.consumer} ${edge.scope}`} edge={edge} other={edge.provider} />
            ))}
          </ul>
        </div>
      )}
      {view && incoming.length === 0 && outgoing.length === 0 && (
        <p className="text-zinc-500">
          No applied shelf grants it anything yet — apply one from Shelf or on the Peers page.
        </p>
      )}
    </div>
  );
}

/**
 * The relay refused to remove a plugin other plugins rely on
 * (`peer_dependents`): who would lose their calls and events, and the
 * explicit choice to go on anyway (`breakPeers`).
 */
export function PeerDependentsDialog({ refusal, isPending, onConfirm, onCancel }) {
  const { name, consumers, kind } = refusal;
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
        <AlertTriangle size={18} className="text-red-400" />
        Other plugins rely on {name}
      </h2>
      <p className="mb-3 text-sm text-zinc-400">
        {kind === 'unhost' ? 'Removing its hosting' : 'Uninstalling it'} stops their calls and
        events into it:
      </p>
      <ul className="mb-4 space-y-1 text-sm">
        {consumers.map((c) => (
          <li key={c.consumer} className="text-zinc-300">
            <span className="font-mono">{c.consumer}</span>
            <span className="text-zinc-500"> — {c.scopes.join(', ')}</span>
            {c.required && <span className="text-red-400"> (required)</span>}
          </li>
        ))}
      </ul>
      <p className="mb-4 text-xs text-zinc-500">
        Removing the edges from the applied shelves first is the clean way.
      </p>
      <DialogButtons
        confirmLabel="Break them and go on"
        destructive
        isPending={isPending}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}
