/**
 * Chisel client argument builder (pure, no shell).
 *
 * Used by the agent-config endpoint, which returns the args for the tunnels
 * one agent carries; the agent renders them into its own service definition.
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
  // No --tls-skip-verify: tunnel.<domain> carries a publicly trusted
  // certificate and the agent verifies it. No --auth either: the agent
  // supplies its credential through the environment, never the panel.
  const args = ['client', `https://tunnel.${domain}:443`];

  for (const tunnel of tunnels) {
    args.push(`R:127.0.0.1:${tunnel.port}:127.0.0.1:${tunnel.port}`);
  }

  return args;
}
