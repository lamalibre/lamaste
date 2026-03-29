/**
 * DigitalOcean DNS management via the Domains API.
 *
 * Used during cloud provisioning to automatically create A and wildcard
 * A records for the Portlama panel domain. All functions use the shared
 * doGet/doPost helpers from api.ts.
 */

import type { DODomain, DODomainRecord, DnsSetupResult } from '../types.js';
import { doGet, doPost, doDelete, assertObject, assertField } from './api.js';

/** Hard cap on pagination to prevent unbounded memory consumption. */
const MAX_PAGES = 10;

const FQDN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function assertValidDomain(name: string, label: string): void {
  if (!FQDN_REGEX.test(name)) {
    throw new Error(`Invalid ${label}: "${name}" is not a valid domain name`);
  }
}

function assertValidSubdomain(value: string): void {
  if (!SUBDOMAIN_REGEX.test(value)) {
    throw new Error(`Invalid subdomain: "${value}"`);
  }
}

function assertValidIpv4(ip: string): void {
  if (!IPV4_REGEX.test(ip)) {
    throw new Error(`Invalid IPv4 address: "${ip}"`);
  }
}

// ---------------------------------------------------------------------------
// Domain CRUD
// ---------------------------------------------------------------------------

/**
 * List all DigitalOcean-managed domains. Paginates automatically.
 */
export async function listDomains(token: string): Promise<DODomain[]> {
  const domains: DODomain[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { body } = await doGet(
      `/v2/domains?page=${page}&per_page=${perPage}`,
      { token },
    );

    assertObject(body, 'domains response');
    assertField(body, 'domains', 'array', 'domains response');
    const items = body.domains as Array<Record<string, unknown>>;

    for (const d of items) {
      domains.push({
        name: typeof d.name === 'string' ? d.name : '',
        ttl: typeof d.ttl === 'number' ? d.ttl : 1800,
      });
    }

    const meta = body.meta as Record<string, unknown> | undefined;
    const total = typeof meta?.total === 'number' ? meta.total : 0;
    if (page * perPage >= total || page >= MAX_PAGES) break;
    page++;
  }

  return domains;
}

/**
 * Create a new domain in DigitalOcean DNS.
 *
 * The caller must ensure NS records for the domain point to
 * ns1.digitalocean.com, ns2.digitalocean.com, ns3.digitalocean.com
 * before DNS resolution will work.
 */
export async function createDomain(
  token: string,
  name: string,
): Promise<DODomain> {
  assertValidDomain(name, 'domain name');
  const { body } = await doPost(
    '/v2/domains',
    { name },
    { token },
  );

  assertObject(body, 'create domain response');
  assertField(body, 'domain', 'object', 'create domain response');
  const d = body.domain as Record<string, unknown>;

  return {
    name: typeof d.name === 'string' ? d.name : name,
    ttl: typeof d.ttl === 'number' ? d.ttl : 1800,
  };
}

// ---------------------------------------------------------------------------
// Domain records
// ---------------------------------------------------------------------------

/**
 * List all DNS records for a domain. Paginates automatically.
 */
export async function listDomainRecords(
  token: string,
  domain: string,
): Promise<DODomainRecord[]> {
  assertValidDomain(domain, 'domain');
  const records: DODomainRecord[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { body } = await doGet(
      `/v2/domains/${encodeURIComponent(domain)}/records?page=${page}&per_page=${perPage}`,
      { token },
    );

    assertObject(body, 'domain records response');
    assertField(body, 'domain_records', 'array', 'domain records response');
    const items = body.domain_records as Array<Record<string, unknown>>;

    for (const r of items) {
      records.push({
        id: typeof r.id === 'number' ? r.id : 0,
        type: typeof r.type === 'string' ? r.type : '',
        name: typeof r.name === 'string' ? r.name : '',
        data: typeof r.data === 'string' ? r.data : '',
        ttl: typeof r.ttl === 'number' ? r.ttl : 1800,
      });
    }

    const meta = body.meta as Record<string, unknown> | undefined;
    const total = typeof meta?.total === 'number' ? meta.total : 0;
    if (page * perPage >= total || page >= MAX_PAGES) break;
    page++;
  }

  return records;
}

