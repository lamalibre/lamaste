/**
 * A domain's brand for the pages Gatekeeper serves inline — the
 * access-request page and the refusal pages (packages/core/docs/auth-branding-design.md):
 * read from `brand.json` of the domain's rendering, which the panel writes
 * under `/var/www/lamaste/auth/<domain>/` (a symbolic link to the rendering
 * that serves, switched by rename at every change) and nginx serves on
 * `auth.<domain>`.
 *
 * The domain only ever comes from the panel's projection (`domains.json`,
 * resolved from the host by the authorization routes), never from the
 * request, and is checked to be a domain name before it becomes a path
 * component. The file is read through the link by design, capped at
 * {@link BRAND_FILE_MAX_BYTES}, parsed with core's `BrandJsonSchema` — the
 * same rules the record was validated with — and must name the domain it
 * was read for. **Fail open**: a missing, unreadable or invalid file means
 * the stock page (`null`), never a refusal of the request and never a
 * page with part of a brand. Each domain's answer is kept for a short
 * while ({@link BRAND_CACHE_TTL_MS}) so a change shows within seconds
 * without a read per refusal; a transition — a brand appearing, going, or
 * turning unreadable — is logged once, with the domain and the reason,
 * never with the file's content.
 *
 * What the pages get ({@link PageBrand}) is derived here: the logo's URL
 * is `https://auth.<domain>/static/media/logo.png`, the one origin a page
 * may load from — a host under one of this relay's domains, as the
 * sign-out link — and only when the brand serves a logo.
 */

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import {
  AUTH_BRANDING_FILES,
  AUTH_BRANDING_WEB_ROOT,
  BrandJsonSchema,
  assertDomainName,
} from '@lamalibre/lamaste';
import type { BrandJson } from '@lamalibre/lamaste';
import type { PageBrand } from './types.js';

/** A `brand.json` larger than this is not one of ours (the panel's are under 1 KiB). */
export const BRAND_FILE_MAX_BYTES = 64 * 1024;

/** How long a domain's answer — a brand or none — is kept before the file is read again. */
export const BRAND_CACHE_TTL_MS = 5_000;

/** What the reader logs: Fastify's logger, or a stand-in. */
export interface BrandReaderLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface BrandReaderOptions {
  /** The web root the renderings live under (default `/var/www/lamaste/auth`). */
  readonly root?: string | undefined;
  readonly ttlMs?: number | undefined;
  readonly logger?: BrandReaderLogger | undefined;
  /** The clock (tests). */
  readonly now?: (() => number) | undefined;
}

export interface BrandReader {
  /**
   * The brand of `domain` for the pages, or null for the stock page:
   * `domain` has no rendering, or its `brand.json` cannot be read or is
   * not one of ours. Never throws.
   */
  readDomainBrand(domain: string): Promise<PageBrand | null>;
  /** Forget every cached answer (tests). */
  reset(): void;
}

/** What one read found — the states a transition is logged between. */
type ReadState = 'branded' | 'unbranded' | 'invalid';

interface ReadOutcome {
  readonly state: ReadState;
  readonly brand: PageBrand | null;
  /** Why the file was not taken (for the log), when it was not. */
  readonly reason?: string;
}

interface CacheEntry {
  readonly outcome: ReadOutcome;
  readonly expiresAt: number;
}

/** The URL of a domain's logo on its sign-in host — the one origin the pages load from. */
export function brandLogoUrl(domain: string): string {
  return `https://auth.${domain}/${AUTH_BRANDING_FILES.logo}`;
}

/** The brand of a page from a parsed `brand.json`. */
export function pageBrandOf(brand: BrandJson): PageBrand {
  return {
    name: brand.name,
    tagline: brand.tagline,
    accent: brand.accent,
    logoUrl: brand.logo === null ? null : brandLogoUrl(brand.domain),
    supportEmail: brand.supportEmail,
    supportUrl: brand.supportUrl,
  };
}

/**
 * Read `brand.json` of `domain` under `root` once: the file through the
 * domain's link, at most {@link BRAND_FILE_MAX_BYTES}, parsed and
 * checked. Never throws.
 */
export async function readBrandFile(domain: string, root: string): Promise<ReadOutcome> {
  const file = path.join(root, domain, AUTH_BRANDING_FILES.brand);
  let text: string;
  try {
    const fh = await open(file, constants.O_RDONLY);
    try {
      const stat = await fh.stat();
      if (!stat.isFile()) return { state: 'invalid', brand: null, reason: 'not_a_file' };
      if (stat.size > BRAND_FILE_MAX_BYTES) {
        return { state: 'invalid', brand: null, reason: 'too_large' };
      }
      // Read a byte more than allowed: a file that grew past the stat is
      // refused too, never cut and parsed.
      const buffer = Buffer.alloc(BRAND_FILE_MAX_BYTES + 1);
      const { bytesRead } = await fh.read(buffer, 0, buffer.length, 0);
      if (bytesRead > BRAND_FILE_MAX_BYTES) {
        return { state: 'invalid', brand: null, reason: 'too_large' };
      }
      text = buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'unbranded', brand: null };
    return { state: 'invalid', brand: null, reason: code ?? 'unreadable' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { state: 'invalid', brand: null, reason: 'not_json' };
  }
  const result = BrandJsonSchema.safeParse(parsed);
  if (!result.success) return { state: 'invalid', brand: null, reason: 'not_a_brand' };
  if (result.data.domain !== domain) {
    return { state: 'invalid', brand: null, reason: 'another_domain' };
  }
  return { state: 'branded', brand: pageBrandOf(result.data) };
}

/**
 * A reader of the domains' brands for the pages, with its cache and its
 * transition log.
 */
export function createBrandReader({
  root = AUTH_BRANDING_WEB_ROOT,
  ttlMs = BRAND_CACHE_TTL_MS,
  logger,
  now = Date.now,
}: BrandReaderOptions = {}): BrandReader {
  const cache = new Map<string, CacheEntry>();
  const lastState = new Map<string, ReadState>();

  const logTransition = (domain: string, outcome: ReadOutcome): void => {
    const previous = lastState.get(domain);
    if (previous === outcome.state) return;
    lastState.set(domain, outcome.state);
    if (!logger) return;
    if (outcome.state === 'invalid') {
      logger.warn(
        { domain, reason: outcome.reason ?? 'invalid' },
        'Domain brand unreadable: the stock pages are served',
      );
    } else if (outcome.state === 'branded') {
      logger.info({ domain }, 'Domain brand read: the pages carry it');
    } else if (previous !== undefined) {
      // Only a brand that went (an unbranded domain is the usual case).
      logger.debug({ domain }, 'Domain brand gone: the stock pages are served');
    }
  };

  return {
    async readDomainBrand(domain: string): Promise<PageBrand | null> {
      try {
        assertDomainName(domain);
      } catch {
        return null;
      }
      const cached = cache.get(domain);
      const at = now();
      if (cached && cached.expiresAt > at) return cached.outcome.brand;
      const outcome = await readBrandFile(domain, root);
      cache.set(domain, { outcome, expiresAt: at + ttlMs });
      logTransition(domain, outcome);
      return outcome.brand;
    },
    reset(): void {
      cache.clear();
      lastState.clear();
    },
  };
}
