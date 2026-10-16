import { forwardRef, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  KeyRound,
  Loader2,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { explainRefusal } from '../lib/pluginRefusal.js';
import { CREDENTIAL_HINT, fieldTypeText, looksLikeCredential } from '../lib/pluginSettings.js';
import { AgentHalfView } from './PluginLifecycle.jsx';
import { HostFactsSummary } from './HostFacts.jsx';
import { pushWindowOpen, scrollToPushInstall } from './PushInstallSection.jsx';

/** Close the dialog and bring the push-install section into view. */
function PushInstallLink({ onClose }) {
  return (
    <button
      type="button"
      onClick={() => {
        onClose();
        scrollToPushInstall();
      }}
      className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline"
    >
      <ArrowDown size={11} />
      Push install
    </button>
  );
}

/**
 * An agent's push-install window as the relay last listed it: open until a
 * time, or closed. Measured against when the list was fetched (`now`),
 * which the query refreshes.
 */
function PushInstallWindow({ until, now }) {
  if (pushWindowOpen(until, now)) {
    return (
      <span className="text-green-400">
        push install open until {new Date(until).toLocaleTimeString()}
      </span>
    );
  }
  return <span className="text-zinc-500">push install closed</span>;
}

/** Why a hosting was refused, and what lifts the refusal. */
const RefusalNotice = forwardRef(function RefusalNotice({ refusal, pluginName, onClose }, ref) {
  return (
    <div ref={ref} className="rounded border border-red-500/30 bg-red-500/5 p-3 text-xs">
      <p className="flex items-start gap-1.5 text-red-400">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        {refusal.code === 'agent_not_eligible'
          ? `Agent "${refusal.agentLabel}" cannot host ${pluginName}:`
          : refusal.message}
      </p>
      {refusal.code === 'agent_not_eligible' && (
        <ul className="mt-1 list-disc space-y-0.5 pl-6 text-zinc-300">
          {refusal.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {refusal.hint && <p className="mt-1.5 text-zinc-400">{refusal.hint}</p>}
      {refusal.code === 'push_install_refused' && (
        <p className="mt-1.5">
          <PushInstallLink onClose={onClose} />
        </p>
      )}
    </div>
  );
});

/**
 * The settings a plugin declares, with their types — what an administrator
 * fills in once it is hosted. Hosting itself takes none: the agent half
 * starts without them.
 */
function DeclaredSettings({ query }) {
  const fields = query.data?.fields;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="mb-1 flex items-center gap-1.5 font-medium text-zinc-300">
        <SlidersHorizontal size={12} className="text-cyan-400" />
        Settings it asks for
      </p>
      <p className="mb-2 text-zinc-500">
        Hosting takes no settings: the agent half starts without them, and you fill them in under
        Settings on the plugin&apos;s card once it is hosted. Secrets are kept by the agent half
        alone; every other value is also kept on the relay and shown in clear.
      </p>
      {Array.isArray(fields) ? (
        <ul className="space-y-1">
          {fields.map((field) => (
            <li key={field.key} className="flex flex-wrap items-baseline gap-x-2">
              {field.type === 'secret' && (
                <KeyRound size={11} className="shrink-0 self-center text-cyan-400" />
              )}
              <span className="text-zinc-300">{field.label}</span>
              <span className="font-mono text-zinc-600">{field.key}</span>
              <span className={field.type === 'secret' ? 'text-cyan-400' : 'text-zinc-500'}>
                {fieldTypeText(field)}
              </span>
              {looksLikeCredential(field) && (
                <span className="w-full text-yellow-400/90">{CREDENTIAL_HINT}</span>
              )}
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <p className="text-red-400">{errorMessage(query.error)}</p>
      ) : (
        <Loader2 size={12} className="animate-spin text-zinc-500" />
      )}
    </div>
  );
}

/**
 * Host an agent-hosted plugin on one of the enrolled machine agents. Lists
 * them with what each reported about its host; the ones that cannot host
 * the plugin are disabled with the reasons (its `agent.requires` and, when
 * Lamaste installs the agent half, what installing it needs). For an agent
 * half Lamaste installs, shows what goes onto the agent and each agent's
 * push-install window, and explains a refused hosting in place. A plugin
 * that declares settings shows its fields with their types.
 *
 * `onHost(name, agentLabel, { onSuccess, onError })` starts the hosting.
 */
export default function PluginHostDialog({ plugin, onHost, onClose, isActing }) {
  const client = useAdminClient();
  const [selected, setSelected] = useState('');
  const [refusal, setRefusal] = useState(null);
  // While the request runs the dialog stays open: it reports the outcome.
  const [submitting, setSubmitting] = useState(false);
  const refusalRef = useRef(null);
  useEffect(() => {
    if (refusal) refusalRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [refusal]);
  const lamasteInstalls = plugin.hooks?.agentHalf === true;
  const approvalPending = plugin.hooks?.approval === 'pending';

  // Agents report their host facts on their sync: refresh while open.
  const eligibilityQuery = useQuery({
    queryKey: ['plugin-hosting-eligibility', plugin.name],
    queryFn: () => client.getPluginHostingEligibility(plugin.name),
    refetchInterval: 30000,
  });
  const agentsQuery = useQuery({
    queryKey: ['agent-certs'],
    queryFn: () => client.getAgentCerts(),
    refetchInterval: 30000,
  });
  const pushConfigQuery = useQuery({
    queryKey: ['push-install-config'],
    queryFn: () => client.getPushInstallConfig(),
    enabled: lamasteInstalls,
  });
  const hooksQuery = useQuery({
    queryKey: ['plugin-hooks', plugin.name],
    queryFn: () => client.getPluginHooks(plugin.name),
    enabled: lamasteInstalls,
  });
  // The plugin list carries only a summary of the settings; their fields
  // come with the settings view (the schema alone while it is not hosted).
  const declaresSettings = plugin.settings != null;
  const settingsQuery = useQuery({
    queryKey: ['plugin-settings', plugin.name],
    queryFn: () => client.getPluginSettings(plugin.name),
    enabled: declaresSettings,
    refetchOnWindowFocus: false,
  });

  const candidates = eligibilityQuery.data?.agents ?? [];
  const certs = new Map((agentsQuery.data?.agents ?? []).map((a) => [a.label, a]));
  // A choice that stopped being eligible on a refresh is no choice.
  const choice = candidates.some((a) => a.label === selected && a.eligible) ? selected : '';
  const agentHalf = hooksQuery.data?.hooks?.agentHalf ?? null;
  const pushOff = lamasteInstalls && pushConfigQuery.data?.enabled === false;
  const now = agentsQuery.dataUpdatedAt;
  // The chosen agent's window is closed: hosting it would be refused.
  const chosenCert = choice ? certs.get(choice) : undefined;
  const chosenWindowClosed =
    lamasteInstalls &&
    !pushOff &&
    chosenCert !== undefined &&
    !pushWindowOpen(chosenCert.pushInstallEnabledUntil, now);

  const host = () => {
    setRefusal(null);
    setSubmitting(true);
    onHost(plugin.name, choice, {
      onSuccess: onClose,
      onError: (err) => {
        setSubmitting(false);
        const explained = explainRefusal(err, { agentLabel: choice, action: 'install' });
        setRefusal({ ...explained, agentLabel: choice });
        if (explained.code === 'agent_not_eligible') eligibilityQuery.refetch();
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Server size={18} className="text-cyan-400" />
            Host {plugin.displayName || plugin.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="text-zinc-400 hover:text-white disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-4 text-xs">
          <p className="text-zinc-400">
            {lamasteInstalls
              ? 'Lamaste installs the agent half on the agent you pick, as a service of its own, and runs the install hooks around creating the internal tunnel, assigning the port and issuing the installation secret.'
              : 'Pick the agent that runs its agent half (installed there by hand): Lamaste runs the install hooks around creating the internal tunnel, assigning the port and issuing the installation secret.'}
          </p>

          {lamasteInstalls && (
            <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-2 font-medium text-zinc-300">What Lamaste installs on the agent</p>
              {agentHalf ? (
                <AgentHalfView agentHalf={agentHalf} />
              ) : hooksQuery.isError ? (
                <p className="text-red-400">{errorMessage(hooksQuery.error)}</p>
              ) : (
                <Loader2 size={12} className="animate-spin text-zinc-500" />
              )}
            </div>
          )}

          {declaresSettings && <DeclaredSettings query={settingsQuery} />}

          {approvalPending && (
            <p className="flex items-start gap-1.5 text-yellow-400">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              {lamasteInstalls
                ? 'Not approved yet — approve what it brings under Lifecycle hooks on the plugin’s card, then host it.'
                : 'Its relay hooks are not approved yet — approve them under Lifecycle hooks on the plugin’s card, then host it.'}
            </p>
          )}

          {pushOff && (
            <p className="flex flex-wrap items-start gap-1.5 text-yellow-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                Push install is off on this relay: Lamaste cannot install the agent half until it is
                on and the agent&apos;s window is open — under <PushInstallLink onClose={onClose} />
                .
              </span>
            </p>
          )}

          <div>
            <p className="mb-2 font-medium text-zinc-300">Agent</p>
            {eligibilityQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-zinc-800" />
                ))}
              </div>
            ) : eligibilityQuery.isError ? (
              <p className="text-red-400">{errorMessage(eligibilityQuery.error)}</p>
            ) : candidates.length === 0 ? (
              <p className="text-zinc-500">
                No enrolled machine agent — enroll one under Certificates first.
              </p>
            ) : (
              <ul className="space-y-1.5" role="radiogroup" aria-label="Hosting agent">
                {candidates.map((agent) => {
                  const cert = certs.get(agent.label);
                  return (
                    <li key={agent.label}>
                      <label
                        className={`flex items-start gap-2 rounded border px-3 py-2 ${
                          !agent.eligible
                            ? 'cursor-not-allowed border-zinc-800 bg-zinc-950/40'
                            : choice === agent.label
                              ? 'cursor-pointer border-cyan-500/60 bg-cyan-500/5'
                              : 'cursor-pointer border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name={`host-${plugin.name}`}
                          value={agent.label}
                          checked={choice === agent.label}
                          disabled={!agent.eligible}
                          onChange={() => setSelected(agent.label)}
                          className="mt-0.5 accent-cyan-500"
                        />
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <span
                              className={`font-mono ${agent.eligible ? 'text-zinc-200' : 'text-zinc-500'}`}
                            >
                              {agent.label}
                            </span>
                            {lamasteInstalls && agent.eligible && cert && (
                              <PushInstallWindow until={cert.pushInstallEnabledUntil} now={now} />
                            )}
                          </span>
                          <span className="block">
                            <HostFactsSummary
                              facts={cert?.hostFacts ?? null}
                              at={cert?.hostFactsAt ?? null}
                            />
                          </span>
                          {!agent.eligible && (
                            <ul className="list-disc space-y-0.5 pl-4 text-yellow-400/90">
                              {agent.reasons.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {chosenWindowClosed && (
            <p className="flex items-start gap-1.5 text-yellow-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                The push-install window of <span className="font-mono">{choice}</span> is closed:
                Lamaste installs the agent half by push install, so open it first — under{' '}
                <PushInstallLink onClose={onClose} />.
              </span>
            </p>
          )}

          {refusal && (
            <RefusalNotice
              ref={refusalRef}
              refusal={refusal}
              pluginName={plugin.displayName || plugin.name}
              onClose={onClose}
            />
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || isActing || !choice || approvalPending}
            onClick={host}
            title={approvalPending ? 'Approve what it brings first (Lifecycle hooks)' : undefined}
            className="flex items-center gap-1.5 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
            {choice ? `Host on ${choice}` : 'Host on agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
