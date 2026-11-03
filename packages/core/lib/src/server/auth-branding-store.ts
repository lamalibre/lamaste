/**
 * The rendered brands and languages on the relay
 * (packages/core/docs/auth-branding-design.md, page-language-design.md §5):
 * one entry per domain with a brand or a page language under
 * {@link AUTH_BRANDING_WEB_ROOT}, holding what nginx serves on
 * `auth.<domain>` for the routes Authelia lets a file override, the
 * generated stylesheet, Lamaste's own pages in the domain's language and
 * `brand.json`. The domain's records in `state.db` are the source of truth;
 * a rendering is a projection of them, rebuilt at every change and
 * reconciled at start (`rendered.json` says which revision, language and
 * Authelia release it came from).
 *
 * The layout is the web-tree store's: each rendering is a directory of its
 * own under `<root>/.renders/<domain>-<revision>-<hex>/` (files 0640,
 * directories 0750, every file fsynced), and `<root>/<domain>` is a
 * **symbolic link** to the one that serves. A new rendering is written
 * beside the old one, then the link is replaced with a rename — one atomic
 * switch, so nginx and Gatekeeper see the old rendering or the new one,
 * never none and never a mix — and the previous directory goes afterwards
 * (renamed aside first; nothing is ever deleted through the served path).
 * Nothing is written through an existing path either: files are created
 * exclusively, and `rendered.json` is read without following a link on
 * the file itself (the directory link is a path component, which
 * `O_NOFOLLOW` does not refuse).
 *
 * nginx's `root /var/www/lamaste/auth/<domain>` resolves the link on every
 * open: `disable_symlinks` is `off` by default, and the vhost that serves
 * the rendering must leave it so.
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
import { lstat, mkdir, open, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';

import {
  AUTHELIA_LOCALE_NAMESPACE_RE,
  AUTHELIA_LOCALE_RE,
  AUTH_BRANDING_FILES,
  AUTH_BRANDING_WEB_ROOT,
  authBrandingLocaleFile,
  renderBrandJson,
  renderBrandLocale,
  renderDomainCss,
} from '../auth-branding.js';
import type { BrandFields, RenderedBrand } from '../auth-branding.js';
import {
  AUTHELIA_FORCED_NAMESPACES,
  AUTHELIA_LOCALE_OF_LANGUAGE,
  forcedAutheliaLocaleFile,
  renderForcedAutheliaLocale,
} from '../authelia-locales.js';
import { AUTHELIA_RELEASE } from '../constants.js';
import { assertDomainName } from '../domains.js';
import { PAGE_LANGUAGES, isPageLanguage } from '../page-messages.js';
import type { PageLanguage } from '../page-messages.js';
import { renderInvitePage } from './invite-page.js';
import { renderInvitationsPage } from './invitations-page.js';
import { renderUnavailablePage } from './unavailable-page.js';

const DIR_MODE = 0o750;
const FILE_MODE = 0o640;
/** Where the renderings live under the root; the domain entries beside it link into it. */
export const AUTH_BRANDING_RENDERS_DIR = '.renders';
/** A rendering's directory name: `<domain>-<revision>-<16 hex>`. */
const RENDER_DIR_RE = /^(.+)-(\d+)-([a-f0-9]{16})$/;
/** Temporary links and outgoing entries: dot-prefixed, never a domain name. */
const LINK_PREFIX = '.link-';
const OUTGOING_PREFIX = '.outgoing-';

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/**
 * The served entry of `domain` under `root` — a link to its rendering —
 * through which its files are read. Throws on anything but a domain name.
 */
export function authBrandingDir(domain: string, root: string = AUTH_BRANDING_WEB_ROOT): string {
  assertDomainName(domain);
  return path.join(root, domain);
}

/** The name of a rendering's directory, or null for a name that is not one. */
function parseRenderDirName(name: string): { domain: string; revision: number } | null {
  const match = RENDER_DIR_RE.exec(name);
  if (!match) return null;
  const domain = match[1] ?? '';
  try {
    assertDomainName(domain);
  } catch {
    return null;
  }
  return { domain, revision: Number(match[2]) };
}

/**
 * What the entry of `domain` links to — the name of a rendering directory
 * under `.renders/` — or null when the entry is absent, not a link, or a
 * link to anything else (never followed).
 */
