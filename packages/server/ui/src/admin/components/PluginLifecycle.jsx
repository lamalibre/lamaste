import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Loader2,
  Minus,
  ShieldAlert,
  ShieldCheck,
  Download,
  X,
  XCircle,
} from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { refusalText } from '../lib/pluginRefusal.js';

/** `0123…cdef` — enough of a digest to compare by eye. */
function short(digest) {
  return digest ? `${digest.slice(0, 8)}…${digest.slice(-6)}` : '';
}

/** `sha512-AbCdEfGhIj…uvwxyz==` — enough of a tarball integrity to compare by eye. */
function shortIntegrity(integrity) {
  return integrity.length > 32 ? `${integrity.slice(0, 17)}…${integrity.slice(-8)}` : integrity;
}

const STEP_ICON = {
  done: <CheckCircle2 size={12} className="text-green-400" />,
  failed: <XCircle size={12} className="text-red-400" />,
  skipped: <Minus size={12} className="text-zinc-600" />,
  running: <Loader2 size={12} className="text-cyan-400 animate-spin" />,
};

const STATUS_STYLE = {
  running: 'text-cyan-400',
  succeeded: 'text-green-400',
  'rolled-back': 'text-yellow-400',
  failed: 'text-red-400',
  interrupted: 'text-red-400',
};

const KIND_LABEL = {
  host: 'Hosting',
  unhost: 'Removing the hosting',
  update: 'Update',
  uninstall: 'Uninstall',
  'purge-data': 'Purging retained data',
};

/**
 * A plugin's latest operation (hosting, unhosting, update, uninstall,
 * purging the data an agent kept of its agent half) and
 * its steps, followed while it runs. Shown until it is older than ten
 * minutes, so an outcome — a rollback, a failed stage — stays visible.
 */
export function PluginOperation({ plugin }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['plugin-operations', plugin],
    queryFn: () => client.getPluginOperations(plugin),
    refetchInterval: (q) => (q.state.data?.operations?.[0]?.status === 'running' ? 2000 : 15000),
  });
  const op = query.data?.operations?.[0];
  const status = op?.status;
  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current === 'running' && status !== 'running') {
      // An operation just ended: what it changed shows elsewhere on the page.
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
      queryClient.invalidateQueries({ queryKey: ['plugin-hooks', plugin] });
    }
    previousStatus.current = status;
  }, [status, plugin, queryClient]);
  if (!op) return null;
  const finished = op.finishedAt ? Date.parse(op.finishedAt) : null;
  // Measured against when the list was fetched, which the query refreshes.
  if (finished && query.dataUpdatedAt - finished > 10 * 60_000) return null;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-zinc-300 font-medium">{KIND_LABEL[op.kind] ?? op.kind}</span>
        <span className={STATUS_STYLE[op.status] ?? 'text-zinc-400'}>
          {op.status === 'rolled-back' ? 'rolled back' : op.status}
        </span>
        <span className="text-zinc-600">by {op.actor}</span>
      </div>
      <ul className="space-y-1">
        {op.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5">{STEP_ICON[step.status] ?? <Circle size={12} />}</span>
            <span className={step.status === 'skipped' ? 'text-zinc-600' : 'text-zinc-300'}>
              {step.name}
              {(step.error || step.detail) && (
                <span className="text-zinc-500"> — {step.error ?? step.detail}</span>
              )}
            </span>
          </li>
        ))}
        {op.status === 'running' && op.steps.every((s) => s.status !== 'running') && (
          <li className="flex items-center gap-1.5 text-zinc-500">
            <Loader2 size={12} className="animate-spin" /> waiting…
          </li>
        )}
      </ul>
      {op.warnings?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {op.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-yellow-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}
      {op.error && op.status !== 'running' && <p className="mt-2 text-red-400">{op.error}</p>}
    </div>
  );
}

