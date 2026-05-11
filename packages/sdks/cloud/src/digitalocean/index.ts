/**
 * DigitalOcean cloud provider implementation.
 */

import type { CloudProvider } from '../provider.js';
import type {
  Region,
  RegionWithLatency,
  DropletSize,
  TokenValidation,
  Server,
  CreateServerOptions,
  SSHKey,
  DODomain,
  DODomainRecord,
  DnsSetupResult,
} from '../types.js';
import { CloudError } from '../errors.js';
import { doGet, doPost, doDelete, assertObject, assertField } from './api.js';
import { validateDOToken } from './scopes.js';
import { probeRegionLatencies } from './latency.js';
import {
  listDomains as listDomainsApi,
  createDomain as createDomainApi,
  listDomainRecords as listDomainRecordsApi,
  setupDnsRecords as setupDnsRecordsApi,
} from './dns.js';

/**
 * Tags applied to every Lamalibre-managed droplet. Two tags are required:
 *
 * - `lamalibre:managed` — ecosystem-level safety gate. Destroy operations
 *   refuse to run unless this tag is present, so this SDK can never delete
 *   a droplet that wasn't created by a Lamalibre tool.
 * - `product:lamaste` — identifies which Lamalibre product owns the
 *   droplet. The destroyer dispatches on this to invoke the right product-
 *   specific cleanup. Only `lamaste` exists today; future products
 *   (`product:herd`, `product:shell`, etc.) will share the same
 *   `lamalibre:managed` umbrella.
 */
const ECOSYSTEM_MANAGED_TAG = 'lamalibre:managed';
const PRODUCT_TAG = 'product:lamaste';
const REQUIRED_TAGS = [ECOSYSTEM_MANAGED_TAG, PRODUCT_TAG] as const;

/** Default droplet size: 512MB / 1 vCPU / 10GB ($4/mo). */
const DEFAULT_SIZE = 's-1vcpu-512mb-10gb';

/** Default image: Ubuntu 24.04 LTS. */
const DEFAULT_IMAGE = 'ubuntu-24-04-x64';

// ---------------------------------------------------------------------------
// Helper: parse a DO droplet response into our Server type
// ---------------------------------------------------------------------------

