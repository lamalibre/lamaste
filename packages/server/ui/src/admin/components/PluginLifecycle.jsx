import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  KeyRound,
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
import { useOidcSecretReveal } from './OidcSecretReveal.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { refusalText } from '../lib/pluginRefusal.js';
import { markSecretsRead, operationSecretsAction, withoutSecrets } from '../lib/oidcSecrets.js';
import { settingsDiffRows } from '../lib/pluginSettings.js';

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
 * Below it, the client secrets its operations created, shown once.
 */
export function PluginOperation({ plugin }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['plugin-operations', plugin],
    queryFn: () => client.getPluginOperations(plugin),
    refetchInterval: (q) => (q.state.data?.operations?.[0]?.status === 'running' ? 2000 : 15000),
  });
  const operations = query.data?.operations;
  const op = operations?.[0];
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
  const finished = op?.finishedAt ? Date.parse(op.finishedAt) : null;
  // Measured against when the list was fetched, which the query refreshes.
  const recent = op != null && !(finished && query.dataUpdatedAt - finished > 10 * 60_000);

  return (
    <>
      {recent && <OperationSteps op={op} />}
      <OperationSecrets plugin={plugin} operations={operations} />
    </>
  );
}

/** An operation's outcome, steps and warnings. */
function OperationSteps({ op }) {
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

/**
 * The secrets of confidential OIDC clients a finished operation created (an
 * update adding one), which the panel hands out on one read of the
 * operation. Read at once for an operation started from this panel; offered
 * for one started elsewhere — another panel, the CLI, this page before a
 * reload — and read only when the administrator asks, so the CLI following
 * its own operation still gets them.
 */
function OperationSecrets({ plugin, operations }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const { reveal, followState, claimOperation, releaseOperation } = useOidcSecretReveal();

  const pending = useMemo(
    () =>
      (operations ?? [])
        .map((op) => ({ op, action: operationSecretsAction(op, followState(op.id)) }))
        .filter(({ action }) => action !== null),
    [operations, followState],
  );

  const read = useCallback(
    async (op, { asked }) => {
      if (!claimOperation(op.id)) return;
      try {
        // Straight from the response to the dialog: not through the query cache.
        const { operation } = await client.getPluginOperation(plugin, op.id);
        const { secrets } = withoutSecrets(operation);
        queryClient.setQueryData(['plugin-operations', plugin], (data) =>
          markSecretsRead(data, op.id),
        );
        if (secrets.length > 0) reveal({ plugin, cause: op.kind, secrets });
        else if (asked) {
          addToast(
            'Nothing to show — the secrets were shown elsewhere, or waited more than an hour',
            'error',
          );
        }
      } catch (err) {
        addToast(`Could not read the client secrets: ${errorMessage(err)}`, 'error');
      } finally {
        releaseOperation(op.id);
        // A list fetched before this read still says the secrets wait.
        queryClient.invalidateQueries({ queryKey: ['plugin-operations', plugin] });
      }
    },
    [plugin, client, queryClient, addToast, reveal, claimOperation, releaseOperation],
  );

  useEffect(() => {
    for (const { op, action } of pending) {
      if (action === 'read') read(op, { asked: false });
      else if (action === 'forget') releaseOperation(op.id);
    }
  }, [pending, read, releaseOperation]);

  const notices = pending.filter(({ action }) => action !== 'forget');
  if (notices.length === 0) return null;
  return notices.map(({ op, action }) => (
    <div
      key={op.id}
      className="flex flex-wrap items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 p-3 mb-4 text-xs"
    >
      <KeyRound size={12} className="shrink-0 text-amber-400" />
      {action === 'offer' ? (
        <>
          <span className="flex-1 text-amber-400">
            {KIND_LABEL[op.kind] ?? op.kind}
            {op.finishedAt ? ` (${new Date(op.finishedAt).toLocaleString()})` : ''} created
            confidential OIDC client secrets that were not shown yet. They are shown once.
          </span>
          <button
            type="button"
            onClick={() => read(op, { asked: true })}
            className="rounded bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-500"
          >
            Show the secrets
          </button>
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-zinc-400">
          <Loader2 size={12} className="animate-spin" />
          Reading the new client secrets…
        </span>
      )}
    </div>
  ));
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
          {h.userSurfaceRoutes.length > 0 && (
            <div className="text-zinc-600">
              runs on user-surface requests (plugins that declare identity):{' '}
              {h.userSurfaceRoutes.join(', ')}
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

/** The reason a pending update turns secret settings into plain ones. */
const SECRET_TO_PLAIN = 'settings.secret-to-plain';
/** The reason a pending update's digest is not the approved one. */
const DIGEST_UNAPPROVED = 'digest.unapproved';

/**
 * The question before approving a pending update: what approving it lets
 * Lamaste do — run and install what it brings, when that is not what was
 * approved, and keep what is typed into secrets turned plain in clear.
 */
function updateApprovalQuestion(update) {
  const codes = new Set((update.approvalRequired ?? []).map((reason) => reason.code));
  const keys = update.settings?.secretToPlain ?? [];
  const fields = `${keys.join(', ')} into ${keys.length === 1 ? 'a plain setting' : 'plain settings'}`;
  if (codes.has(DIGEST_UNAPPROVED) && codes.has(SECRET_TO_PLAIN)) {
    // "Install this agent half on the hosting agent, and turn token into a plain setting?"
    return `${approvalQuestion(update).replace(/\?$/, '')}, and turn ${fields}?`;
  }
  if (codes.has(SECRET_TO_PLAIN)) return `Turn ${fields} and update?`;
  return approvalQuestion(update);
}

/**
 * The approval digest — what an approval names. `approved`: it is the one
 * already approved (an update whose code did not change).
 */
function ApprovalDigest({ digest, approved = false }) {
  return (
    <div>
      <span className="text-zinc-500">approval digest </span>
      <span className="font-mono text-zinc-300" title={digest}>
        {short(digest)}
      </span>
      {approved && <span className="text-zinc-500"> — unchanged, already approved</span>}
    </div>
  );
}

/**
 * Why a pending update waits for an administrator (`approvalRequired`):
 * what it brings is not what was approved, and — whatever its digest and
 * auto-approve — secrets it turns into plain values.
 */
function ApprovalReasons({ reasons }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {reasons.map((reason) => (
        <li
          key={reason.code}
          className={reason.code === SECRET_TO_PLAIN ? 'text-red-400' : 'text-yellow-400/90'}
        >
          {reason.reason}
        </li>
      ))}
    </ul>
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
 * (`pendingUpdate.settings`) — outside the approval digest, which covers
 * code: fields added and removed with their types, fields whose type
 * changed (`from → to`; their stored values are dropped on both sides,
 * never converted), fields it newly requires without a default (the plugin
 * needs configuring after the update) and — as a warning — secrets that
 * become plain values, whose next values the relay keeps and shows in
 * clear (which the update waits for an administrator to approve).
 */
function SettingsSchemaChanges({ diff }) {
  const shown = settingsDiffRows(diff);
  if (!shown) return null;
  return (
    <div>
      <p className="mb-1 text-zinc-500">Settings — what this version changes in them:</p>
      <div className="space-y-0.5 text-zinc-400">
        {shown.rows.map((row) => (
          <div key={row.label}>
            <span className="text-zinc-500">{row.label} </span>
            <span className="font-mono text-zinc-300">{row.entries.join(', ')}</span>
            {row.note && <span className="text-yellow-400"> — {row.note}</span>}
          </div>
        ))}
      </div>
      {shown.secretToPlain.length > 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 text-red-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Secrets become plain values:{' '}
            <span className="font-mono">{shown.secretToPlain.join(', ')}</span>. Their secrets are
            dropped, but what is typed into them after the update is stored on the relay and shown
            in clear — never put a credential there.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Why auto-approve did not cover a pending update
 * (`pendingUpdate.autoApproveWithheld`) beyond the reasons it waits for,
 * which are listed already.
 */
function AutoApproveWithheld({ reasons }) {
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-zinc-500">Auto-approve does not cover it:</p>
      <ul className="list-disc space-y-0.5 pl-5 text-yellow-400/90">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
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
  const { followOperation } = useOidcSecretReveal();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const query = useQuery({
    queryKey: ['plugin-hooks', plugin.name],
    queryFn: () => client.getPluginHooks(plugin.name),
    refetchInterval: 30000,
  });
  const hooks = query.data?.hooks;

  const refresh = () => invalidatePluginLifecycle(queryClient, plugin.name);

  // `{ digest }`: the installed version; `{ digest, version }`: the pending update.
  const approve = useMutation({
    mutationFn: ({ digest, version }) => client.approvePluginHooks(plugin.name, digest, version),
    onSuccess: (data) => {
      // Approving a pending update starts it: the client secrets it
      // creates are shown when it ends.
      if (data.operation) followOperation(data.operation.id);
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
  const { approval, pendingUpdate } = hooks;
  const pending = approval.state === 'pending';
  const { subject, plural } = approvalSubject(hooks);
  // Why the pending update waits, and what auto-approve withheld beyond that.
  const updateReasons = Array.isArray(pendingUpdate?.approvalRequired)
    ? pendingUpdate.approvalRequired
    : [];
  const notCovered = (pendingUpdate?.autoApproveWithheld ?? []).filter(
    (sentence) => !updateReasons.some((reason) => reason.reason === sentence),
  );

  // `target` is what the button approves: 'installed' or 'update'; `body`
  // what the approval names (`{ digest }`, or `{ digest, version }`).
  const approveButton = (target, label, question, body) =>
    confirming === target ? (
      <span className="flex items-center gap-1.5">
        <span className="text-zinc-400">{question}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(null);
            approve.mutate(body);
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
          setConfirming(target);
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
        {pendingUpdate && (
          <span className="text-yellow-400">update {pendingUpdate.version} waiting</span>
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
                {pending &&
                  approveButton('installed', 'Approve', approvalQuestion(hooks), {
                    digest: approval.digest,
                  })}
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

          {pendingUpdate && (
            <div className="space-y-2 rounded border border-yellow-500/30 p-2">
              <p className="text-yellow-400">
                Version {pendingUpdate.version} waits for your approval — the installed version
                stays live until then:
              </p>
              <ApprovalReasons reasons={updateReasons} />
              {pendingUpdate.digest && (
                <ApprovalDigest
                  digest={pendingUpdate.digest}
                  approved={pendingUpdate.digest === approval.approvedDigest}
                />
              )}
              <ApprovalContents relay={pendingUpdate.relay} agentHalf={pendingUpdate.agentHalf} />
              <SettingsSchemaChanges diff={pendingUpdate.settings} />
              <AutoApproveWithheld reasons={notCovered} />
              <div className="flex items-center gap-2">
                {approveButton(
                  'update',
                  'Approve and update',
                  updateApprovalQuestion(pendingUpdate),
                  { digest: pendingUpdate.digest, version: pendingUpdate.version },
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
  const { followOperation } = useOidcSecretReveal();
  const [version, setVersion] = useState('');
  const update = useMutation({
    mutationFn: () => client.updatePlugin(plugin.name, version.trim() || undefined),
    onSuccess: (data) => {
      // The client secrets the update creates are shown when it ends.
      if (data.operation) followOperation(data.operation.id);
      invalidatePluginLifecycle(queryClient, plugin.name);
      if (data.upToDate) addToast(`${plugin.name} is already at ${data.version}`);
      else if (data.pendingUpdate) {
        addToast(
          `${plugin.name} ${data.pendingUpdate.version} waits for your approval — see why under Lifecycle hooks`,
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
        title="Fetch the version and read it before installing it; relay hooks that changed, a new agent half and secret settings turned plain wait for approval"
      >
        {update.isPending ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        Update
      </button>
    </span>
  );
}
