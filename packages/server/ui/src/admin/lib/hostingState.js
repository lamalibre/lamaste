import { relativeTime } from './formatters.js';

/**
 * Whether an agent-hosted plugin's agent half can be reached, in words —
 * for its panel pages (`PluginLoader`), the sidebar, its card and its
 * settings form. Pure: every function takes `now` (epoch milliseconds — a
 * component passes the time its data was fetched) instead of reading the
 * clock.
 *
 * The hosting is offline when the relay's health monitor reports it
 * `down`: reason `tunnel` — the internal tunnel's loopback port refuses, so
 * the hosting agent is offline (its last sync, `agentLastSeenAt`, says since
 * when the relay has not heard from it) — or reason `app` — the port
 * answers and the agent half does not.
 */

/**
 * `14:05:12 (12m ago)` — a moment, with the date when it is not the day of
 * `now`.
 *
 * @param {string} iso
 * @param {number} now
 */
export function formatMoment(iso, now) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'an unknown time';
  const date = new Date(time);
  const clock =
    new Date(now).toDateString() === date.toDateString()
      ? date.toLocaleTimeString()
      : date.toLocaleString();
  return `${clock} (${relativeTime(iso, now)})`;
}

/**
 * @typedef {{ agentLabel: string, reason: string | null, since: string | null, agentLastSeenAt: string | null }} HostingOutage
 */

/**
 * The outage of a hosting as the plugin list and the hosting view report
 * it (`agentHosting`: `{ agentLabel, health: { state, reason, since },
 * agentLastSeenAt }`), or null when it is not down.
 *
 * @returns {HostingOutage | null}
 */
export function hostingOutage(agentHosting) {
  if (!agentHosting || agentHosting.health?.state !== 'down') return null;
  return {
    agentLabel: agentHosting.agentLabel,
    reason: agentHosting.health.reason ?? null,
    since: agentHosting.health.since ?? null,
    agentLastSeenAt: agentHosting.agentLastSeenAt ?? null,
  };
}

/**
 * The outage of a hosting as the settings view reports it (`hosting`:
 * `{ agentLabel, state, reason, since, agentLastSeenAt }`), or null when it
 * is not down.
 *
 * @returns {HostingOutage | null}
 */
export function settingsHostingOutage(hosting) {
  if (!hosting || hosting.state !== 'down') return null;
  return {
    agentLabel: hosting.agentLabel,
    reason: hosting.reason ?? null,
    since: hosting.since ?? null,
    agentLastSeenAt: hosting.agentLastSeenAt ?? null,
  };
}

/**
 * "Hosting agent edge-1 is offline since 14:05:12 (12m ago) — last sync
 * 14:04:40 (13m ago)" for reason `tunnel`, "The agent half is not
 * responding since …" for reason `app`.
 *
 * @param {HostingOutage} outage
 * @param {number} now
 */
export function outageMessage(outage, now) {
  const since = outage.since ? formatMoment(outage.since, now) : 'an unknown time';
  if (outage.reason === 'app') return `The agent half is not responding since ${since}`;
  if (outage.reason === 'tunnel') {
    const lastSync = outage.agentLastSeenAt
      ? `last sync ${formatMoment(outage.agentLastSeenAt, now)}`
      : 'no sync recorded';
    return `Hosting agent ${outage.agentLabel} is offline since ${since} — ${lastSync}`;
  }
  return `The hosting on ${outage.agentLabel} is down since ${since}`;
}

/**
 * Whether a plugin's panel pages can load now. A server plugin, or an
 * agent-hosted one whose hosting is active and not down, loads (`mount`;
 * health `unknown` loads too — the forwarder decides). An agent-hosted
 * plugin with an agent half whose hosting is down is `offline` — its bundle
 * comes from the agent half, so fetching it could only fail, after the
 * forwarder's timeout — and one that is not hosted, or whose hosting is
 * being set up or removed, is `waiting`. Both carry the sentence to show.
 *
 * @param {object | undefined} plugin  the plugin's entry of the plugin list
 * @param {number} now
 * @returns {{ state: 'mount' } | { state: 'offline' | 'waiting', message: string }}
 */
export function panelAvailability(plugin, now) {
  if (!plugin || plugin.hosting !== 'agent' || plugin.agent == null) return { state: 'mount' };
  const hosting = plugin.agentHosting;
  const name = plugin.displayName || plugin.name;
  if (!hosting) {
    return {
      state: 'waiting',
      message: `${name} is not hosted on an agent — host it on the Plugins page`,
    };
  }
  if (hosting.phase && hosting.phase !== 'active') {
    return {
      state: 'waiting',
      message:
        hosting.phase === 'installing'
          ? `The hosting of ${name} on ${hosting.agentLabel} is being set up`
          : `The hosting of ${name} on ${hosting.agentLabel} is being removed`,
    };
  }
  const outage = hostingOutage(hosting);
  if (outage) return { state: 'offline', message: outageMessage(outage, now) };
  return { state: 'mount' };
}

/**
 * Why a plugin's settings cannot be changed now, or null when they can —
 * the relay's own rule: they are written to the agent half through the
 * tunnel, so only while its hosting is active and its health is not `down`
 * (`unknown`, right after hosting, is writable: an answer that does not
 * authenticate itself as the agent half's is refused, so nothing else on
 * the tunnel's port can take a change) — and a change names the revision it
 * was made on, so not before the relay has read them once (`revision`
 * null).
 *
 * @param {{ hosting: object | null, revision: number | null }} view  the settings view
 * @param {number} now
 * @returns {string | null}
 */
export function settingsReadOnlyReason(view, now) {
  const hosting = view.hosting;
  if (!hosting) return 'Not hosted on an agent yet';
  if (hosting.phase && hosting.phase !== 'active') {
    return hosting.phase === 'installing'
      ? `The hosting on ${hosting.agentLabel} is being set up`
      : `The hosting on ${hosting.agentLabel} is being removed`;
  }
  const outage = settingsHostingOutage(hosting);
  if (outage) return outageMessage(outage, now);
  if (typeof view.revision !== 'number') {
    return 'The settings could not be read from the agent half yet';
  }
  return null;
}