/** The relay hook set an approval covers, fail-open hooks marked. */
function RelayHookSetView({ relay }) {
  return (
    <div className="space-y-1.5 text-zinc-400">
      <div>
        <span className="text-zinc-500">module </span>
        {relay.entry ? (
          <span className="font-mono text-zinc-300" title={relay.entrySha256}>
            {relay.entry} <span className="text-zinc-600">sha256 {short(relay.entrySha256)}</span>
          </span>
        ) : (
          <span className="text-zinc-500">none — shared hooks only</span>
        )}
      </div>
      {relay.stages.length > 0 && (
        <div>
          <span className="text-zinc-500">stages </span>
          {relay.stages.map((s) => (
            <span key={s.stage} className="mr-2 font-mono text-zinc-300">
              {s.stage}
              <span className="text-zinc-600"> {s.timeoutMs} ms</span>
            </span>
          ))}
        </div>
      )}
      {relay.request.map((h) => (
        <div key={h.index} className="rounded bg-zinc-900 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-zinc-300">{h.stage}</span>
            <span className="text-zinc-500">{h.use ?? 'plugin module'}</span>
            {h.failOpen.length > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded bg-yellow-500/15 px-1.5 text-yellow-400"
                title="Traffic passes when this hook fails, times out, or cannot see the body"
              >
                <ShieldAlert size={11} /> fail-open: {h.failOpen.join(', ')}
              </span>
            )}
          </div>
          <div className="font-mono text-zinc-400">{h.routes.join(', ')}</div>
          <div className="text-zinc-600">
            body {h.bodyMaxBytes === null ? 'not seen' : `${h.bodyMaxBytes} B`} · {h.timeoutMs} ms ·
            on error {h.onError}
            {h.settings &&
              ` · ${h.settings.action}, packs ${h.settings.packs.join(', ')}, unscannable ${h.settings.onUnscannable}`}
          </div>
          {h.inactiveRoutes.length > 0 && (
            <div className="text-zinc-600">
              not active until the user surface: {h.inactiveRoutes.join(', ')}
            </div>
          )}
        </div>
      ))}
      <div>
        <span className="text-zinc-500">effects </span>
        <span className="text-zinc-300">
          {relay.effects.length > 0 ? relay.effects.join(', ') : 'none'}
        </span>
        {relay.packs.length > 0 && (
          <span className="text-zinc-500"> · rule packs {relay.packs.join(', ')}</span>
        )}
      </div>
    </div>
  );
}

