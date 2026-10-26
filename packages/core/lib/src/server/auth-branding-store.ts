/**
 * The rendered brands on the relay (packages/core/docs/auth-branding-design.md):
 * one directory per domain under {@link AUTH_BRANDING_WEB_ROOT}, holding
 * what nginx serves on `auth.<domain>` for the routes Authelia lets a file
 * override, the generated stylesheet and `brand.json`. The brand record in
 * `state.db` is the source of truth; a directory is a **rendering** of it,
 * rebuilt at every change and reconciled at start (`rendered.json` says
 * which revision and Authelia release it came from).
 *
 * A rendering is written into a fresh sibling directory (files 0640,
 * directories 0750, every file fsynced), then moved into place: the
 * directory it replaces is renamed aside first and removed afterwards, so
 * nginx sees the old rendering or the new one — never a mix — apart from
 * a moment with none, when `try_files` falls through to Authelia's stock
 * asset. Nothing is ever written through an existing path: targets are
 * created exclusively, and reads never follow a link.
 *
 * The web root belongs to the lamaste user with group www-data (see
 * `files.ts`): nginx reads through the group, nobody else can.
 *
 * The locale files come from Authelia itself ({@link fetchAutheliaLocales}:
 * its language list and each embedded file), so a pin bump brings the new
 * release's strings at the next rendering.
 */

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  AUTHELIA_LOCALE_NAMESPACE_RE,
  AUTHELIA_LOCALE_RE,
  AUTH_BRANDING_FILES,
  AUTH_BRANDING_WEB_ROOT,
  authBrandingLocaleFile,
  renderBrandCss,
  renderBrandJson,
  renderBrandLocale,
} from '../auth-branding.js';
import type { BrandFields, RenderedBrand } from '../auth-branding.js';
import { assertDomainName } from '../domains.js';

const DIR_MODE = 0o750;
const FILE_MODE = 0o640;
/** Staging and outgoing directories: dot-prefixed, never a domain name. */
const STAGING_PREFIX = '.staging-';
const OUTGOING_PREFIX = '.outgoing-';

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/** The rendered directory of `domain` under `root`. Throws on anything but a domain name. */
export function authBrandingDir(domain: string, root: string = AUTH_BRANDING_WEB_ROOT): string {
  assertDomainName(domain);
  return path.join(root, domain);
}

// ---------------------------------------------------------------------------
// Authelia's locales
// ---------------------------------------------------------------------------

/** Where Authelia listens on the relay. */
export const AUTHELIA_LOCAL_URL = 'http://127.0.0.1:9091';

/** At most this many languages are rendered (Authelia 4.39.28 lists about 60, parents included). */
export const AUTHELIA_LOCALES_MAX_LANGUAGES = 128;
/** At most this many namespaces per language (4.39.28: `consent`, `portal`, `settings`). */
export const AUTHELIA_LOCALES_MAX_NAMESPACES = 8;
/** A locale file larger than this is refused (4.39.28's are under 16 KiB). */
export const AUTHELIA_LOCALE_FILE_MAX_BYTES = 1024 * 1024;

/** One of Authelia's embedded locale files. */
export interface AutheliaLocaleFile {
  readonly locale: string;
  readonly namespace: string;
  readonly messages: Record<string, unknown>;
}

/** Authelia's locales: the languages it lists and every file of theirs. */
export interface AutheliaLocales {
  readonly languages: ReadonlyArray<{
    readonly locale: string;
    readonly namespaces: readonly string[];
  }>;
  readonly files: readonly AutheliaLocaleFile[];
}

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface FetchAutheliaLocalesOptions {
  readonly fetchImpl?: FetchLike;
  /** Authelia's base URL (default {@link AUTHELIA_LOCAL_URL}). */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/**
 * The shape of `GET /locales` in Authelia 4.39.28 (`internal/server/asset.go`
 * `newLocalesListHandler`, `internal/utils/locale.go` `getLanguages`):
 * `{ status: "OK", data: { defaults: { language, namespace }, namespaces,
 * languages: [{ display, locale, namespaces?, fallbacks?, parent }] } }`.
 * The list holds every embedded directory (`en`, `tr-TR`, `zh-CN`, `srp`,
 * …) **and** each one's parent (`tr`, `zh`) as a language of its own, so
 * rendering every listed locale covers every path the portal requests.
 * `namespaces` is omitted when empty; `data.namespaces` stands in then.
 */
export function parseAutheliaLocalesList(
  body: unknown,
): ReadonlyArray<{ locale: string; namespaces: string[] }> {
  const answer = body as { status?: unknown; data?: unknown } | null;
  if (!answer || answer.status !== 'OK' || !answer.data || typeof answer.data !== 'object') {
    throw new Error('Authelia did not answer its locale list');
  }
  const data = answer.data as { namespaces?: unknown; languages?: unknown };
  const allNamespaces = namespaceList(data.namespaces);
  if (!Array.isArray(data.languages) || data.languages.length === 0) {
    throw new Error('Authelia listed no languages');
  }
  if (data.languages.length > AUTHELIA_LOCALES_MAX_LANGUAGES) {
    throw new Error('Authelia listed more languages than are rendered');
  }
  const seen = new Set<string>();
  const languages: Array<{ locale: string; namespaces: string[] }> = [];
  for (const entry of data.languages as unknown[]) {
    const language = (entry ?? {}) as { locale?: unknown; namespaces?: unknown };
    const locale = language.locale;
    if (typeof locale !== 'string' || !AUTHELIA_LOCALE_RE.test(locale)) {
      throw new Error('Authelia listed a locale it does not route');
    }
    if (seen.has(locale)) continue;
    seen.add(locale);
    const namespaces =
      language.namespaces === undefined ? allNamespaces : namespaceList(language.namespaces);
    if (namespaces.length === 0) throw new Error(`Authelia lists no namespace for ${locale}`);
    languages.push({ locale, namespaces });
  }
  return languages;
}

function namespaceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > AUTHELIA_LOCALES_MAX_NAMESPACES) {
    throw new Error('Authelia listed more namespaces than are rendered');
  }
  return value.map((ns) => {
    if (typeof ns !== 'string' || !AUTHELIA_LOCALE_NAMESPACE_RE.test(ns)) {
      throw new Error('Authelia listed a namespace it does not route');
    }
    return ns;
  });
}

