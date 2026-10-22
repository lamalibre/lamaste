/**
 * Health monitor for hosted agent-hosted plugins.
 *
 * Nothing on the relay is told when a plugin's internal tunnel or its agent
 * half goes down, so the panel looks for itself. Every interval, for every
 * hosting:
 *
 * 1. a TCP connect to the relay-loopback port. Chisel opens a reverse
 *    listener only while the hosting agent is connected, so a refused
 *    connection means the **tunnel** is down;
 * 2. when that connects, `GET /admin/health` on the agent half with a caller
 *    assertion (`callAgentHalf`). Only a 2xx answer authenticated with the
 *    responder header (`createHealthHandler` in `@lamalibre/lamaste/agent`)
 *    counts: whatever squats the port without the installation secret — a
 *    process that took it while the agent was away — is not the plugin's
 *    application, however it answers. A failure here means the tunnel is up
 *    but the **application** is down — a different state and a different
 *    reason.
 *
 * Hysteresis: `down` after `downAfter` consecutive failures, `up` after
 * `upAfter` consecutive successes, so one missed probe changes nothing. Each
 * transition is reported once (persisted by the caller; it drives the
 * `tunnel:down` / `tunnel:up` hooks). While a hosting is `down`, neither
 * forwarder — the admin API nor the user surface — connects to the port:
 * whatever holds it then is not known to be the agent half, so the admin
 * forwarder answers as a dead tunnel does (or with the plugin's
 * `tunnel:down` fallback) and the user surface 503. Lamaste's own calls —
 * these probes, settings, hooks, the identity feed — keep reaching the
 * port, each authenticated by its responder signature, so the half coming
 * back is seen. While a hosting is `up`, a request is attempted and the
 * real connection is the truth.
 */

import net from 'node:net';
import { AGENT_HALF_HEALTH_PATH, callAgentHalf } from '../agent-half-call.js';
import type { PluginHostingHealth, PluginHostingHealthState } from './plugin-hosting.js';

export { AGENT_HALF_HEALTH_PATH };

export const PLUGIN_HEALTH_DEFAULTS = Object.freeze({
  intervalMs: 10_000,
  downAfter: 3,
  upAfter: 2,
  connectTimeoutMs: 2_000,
  healthTimeoutMs: 5_000,
});

/** The largest health answer read; the agent half's is a few bytes. */
const HEALTH_ANSWER_MAX_BYTES = 64 * 1024;

export type PluginProbeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'tunnel' | 'app'; readonly error: string };

export interface PluginProbeTarget {
  readonly plugin: string;
  readonly port: number;
  readonly secret: string;
}

