/**
 * The panel's request hook runtime for the forwarder
 * (`createHookedForwarder` in @lamalibre/lamaste/server): which request
 * hooks a plugin has, how one runs, and the fallback while it is down.
 *
 * Only an approved relay hook set runs. A plugin whose installed set is not
 * the approved one has its forwarded traffic refused (503) — letting it past
 * hooks that do not run would be a bypass.
 */

import { findPlugin } from './plugins.js';
import { installedRelayHooks, installedVersionApproved } from './plugin-hooks.js';
import { runRelayHook } from './relay-hooks.js';
import { getStateDb } from './state-db.js';

/** plugin → the fallback its `tunnel:down` hook returned, while it is down. */
const fallbacks = new Map();

/** plugin → declared effect types of its relay hooks (from the last `hooksFor`). */
const declaredEffects = new Map();

/** Load the persisted fallbacks (start-up). */
export async function loadTunnelFallbacks() {
  const db = await getStateDb();
  fallbacks.clear();
  for (const row of db
    .prepare(
      'SELECT plugin, tunnel_fallback FROM plugin_hook_sets WHERE tunnel_fallback IS NOT NULL',
    )
    .all()) {
    try {
      fallbacks.set(row.plugin, JSON.parse(row.tunnel_fallback));
    } catch {
      // A malformed row serves no fallback.
    }
  }
}

/** Keep the in-memory fallback in step with the persisted one (tunnel-hooks.js). */
export function rememberTunnelFallback(plugin, fallback) {
  if (fallback) fallbacks.set(plugin, fallback);
  else fallbacks.delete(plugin);
}

/** @type {import('@lamalibre/lamaste/server').RequestHookRuntime} */
export const requestHookRuntime = {
  async hooksFor(plugin) {
    const entry = await findPlugin(plugin);
    const relay = entry ? installedRelayHooks(entry) : null;
    if (!relay) return { hooks: [] };
    if (!(await installedVersionApproved(entry))) {
      return {
        refuse: `The relay hooks of plugin "${plugin}" are not approved — an administrator approves them in the panel`,
      };
    }
    declaredEffects.set(plugin, relay.set.effects);
    return { hooks: relay.set.request };
  },

  async run(plugin, hook, input, body) {
    const result = await runRelayHook({
      plugin,
      stage: `request:${hook.stage}`,
      call: hook.use
        ? { kind: 'shared', name: hook.use, settings: hook.settings }
        : { kind: 'app' },
      input,
      body,
      timeoutMs: hook.timeoutMs,
      effects: declaredEffects.get(plugin) ?? [],
    });
    if (!result.ok) return { ok: false };
    return { ok: true, decision: result.decision, body: result.body };
  },

  fallbackFor(plugin) {
    return fallbacks.get(plugin) ?? null;
  },
};