/**
 * Authelia's language list and every locale file of every language it
 * lists, from the running Authelia on the relay. Throws when it does not
 * answer or answers something else: a rendering needs all of them, since
 * an override file replaces the whole language.
 */
export async function fetchAutheliaLocales({
  fetchImpl = globalThis.fetch as unknown as FetchLike,
  baseUrl = AUTHELIA_LOCAL_URL,
  timeoutMs = 10_000,
}: FetchAutheliaLocalesOptions = {}): Promise<AutheliaLocales> {
  const get = async (route: string): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Authelia answered ${response.status} to GET ${route}`);
    const text = await response.text();
    if (text.length > AUTHELIA_LOCALE_FILE_MAX_BYTES) {
      throw new Error(`Authelia's answer to GET ${route} is larger than rendered`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Authelia's answer to GET ${route} is not JSON`);
    }
  };
  const languages = parseAutheliaLocalesList(await get('/locales'));
  const files: AutheliaLocaleFile[] = [];
  for (const { locale, namespaces } of languages) {
    for (const namespace of namespaces) {
      const messages = await get(`/locales/${locale}/${namespace}.json`);
      if (messages === null || typeof messages !== 'object' || Array.isArray(messages)) {
        throw new Error(`Authelia's ${locale}/${namespace} locale is not an object`);
      }
      files.push({ locale, namespace, messages: messages as Record<string, unknown> });
    }
  }
  return { languages, files };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** What a rendering is made from. */
export interface AuthBrandingRenderInput {
  readonly domain: string;
  readonly brand: BrandFields;
  readonly revision: number;
  /** The logo's PNG bytes, when set. */
  readonly logo: Uint8Array | null;
  /** The favicon's bytes (ICO or PNG), when set. */
  readonly favicon: Uint8Array | null;
  readonly locales: AutheliaLocales;
  /** The Authelia release the locales came from (recorded in `rendered.json`). */
  readonly autheliaVersion: string;
  readonly root?: string;
  readonly now?: Date;
}

