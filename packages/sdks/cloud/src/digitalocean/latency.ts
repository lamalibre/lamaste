/**
 * DigitalOcean region latency probing.
 *
 * Sends HEAD requests to DigitalOcean Spaces endpoints for each region
 * and measures round-trip time to determine the closest region.
 *
 * The old `speedtest-{region}.digitalocean.com` endpoints were
 * decommissioned. Spaces endpoints (`{region}.digitaloceanspaces.com`)
 * are the standard alternative used by latency measurement tools.
 *
 * Not all compute regions have a Spaces endpoint, so we map nearby
 * regions (e.g., nyc1 → nyc3, sfo2 → sfo3).
 */

import { fetch } from 'undici';
import { CloudError } from '../errors.js';
import type { Region, RegionWithLatency } from '../types.js';

/**
 * Map compute region slugs to the nearest Spaces region.
 * Regions with a direct Spaces endpoint map to themselves.
 */
const SPACES_REGION_MAP: Record<string, string> = {
  nyc1: 'nyc3',
  nyc2: 'nyc3',
  nyc3: 'nyc3',
  sfo2: 'sfo3',
  sfo3: 'sfo3',
  ams3: 'ams3',
  sgp1: 'sgp1',
  lon1: 'lon1',
  fra1: 'fra1',
  tor1: 'tor1',
  blr1: 'blr1',
  syd1: 'syd1',
};

const REGION_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function speedTestUrl(regionSlug: string): string {
  if (!REGION_SLUG_RE.test(regionSlug)) {
    throw new Error(`Invalid region slug: ${regionSlug}`);
  }
  const spacesRegion = SPACES_REGION_MAP[regionSlug] ?? regionSlug;
  return `https://${spacesRegion}.digitaloceanspaces.com/`;
}

/**
 * Probe latency to a single region by sending a HEAD request
 * and measuring the round-trip time.
 *
 * Returns null if the probe fails (region unreachable, timeout, etc.).
 */
async function probeRegion(region: Region): Promise<RegionWithLatency | null> {
  const url = speedTestUrl(region.slug);
  const start = performance.now();

  try {
    await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Math.round(performance.now() - start);
    return { ...region, latencyMs };
  } catch {
    return null;
  }
}

/**
 * Probe latency to all provided regions in parallel.
 * Returns results sorted by latency (lowest first).
 * Regions that fail to probe are excluded from the results.
 *
 * @throws {CloudError} if every region probe fails — caller cannot choose a
 *         "closest" region when the network itself is unreachable.
 */
export async function probeRegionLatencies(
  regions: readonly Region[],
): Promise<readonly RegionWithLatency[]> {
  const candidates = regions.filter((r) => r.available);
  const results = await Promise.allSettled(candidates.map((r) => probeRegion(r)));

  const successful: RegionWithLatency[] = [];
  let failed = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      successful.push(result.value);
    } else {
      failed++;
    }
  }

  if (candidates.length > 0 && successful.length === 0) {
    throw new CloudError('No DigitalOcean regions were reachable — check network connectivity');
  }

  if (failed > 0 && successful.length < candidates.length / 2) {
    // Surface degraded-network visibility on stderr. Cloud SDK has no logger
    // abstraction; stderr is the existing convention for out-of-band warnings.
    process.stderr.write(
      `warning: only ${successful.length}/${candidates.length} DigitalOcean regions reachable; ` +
        `latency-based recommendations may be unreliable\n`,
    );
  }

  return successful.sort((a, b) => a.latencyMs - b.latencyMs);
}
