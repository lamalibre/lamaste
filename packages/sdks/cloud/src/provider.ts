/**
 * Cloud provider interface.
 *
 * Each cloud provider (DigitalOcean, Azure, etc.) implements this interface
 * to provide a unified API for server provisioning.
 */

import type {
  Region,
  RegionWithLatency,
  DropletSize,
  TokenValidation,
  Server,
  CreateServerOptions,
  SSHKey,
} from './types.js';

export interface CloudProvider {
  /** Provider identifier (e.g. "digitalocean", "azure"). */
  readonly name: string;

  /**
   * Validate an API token — check scopes and reject overly broad tokens.
   * Returns validation result with missing/excess scope details.
   */
  validateToken(token: string): Promise<TokenValidation>;

  /** List available regions. */
  getRegions(): Promise<readonly Region[]>;

  /** List available droplet sizes for a region. */
  getSizes(region: string): Promise<readonly DropletSize[]>;

  /**
   * Probe latency to each region and return results sorted by latency.
   * Uses provider-specific speed test endpoints.
   */
  probeLatency(regions: readonly Region[]): Promise<readonly RegionWithLatency[]>;

  /** Create a server (droplet/VM). */
  createServer(options: CreateServerOptions): Promise<Server>;

  /** Get server details by provider-specific ID. */
  getServer(id: string): Promise<Server>;

  /**
   * Destroy a server. Only operates on servers tagged with both
   * "lamalibre:managed" (ecosystem safety gate) and "product:lamaste"
   * (this product's owner tag). Throws if either tag is missing.
   */
  destroyServer(id: string): Promise<void>;

  /** Upload an SSH public key to the provider. */
  createSSHKey(name: string, publicKey: string): Promise<SSHKey>;

  /** Delete an SSH key from the provider. */
  deleteSSHKey(id: string): Promise<void>;
}