/** Write `content` to a new 0640 file at `to` (exclusively), fsynced. */
async function writeNewFile(to: string, content: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true, mode: DIR_MODE });
  const fh = await open(to, 'wx', FILE_MODE);
  try {
    await fh.writeFile(content);
    await fh.chmod(FILE_MODE);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** fsync a directory, so the entries renamed into it survive a crash. */
async function syncDir(dir: string): Promise<void> {
  const fh = await open(dir, 'r');
  try {
    await fh.sync();
  } catch (err) {
    const code = errnoCode(err);
    if (code !== 'EISDIR' && code !== 'EPERM' && code !== 'EINVAL' && code !== 'ENOTSUP') throw err;
  } finally {
    await fh.close();
  }
}

/** SHA-256 of `bytes`, lower-case hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Render a domain's brand under `root`: the favicon and logo when set,
 * every locale file with the brand name spliced in, `brand.css`,
 * `brand.json` and `rendered.json` — in a fresh directory, then moved
 * into place. Returns what `rendered.json` says.
 */
export async function renderAuthBranding(input: AuthBrandingRenderInput): Promise<RenderedBrand> {
  const root = input.root ?? AUTH_BRANDING_WEB_ROOT;
  const target = authBrandingDir(input.domain, root);
  await mkdir(root, { recursive: true, mode: DIR_MODE });
  const staging = path.join(root, `${STAGING_PREFIX}${crypto.randomBytes(8).toString('hex')}`);
  await mkdir(staging, { mode: DIR_MODE });
  const rendered: RenderedBrand = {
    v: 1,
    revision: input.revision,
    autheliaVersion: input.autheliaVersion,
    renderedAt: (input.now ?? new Date()).toISOString(),
  };
  try {
    if (input.favicon)
      await writeNewFile(path.join(staging, AUTH_BRANDING_FILES.favicon), input.favicon);
    if (input.logo) await writeNewFile(path.join(staging, AUTH_BRANDING_FILES.logo), input.logo);
    for (const file of input.locales.files) {
      const relative = authBrandingLocaleFile(file.locale, file.namespace);
      const messages = renderBrandLocale(file.messages, input.brand.name);
      await writeNewFile(path.join(staging, relative), `${JSON.stringify(messages, null, '\t')}\n`);
    }
    await writeNewFile(path.join(staging, AUTH_BRANDING_FILES.css), renderBrandCss(input.brand));
    const brandJson = renderBrandJson(input.domain, input.brand, input.revision, {
      logoSha256: input.logo ? sha256Hex(input.logo) : null,
      faviconSha256: input.favicon ? sha256Hex(input.favicon) : null,
    });
    await writeNewFile(
      path.join(staging, AUTH_BRANDING_FILES.brand),
      `${JSON.stringify(brandJson, null, 2)}\n`,
    );
    await writeNewFile(
      path.join(staging, AUTH_BRANDING_FILES.rendered),
      `${JSON.stringify(rendered, null, 2)}\n`,
    );
    await replaceDirectory(target, staging);
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await syncDir(root);
  return rendered;
}

/**
 * Put `staging` at `target`: whatever is at `target` — a directory of an
 * earlier rendering, or anything else — is renamed aside first (never
 * removed through its path) and removed afterwards.
 */
async function replaceDirectory(target: string, staging: string): Promise<void> {
  const outgoing = `${path.dirname(target)}/${OUTGOING_PREFIX}${crypto.randomBytes(8).toString('hex')}`;
  let moved = false;
  try {
    await rename(target, outgoing);
    moved = true;
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') throw err;
  }
  try {
    await rename(staging, target);
  } catch (err) {
    if (moved) await rename(outgoing, target).catch(() => undefined);
    throw err;
  }
  if (moved) await rm(outgoing, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * What `rendered.json` of `domain` says, or null when there is no
 * rendering, it cannot be read (a link, not a file) or it is not one of
 * ours — a reconcile renders then.
 */
export async function readRenderedBrand(
  domain: string,
  root: string = AUTH_BRANDING_WEB_ROOT,
): Promise<RenderedBrand | null> {
  const file = path.join(authBrandingDir(domain, root), AUTH_BRANDING_FILES.rendered);
  let text: string;
  try {
    const fh = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await fh.stat()).isFile()) return null;
      text = await fh.readFile('utf-8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<RenderedBrand> | null;
    if (
      parsed &&
      parsed.v === 1 &&
      Number.isInteger(parsed.revision) &&
      typeof parsed.autheliaVersion === 'string' &&
      typeof parsed.renderedAt === 'string'
    ) {
      return {
        v: 1,
        revision: parsed.revision as number,
        autheliaVersion: parsed.autheliaVersion,
        renderedAt: parsed.renderedAt,
      };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/** Remove the rendering of `domain` (back to the stock page). Idempotent. */
export async function removeAuthBranding(
  domain: string,
  root: string = AUTH_BRANDING_WEB_ROOT,
): Promise<boolean> {
  const dir = authBrandingDir(domain, root);
  const existed = await lstat(dir)
    .then(() => true)
    .catch(() => false);
  if (!existed) return false;
  // Renamed aside, then removed: nothing is deleted through the served path.
  const outgoing = `${root}/${OUTGOING_PREFIX}${crypto.randomBytes(8).toString('hex')}`;
  await rename(dir, outgoing);
  await rm(outgoing, { recursive: true, force: true });
  await syncDir(root);
  return true;
}

/**
 * The domains with a rendering under `root` (directories named like a
 * domain), and a staging or outgoing directory a crash left behind
 * removed. An empty root lists nothing.
 */
export async function listRenderedBrands(root: string = AUTH_BRANDING_WEB_ROOT): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return [];
    throw err;
  }
  const domains: string[] = [];
  for (const name of names) {
    if (name.startsWith(STAGING_PREFIX) || name.startsWith(OUTGOING_PREFIX)) {
      await rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined);
      continue;
    }
    try {
      assertDomainName(name);
    } catch {
      continue;
    }
    const st = await lstat(path.join(root, name)).catch(() => null);
    if (st?.isDirectory()) domains.push(name);
  }
  return domains.sort();
}