/**
 * Create a single A record for a domain.
 */
export async function createARecord(
  token: string,
  domain: string,
  name: string,
  ip: string,
  ttl = 300,
): Promise<DODomainRecord> {
  assertValidDomain(domain, 'domain');
  assertValidIpv4(ip);
  const { body } = await doPost(
    `/v2/domains/${encodeURIComponent(domain)}/records`,
    { type: 'A', name, data: ip, ttl },
    { token },
  );

  assertObject(body, 'create record response');
  assertField(body, 'domain_record', 'object', 'create record response');
  const r = body.domain_record as Record<string, unknown>;

  return {
    id: typeof r.id === 'number' ? r.id : 0,
    type: typeof r.type === 'string' ? r.type : 'A',
    name: typeof r.name === 'string' ? r.name : name,
    data: typeof r.data === 'string' ? r.data : ip,
    ttl: typeof r.ttl === 'number' ? r.ttl : ttl,
  };
}

/**
 * Delete a DNS record by ID.
 */
export async function deleteDomainRecord(
  token: string,
  domain: string,
  recordId: number,
): Promise<void> {
  assertValidDomain(domain, 'domain');
  await doDelete(
    `/v2/domains/${encodeURIComponent(domain)}/records/${recordId}`,
    { token },
  );
}

// ---------------------------------------------------------------------------
// Orchestrator: set up A + wildcard A records for provisioning
// ---------------------------------------------------------------------------

/**
 * Create A and wildcard A records for a Portlama panel domain.
 *
 * Handles three cases for each record:
 * - No existing record: create it
 * - Existing record points to the same IP: skip (idempotent)
 * - Existing record points to a different IP: warn, do NOT overwrite
 */
export async function setupDnsRecords(
  token: string,
  domain: string,
  subdomain: string | undefined,
  dropletIp: string,
): Promise<DnsSetupResult> {
  if (subdomain !== undefined) {
    assertValidSubdomain(subdomain);
  }
  assertValidIpv4(dropletIp);

  // Compose record names for the DO API.
  // DO uses "@" for the domain apex and bare names for subdomains.
  const aName = subdomain ?? '@';
  const wildcardName = subdomain ? `*.${subdomain}` : '*';
  const fqdn = subdomain ? `${subdomain}.${domain}` : domain;

  const existingRecords = await listDomainRecords(token, domain);
  const existingARecords = existingRecords.filter((r) => r.type === 'A');

  let aRecordCreated = false;
  let wildcardCreated = false;
  const warnings: string[] = [];
  const createdRecordIds: number[] = [];

  // --- A record ---
  const existingA = existingARecords.find((r) => r.name === aName);
  if (existingA) {
    if (existingA.data === dropletIp) {
      // Already points to the right IP — nothing to do
    } else {
      warnings.push(
        `A record for "${aName === '@' ? domain : `${aName}.${domain}`}" ` +
          `points to ${existingA.data} (expected ${dropletIp}). ` +
          `Update it manually in the DigitalOcean DNS console.`,
      );
    }
  } else {
    const record = await createARecord(token, domain, aName, dropletIp);
    aRecordCreated = true;
    if (record.id) createdRecordIds.push(record.id);
  }

  // --- Wildcard A record ---
  const existingWildcard = existingARecords.find((r) => r.name === wildcardName);
  if (existingWildcard) {
    if (existingWildcard.data === dropletIp) {
      // Already points to the right IP — nothing to do
    } else {
      warnings.push(
        `Wildcard A record for "${wildcardName}.${domain}" ` +
          `points to ${existingWildcard.data} (expected ${dropletIp}). ` +
          `Update it manually in the DigitalOcean DNS console.`,
      );
    }
  } else {
    try {
      const record = await createARecord(token, domain, wildcardName, dropletIp);
      wildcardCreated = true;
      if (record.id) createdRecordIds.push(record.id);
    } catch (err: unknown) {
      // Return partial result so the caller can still clean up the A record
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to create wildcard record: ${msg}`);
    }
  }

  return {
    domain: fqdn,
    aRecordCreated,
    wildcardCreated,
    conflictWarning: warnings.length > 0 ? warnings.join(' ') : undefined,
    createdRecordIds,
  };
}
