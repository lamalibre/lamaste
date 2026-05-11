/**
 * Discover existing Lamaste-managed DigitalOcean droplets.
 *
 * Lists droplets tagged `lamalibre:managed` AND `product:lamaste`,
 * resolves DNS domains pointing to each droplet's IP, and determines the
 * panel URL. The ecosystem tag is the safety gate; the product tag narrows
 * discovery to droplets this product owns.
 */

import type { DiscoveredServer } from './types.js';
import { DigitalOceanProvider } from './digitalocean/index.js';
import { listDomains, listDomainRecords } from './digitalocean/dns.js';

/** Droplets we own — must carry both tags. */
const PRODUCT_TAG = 'product:lamaste';

/**
 * Discover Lamaste-managed droplets and resolve their domains.
 *
 * @param token - DigitalOcean API token
 * @returns Array of discovered servers with domain and panel URL info
 */
export async function discover(token: string): Promise<DiscoveredServer[]> {
  const provider = new DigitalOceanProvider(token);

  // 1. List all Lamalibre-managed droplets, then narrow to Lamaste-owned.
  // The provider filters server-side on the ecosystem tag; we filter
  // client-side on the product tag so droplets owned by other Lamalibre
  // products (herd, shell, etc.) don't surface in Lamaste's discover UI.
  const allDroplets = await provider.listManagedDroplets();
  const droplets = allDroplets.filter((d) => d.tags.includes(PRODUCT_TAG));
  if (droplets.length === 0) return [];

  // 2. Collect IPs we need to resolve
  const ips = new Set<string>();
  for (const d of droplets) {
    if (d.ip) ips.add(d.ip);
  }
  if (ips.size === 0) return droplets.map((d) => ({
    dropletId: d.id,
    name: d.name,
    status: d.status,
    ip: d.ip,
    region: d.region,
    createdAt: d.createdAt,
    domains: [],
    panelUrl: d.ip ? `https://${d.ip}:9292` : null,
  }));

  // 3. Build IP → domain[] map from DO DNS and collect zone names
  const ipToDomains = new Map<string, string[]>();
  const zoneNames = new Set<string>();
  try {
    const domains = await listDomains(token);
    for (const domain of domains) {
      zoneNames.add(domain.name);
      try {
        const records = await listDomainRecords(token, domain.name);
        for (const r of records) {
          if (r.type !== 'A' || !ips.has(r.data)) continue;
          const fqdn = r.name === '@'
            ? domain.name
            : `${r.name}.${domain.name}`;
          const list = ipToDomains.get(r.data) ?? [];
          list.push(fqdn);
          ipToDomains.set(r.data, list);
        }
      } catch {
        // Skip domains we can't read records for
      }
    }
  } catch {
    // DNS access may not be available — continue without domain resolution
  }

  // 4. Build results
  return droplets.map((d) => {
    const domains = d.ip ? (ipToDomains.get(d.ip) ?? []) : [];

    // Prefer panel.<domain> URL over IP-based
    // A base domain is one that matches a DO-managed zone (works for any TLD depth)
    const baseDomain = domains.find((fqdn) => zoneNames.has(fqdn));

    let panelUrl: string | null = null;
    if (baseDomain) {
      panelUrl = `https://panel.${baseDomain}`;
    } else if (d.ip) {
      panelUrl = `https://${d.ip}:9292`;
    }

    return {
      dropletId: d.id,
      name: d.name,
      status: d.status,
      ip: d.ip,
      region: d.region,
      createdAt: d.createdAt,
      domains,
      panelUrl,
    };
  });
}
