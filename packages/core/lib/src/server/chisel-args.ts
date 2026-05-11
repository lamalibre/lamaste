/**
 * Chisel client argument builder (pure, no shell).
 *
 * Used by endpoints that generate the agent's chisel client command line:
 * the mac-plist endpoint renders it into plist XML, the agent-config endpoint
 * returns it as raw args for any platform.
 */

export interface ChiselTunnel {
  readonly port: number;
}

/**
 * Build the Chisel client argument array from a tunnel list and a base domain.
 *
 * @param tunnels - Enabled tunnels (only `port` is read)
 * @param domain - Base domain (e.g. "example.com")
 * @returns Chisel client argument array, suitable for `chisel <args...>`
 */
export function buildChiselArgs(tunnels: readonly ChiselTunnel[], domain: string): string[] {
  const args = ['client', '--tls-skip-verify', `https://tunnel.${domain}:443`];

  for (const tunnel of tunnels) {
    args.push(`R:127.0.0.1:${tunnel.port}:127.0.0.1:${tunnel.port}`);
  }

  return args;
}