/** A tarball integrity, shortened; the full value on hover and to copy. */
function IntegrityValue({ integrity }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(integrity);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard here: the full value stays in the tooltip.
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-zinc-300" title={integrity}>
        {shortIntegrity(integrity)}
      </span>
      <button
        type="button"
        onClick={copy}
        title="Copy the full integrity"
        aria-label="Copy the full integrity"
        className="text-zinc-500 hover:text-zinc-300"
      >
        {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

/**
 * The agent half an approval covers — what Lamaste installs on the hosting
 * agent: its package at the version and tarball integrity the relay pinned,
 * the service it runs as, its data directory, and the system packages
 * installed for it.
 */
export function AgentHalfView({ agentHalf }) {
  return (
    <div className="space-y-1 text-zinc-400">
      <div>
        <span className="text-zinc-500">package </span>
        <span className="font-mono text-zinc-300">
          {agentHalf.package}@{agentHalf.version}
        </span>
      </div>
      <div>
        <span className="text-zinc-500">integrity </span>
        <IntegrityValue integrity={agentHalf.integrity} />
      </div>
      <div>
        <span className="text-zinc-500">entry </span>
        <span className="font-mono text-zinc-300">{agentHalf.entry}</span>
        <span className="text-zinc-500"> · memory </span>
        <span className="font-mono text-zinc-300">{agentHalf.memoryMax ?? 'not limited'}</span>
      </div>
      <div>
        <span className="text-zinc-500">runs as </span>
        <span className="font-mono text-zinc-300">{agentHalf.serviceUser}</span>
        <span className="text-zinc-500"> · unit </span>
        <span className="font-mono text-zinc-300">{agentHalf.unitName}</span>
      </div>
      <div>
        <span className="text-zinc-500">data </span>
        <span className="font-mono text-zinc-300">{agentHalf.dataDir}</span>
        <span className="text-zinc-600"> — kept when it is removed, unless purged</span>
      </div>
      <div>
        <span className="text-zinc-500">system packages </span>
        {agentHalf.systemPackages.length > 0 ? (
          <>
            <span className="font-mono text-zinc-300">{agentHalf.systemPackages.join(', ')}</span>
            <span className="text-zinc-600"> — installed with apt-get once approved</span>
          </>
        ) : (
          <span className="text-zinc-300">none</span>
        )}
      </div>
    </div>
  );
}

/** Refetch what approving or updating a plugin changes: its hooks, its operations, the plugin list. */
function invalidatePluginLifecycle(queryClient, name) {
  queryClient.invalidateQueries({ queryKey: ['plugin-hooks', name] });
  queryClient.invalidateQueries({ queryKey: ['plugins'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-operations', name] });
}

/** A refused update, for a toast: its agent half is a push to the hosting agent. */
function updateRefusalText(err, plugin) {
  return refusalText(err, { agentLabel: plugin.agentHosting?.agentLabel, action: 'update' });
}

/** What an approval covers, in words, and the verb that goes with it. */
function approvalSubject({ relay, agentHalf }) {
  if (relay && agentHalf) return { subject: 'relay hooks and agent half', plural: true };
  if (agentHalf) return { subject: 'agent half', plural: false };
  return { subject: 'relay hooks', plural: true };
}

/** The question before approving: what approving lets Lamaste do. */
function approvalQuestion({ relay, agentHalf }) {
  if (relay && agentHalf) return 'Run this code on the relay and install this agent half?';
  if (agentHalf) return 'Install this agent half on the hosting agent?';
  return 'Run this code on the relay?';
}

/** What waits for an approval to happen: the relay hooks run, the agent half is installed. */
function approvalGate({ relay, agentHalf }) {
  if (relay && agentHalf) {
    return 'Lamaste runs its relay hooks, installs its agent half and hosts the plugin only once this is approved.';
  }
  if (agentHalf) {
    return 'Lamaste installs its agent half and hosts the plugin only once this is approved.';
  }
  return 'Lamaste runs its relay hooks and hosts the plugin only once they are approved.';
}

/** The approval digest — the one value an approval names. */
function ApprovalDigest({ digest }) {
  return (
    <div>
      <span className="text-zinc-500">approval digest </span>
      <span className="font-mono text-zinc-300" title={digest}>
        {short(digest)}
      </span>
    </div>
  );
}

/**
 * What a version brings that needs approval — its relay hook set (code
 * Lamaste runs on the relay, in a sandbox) and the agent half Lamaste
 * installs on the hosting agent.
 */
function ApprovalContents({ relay, agentHalf }) {
  return (
    <>
      {relay && (
        <div>
          <p className="mb-1 text-zinc-500">
            Relay hooks — run in a sandbox on the relay (no network, no files of Lamaste&apos;s):
          </p>
          <RelayHookSetView relay={relay} />
        </div>
      )}
      {agentHalf && (
        <div>
          <p className="mb-1 text-zinc-500">
            Agent half — Lamaste installs it on the hosting agent as a hardened service of its own:
          </p>
          <AgentHalfView agentHalf={agentHalf} />
        </div>
      )}
    </>
  );
}

/**
 * What an update changes in the plugin's settings schema
 * (`pendingUpdate.settings`) — outside the approval, which covers code:
 * fields added and removed, fields whose type changed (their stored values
 * are dropped on both sides, never converted) and fields it newly requires
 * without a default (the plugin needs configuring after the update).
 */
function SettingsSchemaChanges({ diff }) {
  if (!diff) return null;
  const rows = [
    { label: 'added', keys: diff.added, note: null },
    { label: 'removed', keys: diff.removed, note: 'their values are dropped' },
    { label: 'type changed', keys: diff.retyped, note: 'their values are dropped, not converted' },
    { label: 'newly required', keys: diff.newRequired, note: 'to be set after the update' },
  ].filter((row) => Array.isArray(row.keys) && row.keys.length > 0);
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-zinc-500">Settings — what this version changes in them:</p>
      <div className="space-y-0.5 text-zinc-400">
        {rows.map((row) => (
          <div key={row.label}>
            <span className="text-zinc-500">{row.label} </span>
            <span className="font-mono text-zinc-300">{row.keys.join(', ')}</span>
            {row.note && <span className="text-yellow-400"> — {row.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A plugin's lifecycle hooks and what needs approval: the relay hook set
 * (code Lamaste runs on the relay, in a sandbox) and the agent half Lamaste
 * installs on the hosting agent — run and installed only once approved —
 * auto-approve for later versions, the agent hooks, and an update waiting
 * for approval.
 */
export function PluginHooks({ plugin, isActing }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const query = useQuery({
    queryKey: ['plugin-hooks', plugin.name],
    queryFn: () => client.getPluginHooks(plugin.name),
    refetchInterval: 30000,
  });
  const hooks = query.data?.hooks;

  const refresh = () => invalidatePluginLifecycle(queryClient, plugin.name);

  const approve = useMutation({
    mutationFn: (digest) => client.approvePluginHooks(plugin.name, digest),
    onSuccess: (data) => {
      refresh();
      addToast(data.operation ? `Approved — updating ${plugin.name}` : `${plugin.name}: approved`);
    },
    onError: (err) => {
      refresh();
      // Approving a pending update starts it: its agent half is a push.
      addToast(updateRefusalText(err, plugin), 'error');
    },
  });
  const autoApprove = useMutation({
    mutationFn: (enabled) => client.setPluginHooksAutoApprove(plugin.name, enabled),
    onSuccess: refresh,
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const discard = useMutation({
    mutationFn: () => client.discardPluginUpdate(plugin.name),
    onSuccess: () => {
      refresh();
      addToast('Pending update discarded');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  if (!hooks || (!hooks.relay && !hooks.agent && !hooks.agentHalf && !hooks.pendingUpdate)) {
    return null;
  }
  const busy = isActing || approve.isPending || autoApprove.isPending || discard.isPending;
  const { approval } = hooks;
  const pending = approval.state === 'pending';
  const { subject, plural } = approvalSubject(hooks);

  const approveButton = (digest, label, question) =>
    confirming === digest ? (
      <span className="flex items-center gap-1.5">
        <span className="text-zinc-400">{question}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(null);
            approve.mutate(digest);
          }}
          className="rounded bg-cyan-600 px-2 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setConfirming(null)}
          className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
        >
          Cancel
        </button>
      </span>
    ) : (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setConfirming(digest);
        }}
        className="flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        <ShieldCheck size={11} /> {label}
      </button>
    );

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-zinc-300 font-medium">Lifecycle hooks</span>
        {approval.required &&
          (pending ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-400">
              <ShieldAlert size={11} /> {subject} {plural ? 'wait' : 'waits'} for approval
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-green-400">
              <Check size={11} /> {subject} approved
            </span>
          ))}
        {hooks.relay?.failOpenCount > 0 && (
          <span className="text-yellow-400">{hooks.relay.failOpenCount} fail-open</span>
        )}
        {hooks.pendingUpdate && (
          <span className="text-yellow-400">update {hooks.pendingUpdate.version} waiting</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {approval.required && (
            <div className="space-y-2">
              <p className="text-zinc-500">
                {pending
                  ? approvalGate(hooks)
                  : `Approved by ${approval.approvedBy} ${approval.approvedAt ? new Date(approval.approvedAt).toLocaleString() : ''} (version ${approval.approvedVersion}).`}
              </p>
              <ApprovalDigest digest={approval.digest} />
              <ApprovalContents relay={hooks.relay} agentHalf={hooks.agentHalf} />
              <div className="flex flex-wrap items-center gap-3">
                {pending && approveButton(approval.digest, 'Approve', approvalQuestion(hooks))}
                <label className="flex items-center gap-1.5 text-zinc-400">
                  <input
                    type="checkbox"
                    checked={hooks.autoApprove}
                    disabled={busy}
                    onChange={(e) => autoApprove.mutate(e.target.checked)}
                  />
                  Approve what later versions of this plugin bring automatically
                </label>
              </div>
            </div>
          )}

          {hooks.agent && (
            <div>
              <p className="text-zinc-500 mb-1">
                Agent hooks — run by the agent half on its agent; no approval needed:
              </p>
              <div className="font-mono text-zinc-300">
                {hooks.agent.stages.map((s) => s.stage).join(', ')}
              </div>
            </div>
          )}

          {hooks.pendingUpdate && (
            <div className="space-y-2 rounded border border-yellow-500/30 p-2">
              <p className="text-yellow-400">
                Version {hooks.pendingUpdate.version} waits for approval of what it brings (below).
                The installed version stays live until then.
              </p>
              <ApprovalDigest digest={hooks.pendingUpdate.digest} />
              <ApprovalContents
                relay={hooks.pendingUpdate.relay}
                agentHalf={hooks.pendingUpdate.agentHalf}
              />
              <SettingsSchemaChanges diff={hooks.pendingUpdate.settings} />
              <div className="flex items-center gap-2">
                {approveButton(
                  hooks.pendingUpdate.digest,
                  'Approve and update',
                  approvalQuestion(hooks.pendingUpdate),
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => discard.mutate()}
                  className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
                >
                  <X size={11} /> Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Update an agent-hosted plugin in place: the latest version, or one named. */
export function PluginUpdate({ plugin, isActing }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [version, setVersion] = useState('');
  const update = useMutation({
    mutationFn: () => client.updatePlugin(plugin.name, version.trim() || undefined),
    onSuccess: (data) => {
      invalidatePluginLifecycle(queryClient, plugin.name);
      if (data.upToDate) addToast(`${plugin.name} is already at ${data.version}`);
      else if (data.pendingUpdate) {
        addToast(
          `${plugin.name} ${data.pendingUpdate.version} waits for approval — review what it brings under Lifecycle hooks`,
        );
      } else addToast(`Updating ${plugin.name}`);
      setVersion('');
    },
    onError: (err) => addToast(updateRefusalText(err, plugin), 'error'),
  });
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="text"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="latest"
        className="w-20 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-cyan-400"
        aria-label="Version to update to"
      />
      <button
        type="button"
        disabled={isActing || update.isPending}
        onClick={() => update.mutate()}
        className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
        title="Fetch the version and read it before installing it; relay hooks that changed or a new agent half wait for approval"
      >
        {update.isPending ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        Update
      </button>
    </span>
  );
}