export interface PluginProbeOptions {
  readonly host?: string | undefined;
  readonly connectTimeoutMs?: number | undefined;
  readonly healthTimeoutMs?: number | undefined;
}

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`connect timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** One probe of one hosting: tunnel first, then the application. */
export async function probePluginHosting(
  target: PluginProbeTarget,
  opts: PluginProbeOptions = {},
): Promise<PluginProbeResult> {
  const host = opts.host ?? '127.0.0.1';
  try {
    await tcpConnect(
      host,
      target.port,
      opts.connectTimeoutMs ?? PLUGIN_HEALTH_DEFAULTS.connectTimeoutMs,
    );
  } catch (err: unknown) {
    return { ok: false, reason: 'tunnel', error: err instanceof Error ? err.message : String(err) };
  }
  try {
    // Any failure past the connect — no answer, an unauthenticated one, a
    // status other than 2xx — is the application's.
    const answer = await callAgentHalf({
      plugin: target.plugin,
      port: target.port,
      host,
      secret: target.secret,
      method: 'GET',
      path: AGENT_HALF_HEALTH_PATH,
      timeoutMs: opts.healthTimeoutMs ?? PLUGIN_HEALTH_DEFAULTS.healthTimeoutMs,
      maxResponseBytes: HEALTH_ANSWER_MAX_BYTES,
    });
    if (!answer.ok) return { ok: false, reason: 'app', error: answer.error };
    if (answer.status >= 200 && answer.status < 300) return { ok: true };
    return {
      ok: false,
      reason: 'app',
      error: `${AGENT_HALF_HEALTH_PATH} answered ${answer.status}`,
    };
  } catch (err: unknown) {
    return { ok: false, reason: 'app', error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PluginHealthTracker {
  readonly state: PluginHostingHealthState;
  readonly reason?: 'tunnel' | 'app' | undefined;
  readonly since: string;
  readonly lastError?: string | undefined;
  readonly checkedAt?: string | undefined;
  /** Failures in a row *with the same reason* — a changed reason starts over. */
  readonly consecutiveFailures: number;
  readonly failingReason?: 'tunnel' | 'app' | undefined;
  readonly consecutiveSuccesses: number;
}

/**
 * Apply one probe result to a tracker. Pure; returns the next tracker and
 * whether the state changed. Exported for tests.
 */
export function applyProbe(
  tracker: PluginHealthTracker,
  result: PluginProbeResult,
  now: Date,
  thresholds: { downAfter: number; upAfter: number } = PLUGIN_HEALTH_DEFAULTS,
): { readonly next: PluginHealthTracker; readonly changed: boolean } {
  const checkedAt = now.toISOString();
  if (result.ok) {
    const successes = tracker.consecutiveSuccesses + 1;
    const becomesUp = tracker.state !== 'up' && successes >= thresholds.upAfter;
    return {
      next: {
        state: becomesUp ? 'up' : tracker.state,
        since: becomesUp ? checkedAt : tracker.since,
        checkedAt,
        consecutiveFailures: 0,
        consecutiveSuccesses: successes,
        ...(becomesUp ? {} : { reason: tracker.reason, lastError: tracker.lastError }),
      },
      changed: becomesUp,
    };
  }
  // Three refused connects and then one bad health answer are not three
  // failures of one kind: the count restarts when the reason changes, so a
  // new reason is reported only once it is as steady as the first one was.
  const failures = tracker.failingReason === result.reason ? tracker.consecutiveFailures + 1 : 1;
  const becomesDown =
    failures >= thresholds.downAfter &&
    (tracker.state !== 'down' || tracker.reason !== result.reason);
  return {
    next: {
      state: becomesDown ? 'down' : tracker.state,
      reason: becomesDown ? result.reason : tracker.reason,
      since: becomesDown ? checkedAt : tracker.since,
      lastError: result.error,
      checkedAt,
      consecutiveFailures: failures,
      failingReason: result.reason,
      consecutiveSuccesses: 0,
    },
    changed: becomesDown,
  };
}

export interface MonitoredHosting extends PluginProbeTarget {
  /** The health last persisted, so a restart resumes from it. */
  readonly health: PluginHostingHealth;
}

export interface PluginHealthMonitorOptions {
  /** The hostings to watch, read every interval. */
  listHostings(): Promise<readonly MonitoredHosting[]>;
  /** A state transition: persist it, and later run the tunnel hooks. */
  onTransition(plugin: string, health: PluginHostingHealth): Promise<void>;
  readonly intervalMs?: number | undefined;
  readonly downAfter?: number | undefined;
  readonly upAfter?: number | undefined;
  readonly connectTimeoutMs?: number | undefined;
  readonly healthTimeoutMs?: number | undefined;
  readonly host?: string | undefined;
  readonly logger?:
    | {
        warn(obj: Record<string, unknown>, msg?: string): void;
        info(obj: Record<string, unknown>, msg?: string): void;
      }
    | undefined;
}

export interface PluginHealthMonitor {
  /** Run one round of probes now (the timer does this on its own). */
  tick(): Promise<void>;
  /** The trackers as of the last round. */
  snapshot(): ReadonlyMap<string, PluginHealthTracker>;
  stop(): void;
}

/** Start probing. Returns the monitor; `stop()` ends it. */
export function startPluginHealthMonitor(opts: PluginHealthMonitorOptions): PluginHealthMonitor {
  const intervalMs = opts.intervalMs ?? PLUGIN_HEALTH_DEFAULTS.intervalMs;
  const thresholds = {
    downAfter: opts.downAfter ?? PLUGIN_HEALTH_DEFAULTS.downAfter,
    upAfter: opts.upAfter ?? PLUGIN_HEALTH_DEFAULTS.upAfter,
  };
  const trackers = new Map<string, PluginHealthTracker>();
  let running = false;
  let stopped = false;

  async function tick(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      const hostings = await opts.listHostings();
      const seen = new Set<string>();
      for (const hosting of hostings) {
        seen.add(hosting.plugin);
        const tracker: PluginHealthTracker = trackers.get(hosting.plugin) ?? {
          state: hosting.health.state,
          reason: hosting.health.reason,
          since: hosting.health.since,
          lastError: hosting.health.lastError,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        };
        const result = await probePluginHosting(hosting, {
          host: opts.host,
          connectTimeoutMs: opts.connectTimeoutMs,
          healthTimeoutMs: opts.healthTimeoutMs,
        });
        const { next, changed } = applyProbe(tracker, result, new Date(), thresholds);
        trackers.set(hosting.plugin, next);
        if (changed) {
          const health: PluginHostingHealth = {
            state: next.state,
            since: next.since,
            ...(next.state === 'down' ? { reason: next.reason, lastError: next.lastError } : {}),
          };
          try {
            await opts.onTransition(hosting.plugin, health);
            opts.logger?.info(
              { plugin: hosting.plugin, state: health.state, reason: health.reason ?? null },
              'Hosted plugin health changed',
            );
          } catch (err: unknown) {
            opts.logger?.warn(
              { plugin: hosting.plugin, err: err instanceof Error ? err.message : String(err) },
              'Failed to record a hosted plugin health transition',
            );
          }
        }
      }
      for (const plugin of trackers.keys()) {
        if (!seen.has(plugin)) trackers.delete(plugin);
      }
    } catch (err: unknown) {
      opts.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Hosted plugin health round failed',
      );
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  return {
    tick,
    snapshot: () => trackers,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