function parseDroplet(droplet: Record<string, unknown>): Server {
  const networks = droplet.networks as Record<string, unknown> | undefined;
  let ip: string | null = null;
  if (networks && Array.isArray(networks.v4)) {
    const pub = (networks.v4 as Array<Record<string, unknown>>).find(
      (n) => n.type === 'public',
    );
    if (pub && typeof pub.ip_address === 'string') {
      ip = pub.ip_address;
    }
  }

  const tags = Array.isArray(droplet.tags)
    ? (droplet.tags as string[])
    : [];

  const region = droplet.region as Record<string, unknown> | undefined;
  const regionSlug = typeof region?.slug === 'string' ? region.slug : '';

  return {
    id: String(droplet.id),
    name: typeof droplet.name === 'string' ? droplet.name : '',
    status: (droplet.status as Server['status']) ?? 'new',
    ip,
    region: regionSlug,
    createdAt: typeof droplet.created_at === 'string' ? droplet.created_at : '',
    tags,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class DigitalOceanProvider implements CloudProvider {
  readonly name = 'digitalocean';
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async validateToken(token: string): Promise<TokenValidation> {
    return validateDOToken(token);
  }

  async getRegions(): Promise<readonly Region[]> {
    const regions: Region[] = [];
    let page = 1;
    const perPage = 100;

    // Paginate through all regions
    while (true) {
      const { body } = await doGet(
        `/v2/regions?page=${page}&per_page=${perPage}`,
        { token: this.token },
      );

      assertObject(body, 'regions response');
      assertField(body, 'regions', 'array', 'regions response');
      const items = body.regions as Array<Record<string, unknown>>;

      for (const r of items) {
        // Only include regions that support the required droplet size
        const sizes = Array.isArray(r.sizes) ? (r.sizes as string[]) : [];
        if (!sizes.includes(DEFAULT_SIZE)) continue;

        regions.push({
          slug: typeof r.slug === 'string' ? r.slug : '',
          name: typeof r.name === 'string' ? r.name : '',
          available: r.available === true,
        });
      }

      // Check pagination
      const meta = body.meta as Record<string, unknown> | undefined;
      const total = typeof meta?.total === 'number' ? meta.total : 0;
      if (page * perPage >= total) break;
      page++;
    }

    return regions;
  }

  async getSizes(region: string): Promise<readonly DropletSize[]> {
    const sizes: DropletSize[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { body } = await doGet(
        `/v2/sizes?page=${page}&per_page=${perPage}`,
        { token: this.token },
      );

      assertObject(body, 'sizes response');
      assertField(body, 'sizes', 'array', 'sizes response');
      const items = body.sizes as Array<Record<string, unknown>>;

      for (const s of items) {
        const slug = typeof s.slug === 'string' ? s.slug : '';

        // Basic tier only, exclude AMD/Intel/extra-storage variants
        if (!slug.startsWith('s-')) continue;
        if (slug.includes('-amd') || slug.includes('-intel')) continue;

        if (s.available !== true) continue;

        // Must be available in the selected region
        const regions = Array.isArray(s.regions) ? (s.regions as string[]) : [];
        if (!regions.includes(region)) continue;

        sizes.push({
          slug,
          memory: typeof s.memory === 'number' ? s.memory : 0,
          vcpus: typeof s.vcpus === 'number' ? s.vcpus : 0,
          disk: typeof s.disk === 'number' ? s.disk : 0,
          priceMonthly: typeof s.price_monthly === 'number' ? s.price_monthly : 0,
          available: true,
        });
      }

      const meta = body.meta as Record<string, unknown> | undefined;
      const total = typeof meta?.total === 'number' ? meta.total : 0;
      if (page * perPage >= total) break;
      page++;
    }

    return sizes.sort((a, b) => a.priceMonthly - b.priceMonthly);
  }

  async probeLatency(
    regions: readonly Region[],
  ): Promise<readonly RegionWithLatency[]> {
    return probeRegionLatencies(regions);
  }

  async createServer(options: CreateServerOptions): Promise<Server> {
    const tags = [...REQUIRED_TAGS, ...(options.tags ?? [])];

    const { body } = await doPost(
      '/v2/droplets',
      {
        name: options.name,
        region: options.region,
        size: options.size ?? DEFAULT_SIZE,
        image: DEFAULT_IMAGE,
        ssh_keys: [options.sshKeyId],
        tags,
        ipv6: false,
        monitoring: false,
      },
      { token: this.token, timeoutMs: 60_000 },
    );

    assertObject(body, 'create droplet response');
    assertField(body, 'droplet', 'object', 'create droplet response');
    return parseDroplet(body.droplet as Record<string, unknown>);
  }

  async getServer(id: string): Promise<Server> {
    const { body } = await doGet(
      `/v2/droplets/${encodeURIComponent(id)}`,
      { token: this.token },
    );

    assertObject(body, 'get droplet response');
    assertField(body, 'droplet', 'object', 'get droplet response');
    return parseDroplet(body.droplet as Record<string, unknown>);
  }

  async destroyServer(id: string): Promise<void> {
    // Safety: refuse to destroy unless the ecosystem tag is present. This
    // is the single gate that prevents this SDK from deleting a droplet it
    // didn't create.
    const server = await this.getServer(id);
    if (!server.tags.includes(ECOSYSTEM_MANAGED_TAG)) {
      throw new CloudError(
        `Refusing to destroy droplet ${id}: missing "${ECOSYSTEM_MANAGED_TAG}" tag. ` +
          'Only Lamalibre-managed droplets can be destroyed.',
      );
    }

    // Product dispatch: a future build with multiple destroyers reads the
    // `product:*` tag to decide which product-specific cleanup to invoke.
    // Today only lamaste exists; mismatching tags indicate a droplet that
    // belongs to a different product and shouldn't be touched here.
    if (server.tags.includes(PRODUCT_TAG) === false) {
      // Surface a precise error rather than silently destroying a droplet
      // tagged for another product. Adding herd/shell support later is a
      // matter of giving each product its own destroyer dispatched on this
      // tag — not a matter of widening this single check.
      const productTags = server.tags.filter((t) => t.startsWith('product:'));
      const owner = productTags[0] ?? '(unknown)';
      throw new CloudError(
        `Refusing to destroy droplet ${id}: tagged "${owner}", not "${PRODUCT_TAG}". ` +
          'Use the destroyer for the owning product.',
      );
    }

    await doDelete(
      `/v2/droplets/${encodeURIComponent(id)}`,
      { token: this.token },
    );
  }

  async createSSHKey(name: string, publicKey: string): Promise<SSHKey> {
    const { body } = await doPost(
      '/v2/account/keys',
      { name, public_key: publicKey },
      { token: this.token },
    );

    assertObject(body, 'create SSH key response');
    assertField(body, 'ssh_key', 'object', 'create SSH key response');
    const key = body.ssh_key as Record<string, unknown>;

    return {
      id: String(key.id),
      name: typeof key.name === 'string' ? key.name : '',
      fingerprint: typeof key.fingerprint === 'string' ? key.fingerprint : '',
    };
  }

  async deleteSSHKey(id: string): Promise<void> {
    await doDelete(
      `/v2/account/keys/${encodeURIComponent(id)}`,
      { token: this.token },
    );
  }

  // --- Droplet discovery ---

  async listManagedDroplets(): Promise<Server[]> {
    const servers: Server[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      // Filter on the ecosystem tag — `listManagedDroplets` returns every
      // Lamalibre-managed droplet regardless of which product owns it.
      // Callers that want to narrow to one product (e.g. lamaste-only
      // discovery) filter the result on `tags.includes('product:lamaste')`.
      const { body } = await doGet(
        `/v2/droplets?tag_name=${encodeURIComponent(ECOSYSTEM_MANAGED_TAG)}&page=${page}&per_page=${perPage}`,
        { token: this.token },
      );

      assertObject(body, 'list droplets response');
      assertField(body, 'droplets', 'array', 'list droplets response');
      const items = body.droplets as Array<Record<string, unknown>>;

      for (const d of items) {
        servers.push(parseDroplet(d));
      }

      const meta = body.meta as Record<string, unknown> | undefined;
      const total = typeof meta?.total === 'number' ? meta.total : 0;
      if (page * perPage >= total || page >= 10) break;
      page++;
    }

    return servers;
  }

  // --- DNS management (opt-in, requires domain:* scopes) ---

  async listDomains(): Promise<DODomain[]> {
    return listDomainsApi(this.token);
  }

  async createDomain(name: string): Promise<DODomain> {
    return createDomainApi(this.token, name);
  }

  async listDomainRecords(domain: string): Promise<DODomainRecord[]> {
    return listDomainRecordsApi(this.token, domain);
  }

  async setupDnsRecords(
    domain: string,
    subdomain: string | undefined,
    ip: string,
    overrideExisting = false,
  ): Promise<DnsSetupResult> {
    return setupDnsRecordsApi(this.token, domain, subdomain, ip, overrideExisting);
  }
}
