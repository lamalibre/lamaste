/**
 * The tunnel-state pipeline on the relay: when the health monitor sees a
 * hosted plugin go down (the tunnel, or the application behind it) or come
 * back, Lamaste runs the plugin's `tunnel:down` / `tunnel:up` relay hook.
 * What `tunnel:down` returns as `fallback` is what the forwarder answers
 * while the plugin is down, instead of a bare 502; `tunnel:up` clears it.
 *
 * `tunnel:up` runs only after a `down` — not when a hosting is first seen
 * up, or after a restart of the panel. The agent side of the pipeline runs
 * on the agent (its sync follows the relay's view of the tunnel).
 *
 * Calls for one plugin are serialised and run beside the monitor, which
 * does not wait for them.
 */

import { findPlugin } from './plugins.js';
import {
  installedRelayHooks,
  installedVersionApproved,
  setTunnelFallback,
} from './plugin-hooks.js';
import { runRelayHook } from './relay-hooks.js';
import { rememberTunnelFallback } from './request-hooks.js';

const chains = new Map();

/**
 * React to a persisted health transition of `plugin` (`before` → `after`).
 * Never throws; failures are logged.
 */
export function onHealthTransition(plugin, before, after, logger) {
  const previous = chains.get(plugin) ?? Promise.resolve();
  const next = previous
    .then(() => runTunnelHook(plugin, before, after, logger))
    .catch((err) => {
      logger?.error({ plugin, err: err?.message }, 'Tunnel-state hook pipeline failed');
    });
  chains.set(plugin, next);
  next.finally(() => {
    if (chains.get(plugin) === next) chains.delete(plugin);
  });
  return next;
}

async function runTunnelHook(plugin, before, after, logger) {
  let stage;
  if (after.state === 'down') stage = 'tunnel:down';
  else if (after.state === 'up' && before?.state === 'down') stage = 'tunnel:up';
  else return;

  const entry = await findPlugin(plugin);
  const relay = entry ? installedRelayHooks(entry) : null;
  const decl = relay?.set.stages.find((s) => s.stage === stage) ?? null;
  if (stage === 'tunnel:up') {
    // Whatever happens next, the plugin is up: no fallback.
    await setTunnelFallback(plugin, null);
    rememberTunnelFallback(plugin, null);
  }
  if (!decl) return;
  if (!(await installedVersionApproved(entry))) return;

  const result = await runRelayHook({
    plugin,
    stage,
    call: { kind: 'app' },
    input: {
      state: after.state,
      ...(after.reason ? { reason: after.reason } : {}),
      since: after.since,
      ...(after.lastError ? { lastError: after.lastError.slice(0, 300) } : {}),
    },
    timeoutMs: decl.timeoutMs,
    effects: relay.set.effects,
    logger,
  });
  if (!result.ok) return;
  if (stage === 'tunnel:down') {
    const fallback = result.decision.fallback ?? null;
    await setTunnelFallback(plugin, fallback);
    rememberTunnelFallback(plugin, fallback);
    logger?.info(
      { plugin, reason: after.reason, fallback: fallback !== null },
      'Ran tunnel:down hook',
    );
  } else {
    logger?.info({ plugin }, 'Ran tunnel:up hook');
  }
}
