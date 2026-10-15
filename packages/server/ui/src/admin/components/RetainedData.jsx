import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Eraser, Trash2 } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { PluginOperation } from './PluginLifecycle.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { refusalText } from '../lib/pluginRefusal.js';

/**
 * What one agent keeps of an agent half Lamaste removed without purge — its
 * data directory and account — with the two ways to settle it: **Purge**
 * deletes both through the agent's app host helper (an operation, followed
 * on the plugin's card or under its name below, push-gated as `uninstall`),
 * **Forget** drops only the relay's record and leaves the agent alone.
 */
function RetainedDataRow({ record, isActing }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [confirming, setConfirming] = useState(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['plugins'] });
    queryClient.invalidateQueries({ queryKey: ['plugin-operations', record.plugin] });
  };
  const purge = useMutation({
    mutationFn: () => client.purgePluginRetainedData(record.plugin, record.agentLabel),
    onSuccess: () => {
      refresh();
      addToast(
        `Purging what ${record.agentLabel} keeps of "${record.plugin}" — follow the steps under its name`,
      );
    },
    onError: (err) =>
      addToast(refusalText(err, { agentLabel: record.agentLabel, action: 'uninstall' }), 'error'),
  });
  const forget = useMutation({
    mutationFn: () => client.forgetPluginRetainedData(record.plugin, record.agentLabel),
    onSuccess: () => {
      refresh();
      addToast(
        `Forgot the record — ${record.dataDir} stays on ${record.agentLabel} until it is removed there`,
      );
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const busy = isActing || purge.isPending || forget.isPending;

  const confirmButtons = (label, onYes, danger) => (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setConfirming(null);
          onYes();
        }}
        className={`rounded px-2 py-1 text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-zinc-600 hover:bg-zinc-500'}`}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(null)}
        className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
      >
        Cancel
      </button>
    </span>
  );

  return (
    <li className="rounded bg-zinc-900 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-zinc-200">{record.agentLabel}</span>
        <span className="text-zinc-500">
          route <span className="font-mono text-zinc-300">{record.route}</span>
        </span>
        <span className="font-mono text-zinc-400">{record.package}</span>
        <span className="text-zinc-600">since {new Date(record.since).toLocaleString()}</span>
      </div>
      <div className="font-mono text-zinc-500">
        {record.dataDir} <span className="text-zinc-600">· account</span> {record.serviceUser}
      </div>

      {confirming === 'purge' && (
        <div className="mt-1.5 space-y-1.5">
          <p className="flex items-start gap-1 text-red-400">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>
              Delete <span className="font-mono">{record.dataDir}</span> and the account{' '}
              <span className="font-mono">{record.serviceUser}</span> on agent{' '}
              <span className="font-mono">{record.agentLabel}</span> (route{' '}
              <span className="font-mono">{record.route}</span>)? The agent&apos;s app host helper
              deletes them once push install lets Lamaste remove{' '}
              <span className="font-mono">{record.package}</span> there — this cannot be undone.
            </span>
          </p>
          {confirmButtons('Purge', () => purge.mutate(), true)}
        </div>
      )}
      {confirming === 'forget' && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-zinc-400">
            Drop only the relay&apos;s record? Nothing on{' '}
            <span className="font-mono">{record.agentLabel}</span> changes:{' '}
            <span className="font-mono">{record.dataDir}</span> and the account{' '}
            <span className="font-mono">{record.serviceUser}</span> stay on the machine — remove
            them there with{' '}
            <span className="font-mono">
              sudo lamaste-agent apphost remove {record.route} --purge
            </span>
            . For an agent that is gone, or data already removed by hand.
          </p>
          {confirmButtons('Forget', () => forget.mutate(), false)}
        </div>
      )}
      {confirming === null && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming('purge')}
            title="Delete the data directory and the account on the agent (a push: uninstall)"
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 size={11} />
            Purge…
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming('forget')}
            title="Drop the relay's record only; the data stays on the agent"
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            <Eraser size={11} />
            Forget…
          </button>
        </div>
      )}
    </li>
  );
}

function RetainedDataList({ records, isActing }) {
  return (
    <ul className="space-y-1.5">
      {records.map((record) => (
        <RetainedDataRow
          key={`${record.agentLabel}/${record.route}`}
          record={record}
          isActing={isActing}
        />
      ))}
    </ul>
  );
}

/** On a plugin's card: what agents keep of its agent half (`plugin.retainedData`). */
export function PluginRetainedData({ plugin, isActing }) {
  const records = plugin.retainedData ?? [];
  if (records.length === 0) return null;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <Archive size={12} className="text-cyan-400" />
        <span className="text-zinc-300 font-medium">Retained data</span>
      </div>
      <p className="mb-2 text-zinc-500">
        Its agent half was removed without purge: these agents keep its data and account. Hosting
        the same agent package there again takes the data back; another package is refused until it
        is purged.
      </p>
      <RetainedDataList records={records} isActing={isActing} />
    </div>
  );
}

/**
 * What agents keep of plugins that are no longer installed (the top-level
 * `retainedData` of the plugin list, less the installed plugins'), by the
 * name each plugin had — each with its latest operation, so a purge is
 * followed here like any other.
 */
export function UninstalledRetainedData({ records, installedNames, isActing }) {
  const byPlugin = new Map();
  for (const record of records) {
    if (installedNames.has(record.plugin)) continue;
    byPlugin.set(record.plugin, [...(byPlugin.get(record.plugin) ?? []), record]);
  }
  if (byPlugin.size === 0) return null;
  return (
    <section className="rounded-lg bg-zinc-900 border border-zinc-800 p-5 mt-8 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <Archive size={14} className="text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-300">
          Retained data of uninstalled plugins
        </h2>
      </div>
      <p className="mb-4 text-zinc-500">
        These plugins are uninstalled, but agents keep the data and account of their agent halves.
        Purge it, or forget the record once it is gone from the agent.
      </p>
      <div className="space-y-4">
        {[...byPlugin.entries()].map(([name, list]) => (
          <div key={name}>
            <p className="mb-2 font-mono text-sm text-zinc-200">{name}</p>
            <PluginOperation plugin={name} />
            <RetainedDataList records={list} isActing={isActing} />
          </div>
        ))}
      </div>
    </section>
  );
}
