import {
  AGENT_LABEL_REGEX,
  tunnelServedUserSurfaceRoutes,
  tunnelUserSurfaceRoutes,
} from '@lamalibre/lamaste';
import type { AccessMode } from './constants.js';
import { ACCESS_MODES } from './constants.js';
import type { PluginTunnelTarget, TunnelInfo } from './types.js';

/**
 * The agent-side target of a plugin tunnel, or undefined. Only a well-formed
 * one is returned: its fields end up in a signed assertion.
 */
function pluginTunnelTarget(t: Record<string, unknown>): PluginTunnelTarget | undefined {
  const { type, agentLabel, port, pluginRoute } = t;
  if (
    type !== 'plugin' ||
    typeof agentLabel !== 'string' ||
    !AGENT_LABEL_REGEX.test(agentLabel) ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof pluginRoute !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginRoute)
  ) {
    return undefined;
  }
  return { agentLabel, port, route: pluginRoute };
}

/** The stored access mode; restricted when absent — and when it is not one Gatekeeper knows. */
function accessModeOf(value: unknown): AccessMode {
  return (ACCESS_MODES as readonly unknown[]).includes(value)
    ? (value as AccessMode)
    : 'restricted';
}

/**
 * What Gatekeeper authorizes, read from the panel's `tunnels.json` (parsed):
 * every tunnel with a hostname — an internal plugin tunnel has none — with
 * its access mode, its plugin target (a plugin tunnel) and the plugin routes
 * bound to its host as a user surface (core `tunnelUserSurfaceRoutes`: app
 * tunnels only, valid routes only) — of which its host serves only those
 * whose plugin the tunnel's own agent hosts, as the internal plugin
 * tunnels in the same file tell (core `tunnelServedUserSurfaceRoutes`).
 * Pure; anything that is not a list is no tunnel at all.
 */
export function tunnelInfoFromState(parsed: unknown): TunnelInfo[] {
  if (!Array.isArray(parsed)) return [];
  const out: TunnelInfo[] = [];
  for (const entry of parsed as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Record<string, unknown>;
    if (t['exposure'] === 'internal' || !t['fqdn']) continue;
    const plugin = pluginTunnelTarget(t);
    const userSurfaceRoutes = tunnelUserSurfaceRoutes(t);
    out.push({
      id: String(t['id'] ?? ''),
      fqdn: String(t['fqdn']),
      accessMode: accessModeOf(t['accessMode']),
      enabled: t['enabled'] !== false,
      ...(plugin ? { plugin } : {}),
      ...(userSurfaceRoutes.length > 0
        ? {
            userSurface: {
              routes: userSurfaceRoutes,
              served: tunnelServedUserSurfaceRoutes(parsed, t),
            },
          }
        : {}),
    });
  }
  return out;
}
