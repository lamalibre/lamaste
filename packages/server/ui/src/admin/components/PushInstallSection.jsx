import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Lock, Power, PowerOff, Shield, Unlock } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';

/** The element id of the push-install section — the host dialog links to it. */
const PUSH_INSTALL_SECTION_ID = 'push-install';

/**
 * Bring the push-install section into view (from the host dialog, say) —
 * on the next frame, once a dialog closed in the same click is gone: a
 * smooth scroll started while it unmounts is cancelled.
 */
export function scrollToPushInstall() {
  requestAnimationFrame(() => {
    document
      .getElementById(PUSH_INSTALL_SECTION_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/**
 * Whether an agent's push-install window (`pushInstallEnabledUntil`) is
 * open at `now` — the time the agent list was fetched, which its query
 * refreshes. Closed when there is no window or it is not a time.
 */
export function pushWindowOpen(until, now) {
  return until != null && Date.parse(until) > now;
}

/** How long a window opens for unless the administrator says otherwise. */
const DEFAULT_MINUTES = 30;

/** The error of a window length, or null: whole minutes within the panel's bounds. */
function minutesError(text, bounds) {
  const minutes = Number(text);
  if (!/^\d+$/.test(text.trim()) || minutes < bounds.min || minutes > bounds.max) {
    return `${bounds.min} to ${bounds.max} whole minutes`;
  }
  return null;
}

/**
 * Open (or reopen) an agent's push-install window: for how many minutes —
 * within the bounds the panel enforces — and under which policy.
 */
function OpenWindowForm({ agent, config, onDone }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const bounds = config.windowMinutes;
  const [minutes, setMinutes] = useState(
    String(Math.min(Math.max(DEFAULT_MINUTES, bounds.min), bounds.max)),
  );
  // The agent's last policy when it still exists, else the default one.
  const [policyId, setPolicyId] = useState(
    config.policies.some((p) => p.id === agent.pushInstallPolicy)
      ? agent.pushInstallPolicy
      : config.defaultPolicy,
  );
  const invalid = minutesError(minutes, bounds);

  const open = useMutation({
    mutationFn: () =>
      client.enablePushInstall(agent.label, { durationMinutes: Number(minutes), policyId }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
      addToast(
        `Push install open for ${agent.label} until ${new Date(data.pushInstallEnabledUntil).toLocaleTimeString()}`,
      );
      onDone();
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) open.mutate();
      }}
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <label className="flex items-center gap-1.5 text-zinc-400">
        for
        <input
          type="number"
          inputMode="numeric"
          min={bounds.min}
          max={bounds.max}
          step={1}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-invalid={invalid !== null}
          className={`w-20 rounded border bg-zinc-800 px-2 py-1 text-zinc-200 focus:outline-none ${
            invalid ? 'border-red-500/70' : 'border-zinc-700 focus:border-cyan-400'
          }`}
        />
        minutes
      </label>
      <label className="flex items-center gap-1.5 text-zinc-400">
        policy
        <select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200 focus:border-cyan-400 focus:outline-none"
        >
          {config.policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === config.defaultPolicy ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={invalid !== null || open.isPending}
        className="flex items-center gap-1.5 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        {open.isPending ? <Loader2 size={11} className="animate-spin" /> : <Unlock size={11} />}
        Open
      </button>
      <button
        type="button"
        onClick={onDone}
        className="rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600"
      >
        Cancel
      </button>
      {invalid && <span className="basis-full text-red-400">A window is open {invalid}.</span>}
    </form>
  );
}

/**
 * Push install: what lets the panel install, update and remove what
 * Lamaste installs on an agent — the agent half of an app plugin — while
 * that agent's window is open, within its policy. The relay's switch, the
 * default policy, each machine agent's window (open for a number of
 * minutes under a policy, or closed), and below them the policies
 * (`children`).
 */
export default function PushInstallSection({ children }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [opening, setOpening] = useState(null);

  const configQuery = useQuery({
    queryKey: ['push-install-config'],
    queryFn: () => client.getPushInstallConfig(),
    refetchInterval: 30000,
  });
  const agentsQuery = useQuery({
    queryKey: ['agent-certs'],
    queryFn: () => client.getAgentCerts(),
    refetchInterval: 30000,
  });

  const updateConfig = useMutation({
    mutationFn: (data) => client.updatePushInstallConfig(data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['push-install-config'] });
      queryClient.invalidateQueries({ queryKey: ['push-install-policies'] });
      if (variables.enabled !== undefined) {
        addToast(
          data.enabled
            ? 'Push install is on — open the window of the agent to push to'
            : 'Push install is off — every push is refused',
        );
      } else {
        addToast(`Default policy: ${data.defaultPolicy}`);
      }
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const closeWindow = useMutation({
    mutationFn: (label) => client.disablePushInstall(label),
    onSuccess: (_data, label) => {
      queryClient.invalidateQueries({ queryKey: ['agent-certs'] });
      addToast(`Push install closed for ${label}`);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const config = configQuery.data;
  // Machine agents only: a plugin-agent certificate is never pushed to.
  const agents = (agentsQuery.data?.agents ?? [])
    .filter((a) => !a.revoked && !a.label.startsWith('plugin-agent:'))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Measured against when the list was fetched, which the query refreshes.
  const now = agentsQuery.dataUpdatedAt;
  const isOpen = (agent) => pushWindowOpen(agent.pushInstallEnabledUntil, now);
  const policyName = (id) => config?.policies.find((p) => p.id === id)?.name ?? id;

  return (
    <section id={PUSH_INSTALL_SECTION_ID} className="mt-8 scroll-mt-6">
      <div className="border-t border-zinc-700 pt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Shield size={18} className="text-cyan-400" />
            Push Install
            {config && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-normal ${
                  config.enabled ? 'bg-green-500/20 text-green-400' : 'bg-zinc-500/20 text-zinc-400'
                }`}
              >
                {config.enabled ? 'on' : 'off'}
              </span>
            )}
          </h2>
          {config && (
            <button
              type="button"
              disabled={updateConfig.isPending}
              onClick={() => updateConfig.mutate({ enabled: !config.enabled })}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs disabled:opacity-50 ${
                config.enabled
                  ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  : 'bg-cyan-600 text-white hover:bg-cyan-500'
              }`}
            >
              {config.enabled ? <PowerOff size={12} /> : <Power size={12} />}
              {config.enabled ? 'Turn off' : 'Turn on'}
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-zinc-500">
          Lets the panel install, update and remove what Lamaste installs on an agent — the agent
          half of an app plugin — while that agent&apos;s window is open, within its policy. Off:
          every push is refused, open windows included.
        </p>

        {configQuery.isError ? (
          <p className="mb-4 text-sm text-red-400">{errorMessage(configQuery.error)}</p>
        ) : !config ? (
          <div className="mb-4 h-24 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900" />
        ) : (
          <>
            <label className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              Default policy for a window
              <select
                value={config.defaultPolicy}
                disabled={updateConfig.isPending}
                onChange={(e) => updateConfig.mutate({ defaultPolicy: e.target.value })}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-cyan-400 focus:outline-none"
              >
                {config.policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="mb-6 overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-900">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                      Agent
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                      Window
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">
                      Manage
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agentsQuery.isError && (
                    <tr className="bg-zinc-800">
                      <td colSpan={3} className="px-4 py-3 text-red-400">
                        {errorMessage(agentsQuery.error)}
                      </td>
                    </tr>
                  )}
                  {agentsQuery.isSuccess && agents.length === 0 && (
                    <tr className="bg-zinc-800">
                      <td colSpan={3} className="px-4 py-3 text-zinc-500">
                        No enrolled machine agent.
                      </td>
                    </tr>
                  )}
                  {agents.map((agent) => {
                    const open = isOpen(agent);
                    return (
                      <tr key={agent.label} className="border-b border-zinc-700 bg-zinc-800">
                        <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-zinc-200">
                          {agent.label}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {open ? (
                            <span className="flex items-center gap-1.5 text-green-400">
                              <Clock size={12} />
                              open until {new Date(agent.pushInstallEnabledUntil).toLocaleString()}
                              <span className="text-zinc-500">
                                · policy {policyName(agent.pushInstallPolicy)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-zinc-500">closed</span>
                          )}
                          {opening === agent.label && (
                            <div className="mt-2">
                              <OpenWindowForm
                                agent={agent}
                                config={config}
                                onDone={() => setOpening(null)}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <div className="flex items-center justify-end gap-2">
                            {opening !== agent.label && (
                              <button
                                type="button"
                                disabled={!config.enabled}
                                onClick={() => setOpening(agent.label)}
                                title={
                                  config.enabled
                                    ? 'Open the window for a number of minutes, under a policy'
                                    : 'Turn push install on first'
                                }
                                className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
                              >
                                <Unlock size={12} />
                                {open ? 'Reopen…' : 'Open…'}
                              </button>
                            )}
                            {open && (
                              <button
                                type="button"
                                disabled={closeWindow.isPending}
                                onClick={() => closeWindow.mutate(agent.label)}
                                className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-red-600/20 hover:text-red-400 disabled:opacity-50"
                              >
                                <Lock size={12} />
                                Close
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {children}
      </div>
    </section>
  );
}