async function linkedRender(domain: string, root: string): Promise<string | null> {
  let target: string;
  try {
    target = await readlink(authBrandingDir(domain, root));
  } catch {
    return null;
  }
  const prefix = `${AUTH_BRANDING_RENDERS_DIR}/`;
  if (!target.startsWith(prefix)) return null;
  const name = target.slice(prefix.length);
  if (name.includes('/') || parseRenderDirName(name)?.domain !== domain) return null;
  return name;
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

/**
 * Authelia's locales: the languages it lists, every file of theirs it
 * serves, and the files it lists but does not serve (`missing`) — 4.39.28
 * lists `srp` with three namespaces and answers 404 to each
 * (`/locales/srp/*.json`); the portal never gets those from Authelia
 * either, so a rendering leaves them out rather than failing.
 */
export interface AutheliaLocales {
  readonly languages: ReadonlyArray<{
    readonly locale: string;
    readonly namespaces: readonly string[];
  }>;
  readonly files: readonly AutheliaLocaleFile[];
  readonly missing: ReadonlyArray<{ readonly locale: string; readonly namespace: string }>;
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
 * an override file replaces the whole language. A listed file Authelia
 * answers 404 to is reported in `missing`, not fetched: nothing of
 * Authelia's is lost by not overriding what it does not serve.
 */
export async function fetchAutheliaLocales({
  fetchImpl = globalThis.fetch as unknown as FetchLike,
  baseUrl = AUTHELIA_LOCAL_URL,
  timeoutMs = 10_000,
}: FetchAutheliaLocalesOptions = {}): Promise<AutheliaLocales> {
  const get = async (route: string, { absent = false } = {}): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (absent && response.status === 404) return undefined;
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
  const missing: Array<{ locale: string; namespace: string }> = [];
  for (const { locale, namespaces } of languages) {
    for (const namespace of namespaces) {
      const messages = await get(`/locales/${locale}/${namespace}.json`, { absent: true });
      if (messages === undefined) {
        missing.push({ locale, namespace });
        continue;
      }
      if (messages === null || typeof messages !== 'object' || Array.isArray(messages)) {
        throw new Error(`Authelia's ${locale}/${namespace} locale is not an object`);
      }
      files.push({ locale, namespace, messages: messages as Record<string, unknown> });
    }
  }
  if (files.length === 0) throw new Error('Authelia served none of the locale files it lists');
  return { languages, files, missing };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** What a rendering is made from: a brand, a language, or both. */
export interface AuthBrandingRenderInput {
  readonly domain: string;
  /** The domain's brand, or null for a rendering of its language alone. */
  readonly brand: BrandFields | null;
  /** The domain's page language, or null/absent for a rendering of its brand alone (as 4.8). */
  readonly language?: PageLanguage | null;
  /** The brand record's revision; 0 without a brand. */
  readonly revision: number;
  /** The logo's PNG bytes, when set. */
  readonly logo: Uint8Array | null;
  /** The favicon's bytes (ICO or PNG), when set. */
  readonly favicon: Uint8Array | null;
  readonly locales: AutheliaLocales;
  /** The Authelia release the locales came from — the running one (recorded in `rendered.json`). */
  readonly autheliaVersion: string;
  readonly root?: string;
  readonly now?: Date;
}

/**
 * The digest of this release's auth pages, whatever the brand, in every
 * language: nginx sends their CSP hashes, so a domain's rendering must hold
 * exactly these pages, and a catalogue change re-renders every domain once.
 * The stock pages stand for every brand: only their markup differs.
 */
export function authPagesDigest(): string {
  const pages = PAGE_LANGUAGES.flatMap((language) => [
    renderInvitePage(null, language),
    renderInvitationsPage(null, language),
    renderUnavailablePage({ brand: null, language, domain: null }),
  ]);
  return sha256Hex(Buffer.from(pages.join('\n')));
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

/** What {@link renderAuthBranding} rendered: `rendered.json`, and what it could not translate. */
export interface AuthBrandingRendering extends RenderedBrand {
  /**
   * The keys (`<namespace>:<dotted path>`) of the forced Authelia files no
   * text of the domain's language covers, filled from Authelia's English —
   * empty for the pinned release; the keys a newer running Authelia added.
   */
  readonly fromEnglish: readonly string[];
}

/**
 * Render a domain's brand and/or language under `root`:
 *
 * - with a brand: the favicon and logo when set, `brand.json`;
 * - with a brand and no language: every Authelia locale file with the brand
 *   name spliced in (`locales/<locale>/<namespace>.json`, as 4.8);
 * - with a language: one forced file per namespace the portal loads
 *   (`locales/forced/<namespace>.json`, {@link renderForcedAutheliaLocale}),
 *   brand-spliced when branded — the auth vhost answers every locale path
 *   with it;
 * - always: `brand.css` ({@link renderDomainCss}), the domain's invitation
 *   page, inviter's page and "not available" page in its language
 *   (English without one) and `rendered.json`
 *
 * — into a directory of its own under `.renders/`, then served by
 * replacing the domain's link in one rename. The rendering it replaces is
 * removed afterwards. Returns what `rendered.json` says, with the keys left
 * in English.
 */
export async function renderAuthBranding(
  input: AuthBrandingRenderInput,
): Promise<AuthBrandingRendering> {
  const root = input.root ?? AUTH_BRANDING_WEB_ROOT;
  const link = authBrandingDir(input.domain, root);
  const { brand } = input;
  const language = input.language ?? null;
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new Error('A rendering has a non-negative integer revision');
  }
  if (language !== null && !isPageLanguage(language)) {
    throw new Error('A rendering’s language is a page language');
  }
  if (brand === null) {
    if (language === null) throw new Error('A rendering has a brand or a language');
    if (input.revision !== 0 || input.logo !== null || input.favicon !== null) {
      throw new Error('A rendering without a brand has revision 0, no logo and no favicon');
    }
  }
  const forced: Array<{ relative: string; messages: Record<string, unknown> }> = [];
  const fromEnglish: string[] = [];
  if (language !== null) {
    const fileOf = (locale: string, namespace: string): AutheliaLocaleFile | undefined =>
      input.locales.files.find((f) => f.locale === locale && f.namespace === namespace);
    for (const namespace of AUTHELIA_FORCED_NAMESPACES) {
      const english = fileOf('en', namespace);
      // Without Authelia's English there is nothing to force: the vhost's
      // fallback then lets Authelia answer that namespace itself.
      if (english === undefined) continue;
      const result = renderForcedAutheliaLocale({
        namespace,
        language,
        english: english.messages,
        embedded: fileOf(AUTHELIA_LOCALE_OF_LANGUAGE[language], namespace)?.messages ?? null,
      });
      fromEnglish.push(...result.fromEnglish.map((key) => `${namespace}:${key}`));
      forced.push({
        relative: forcedAutheliaLocaleFile(namespace),
        messages: brand === null ? result.messages : renderBrandLocale(result.messages, brand.name),
      });
    }
  }
  const rendersDir = path.join(root, AUTH_BRANDING_RENDERS_DIR);
  await mkdir(rendersDir, { recursive: true, mode: DIR_MODE });
  const name = `${input.domain}-${input.revision}-${crypto.randomBytes(8).toString('hex')}`;
  const dir = path.join(rendersDir, name);
  await mkdir(dir, { mode: DIR_MODE });
  const rendered: RenderedBrand = {
    v: 1,
    revision: input.revision,
    language,
    autheliaVersion: input.autheliaVersion,
    autheliaPinned: AUTHELIA_RELEASE.version,
    pagesDigest: authPagesDigest(),
    renderedAt: (input.now ?? new Date()).toISOString(),
  };
  const json = (value: unknown, indent: string | number): string =>
    `${JSON.stringify(value, null, indent)}\n`;
  try {
    if (input.favicon)
      await writeNewFile(path.join(dir, AUTH_BRANDING_FILES.favicon), input.favicon);
    if (input.logo) await writeNewFile(path.join(dir, AUTH_BRANDING_FILES.logo), input.logo);
    if (brand !== null && language === null) {
      for (const file of input.locales.files) {
        const relative = authBrandingLocaleFile(file.locale, file.namespace);
        const messages = renderBrandLocale(file.messages, brand.name);
        await writeNewFile(path.join(dir, relative), json(messages, '\t'));
      }
    }
    for (const file of forced) {
      await writeNewFile(path.join(dir, file.relative), json(file.messages, '\t'));
    }
    await writeNewFile(path.join(dir, AUTH_BRANDING_FILES.css), renderDomainCss(brand, language));
    const pageBrand =
      brand === null
        ? null
        : {
            name: brand.name,
            tagline: brand.tagline,
            theme: brand.theme,
            accent: brand.accent,
            logo: input.logo !== null,
          };
    const pageLanguage = language ?? 'en';
    await writeNewFile(
      path.join(dir, AUTH_BRANDING_FILES.invite),
      renderInvitePage(pageBrand, pageLanguage),
    );
    await writeNewFile(
      path.join(dir, AUTH_BRANDING_FILES.invitations),
      renderInvitationsPage(pageBrand, pageLanguage),
    );
    await writeNewFile(
      path.join(dir, AUTH_BRANDING_FILES.unavailable),
      renderUnavailablePage({ brand: pageBrand, language: pageLanguage, domain: input.domain }),
    );
    if (brand !== null) {
      const brandJson = renderBrandJson(input.domain, brand, input.revision, {
        logoSha256: input.logo ? sha256Hex(input.logo) : null,
        faviconSha256: input.favicon ? sha256Hex(input.favicon) : null,
      });
      await writeNewFile(path.join(dir, AUTH_BRANDING_FILES.brand), json(brandJson, 2));
    }
    await writeNewFile(path.join(dir, AUTH_BRANDING_FILES.rendered), json(rendered, 2));
    await syncDir(dir);
    const previous = await linkedRender(input.domain, root);
    await switchLink(link, `${AUTH_BRANDING_RENDERS_DIR}/${name}`);
    if (previous !== null && previous !== name) {
      await removeAside(path.join(rendersDir, previous));
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await syncDir(root);
  return { ...rendered, fromEnglish };
}

/**
 * Make `link` a symbolic link to `target` in one atomic step: the link is
 * created under a temporary name beside it and renamed over whatever is
 * at `link`. A plain directory or file there (never a rendering of ours)
 * is renamed aside first and removed afterwards — never followed.
 */
async function switchLink(link: string, target: string): Promise<void> {
  const parent = path.dirname(link);
  const temp = path.join(parent, `${LINK_PREFIX}${crypto.randomBytes(8).toString('hex')}`);
  await symlink(target, temp);
  try {
    const current = await lstat(link).catch(() => null);
    let aside: string | null = null;
    if (current && !current.isSymbolicLink()) {
      aside = path.join(parent, `${OUTGOING_PREFIX}${crypto.randomBytes(8).toString('hex')}`);
      await rename(link, aside);
    }
    try {
      await rename(temp, link);
    } catch (err) {
      if (aside) await rename(aside, link).catch(() => undefined);
      throw err;
    }
    if (aside) await rm(aside, { recursive: true, force: true }).catch(() => undefined);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Remove `entry` (a directory, a link or a file): renamed aside beside itself, then removed. */
async function removeAside(entry: string): Promise<void> {
  const aside = path.join(
    path.dirname(entry),
    `${OUTGOING_PREFIX}${crypto.randomBytes(8).toString('hex')}`,
  );
  try {
    await rename(entry, aside);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return;
    throw err;
  }
  await rm(aside, { recursive: true, force: true });
}

/**
 * What `rendered.json` of `domain` says — read through the domain's link,
 * the file itself opened without following a link — or null when there
 * is no rendering, it cannot be read or it is not one of ours: a
 * reconcile renders then.
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
        // Absent (a rendering from before 4.10) or not one of ours: none.
        language: isPageLanguage(parsed.language) ? parsed.language : null,
        autheliaVersion: parsed.autheliaVersion,
        autheliaPinned: typeof parsed.autheliaPinned === 'string' ? parsed.autheliaPinned : null,
        pagesDigest: typeof parsed.pagesDigest === 'string' ? parsed.pagesDigest : null,
        renderedAt: parsed.renderedAt,
      };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/**
 * Remove the rendering of `domain` (back to the stock page): its link, then
 * the rendering it served; a plain directory or a link elsewhere at its
 * entry is removed and never followed. Idempotent.
 */
export async function removeAuthBranding(
  domain: string,
  root: string = AUTH_BRANDING_WEB_ROOT,
): Promise<boolean> {
  const link = authBrandingDir(domain, root);
  const current = await lstat(link).catch(() => null);
  if (!current) return false;
  const served = await linkedRender(domain, root);
  await removeAside(link);
  if (served !== null) await removeAside(path.join(root, AUTH_BRANDING_RENDERS_DIR, served));
  await syncDir(root);
  return true;
}

/**
 * The domains with a rendering under `root` — an entry that is a link to
 * a rendering directory of theirs under `.renders/` — sorted. Everything
 * a crash left behind is removed on the way: temporary links and outgoing
 * entries, and every rendering directory no domain's entry links to. An
 * empty root lists nothing.
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
  const linked = new Set<string>();
  for (const name of names) {
    if (name.startsWith(LINK_PREFIX) || name.startsWith(OUTGOING_PREFIX)) {
      await rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined);
      continue;
    }
    try {
      assertDomainName(name);
    } catch {
      continue;
    }
    const render = await linkedRender(name, root);
    if (render === null) continue;
    const st = await lstat(path.join(root, AUTH_BRANDING_RENDERS_DIR, render)).catch(() => null);
    if (!st?.isDirectory()) continue;
    linked.add(render);
    domains.push(name);
  }
  const rendersDir = path.join(root, AUTH_BRANDING_RENDERS_DIR);
  for (const name of await readdir(rendersDir).catch(() => [] as string[])) {
    if (linked.has(name)) continue;
    await rm(path.join(rendersDir, name), { recursive: true, force: true }).catch(() => undefined);
  }
  return domains.sort();
}
