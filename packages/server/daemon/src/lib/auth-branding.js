/**
 * A domain's brand on its auth pages (packages/core/docs/auth-branding-design.md):
 * the record in `state.db` (`domain_branding`, migration 0019) and its
 * rendering under `/var/www/lamaste/auth/<domain>/`, which nginx serves on
 * `auth.<domain>` for the routes Authelia lets a file override.
 *
 * **The domain's language** (packages/core/docs/page-language-design.md,
 * `domains.language`, migration 0021, set by lib/domains.js
 * `setDomainLanguage`) is the rendering's other input: a domain has a
 * rendering when it has a brand **or** a language — the forced Authelia
 * locale files, Lamaste's pages in its language, the stylesheet hiding
 * Authelia's language menu — and its auth vhost says both
 * ({@link authVhostInputs}). A language change renders and rewrites the
 * vhost ({@link applyDomainLanguage}); it never touches Authelia's
 * configuration.
 *
 * **The running Authelia.** The locale files come from the Authelia that
 * runs, which may be newer than the pinned release (create-lamaste never
 * downgrades it), so its version is read from its binary and recorded in
 * each rendering; a change re-renders. One that differs from the pin is
 * audited (`authelia.version.unpinned`) and raised to the administrators
 * once per version — the domains are still rendered: the forcing's
 * contracts are pinned for the pinned release only, and a newer one
 * degrades to a mix of languages, never to a broken page.
 *
 * The record is the source of truth. Every change — the fields, the logo,
 * the favicon, the removal — bumps its `revision`, is audited by field
 * names and asset digests (never the bytes or the name), and renders the
 * directory again (core `renderAuthBranding`: Authelia's own locale files
 * with the name spliced in, the generated stylesheet, `brand.json`). When
 * the rendering fails — Authelia not answering its locales, the web root
 * unwritable — the record is kept and the answer carries a warning; the
 * first failure of a streak is audited (`domain.branding.render.failed`)
 * and raised to the administrators, its end audited
 * (`domain.branding.render.recovered`), and the reconcile renders again
 * at every identity tick.
 *
 * {@link reconcileAuthBranding} (at start, after {@link ensureBrandingBase}
 * has put Authelia's asset path and placeholder logo in place, and every
 * minute) renders every record whose directory is missing, at another
 * revision or from another Authelia release, and removes directories of
 * domains without a record — a relay restored from a backup of `state.db`
 * renders its brands again by itself. A start whose base check failed is
 * tried again by the tick before anything is rendered.
 *
 * **The auth vhost.** `auth.<domain>`'s vhost (lib/nginx.js `renderAuthVhost`)
 * serves the rendering and rewrites Authelia's index HTML for the domain,
 * and two things about a brand are in its text: the theme and whether a
 * logo is served ({@link authVhostInputs}, with the language). A change to either on an
 * active domain rewrites the vhost once the record is committed and the
 * directory rendered ({@link convergeAuthVhostLocked}: the installed text
 * compared with the rendering, written only when it differs, its link
 * state kept); a change to anything else touches nginx not at all. A
 * rewrite nginx or lamaste-priv refused keeps the record, answers with a
 * `vhost` warning, and the domain joins {@link vhostPending}, retried at
 * every reconcile until it converges or the domain is gone — the pending
 * set rather than a compare of every vhost at every tick, because the
 * start's vhost reconcile (lib/vhost-reconcile.js, which reads the record
 * through `authVhostInputs`) already compares every auth vhost once, so
 * a restart loses nothing. A brand set on a pending domain waits for its
 * activation, which renders the vhost from the record.
 *
 * Everything that writes runs under one lock; reads do not.
 */

import { execa } from 'execa';
import {
  AUTHELIA_LOCALE_OF_LANGUAGE,
  AUTHELIA_RELEASE,
  isPageLanguage,
  normaliseAutheliaVersion,
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
  AUTH_BRANDING_WEB_ROOT,
  BRAND_FIELD_NAMES,
  PromiseChainMutex,
  inspectBrandFavicon,
  inspectBrandLogo,
  renderBrandLocale,
  renderDomainCss,
  renderForcedAutheliaLocale,
  validateBrandFields,
} from '@lamalibre/lamaste';
import {
  AUTHELIA_BIN,
  ensureAutheliaBrandingBase,
  fetchAutheliaLocales,
  listRenderedBrands,
  authPagesDigest,
  readRenderedBrand,
  renderedBrandSha256,
  removeAuthBranding,
  renderAuthBranding,
  sha256Hex,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { listAudit, recordAuditBestEffort } from './audit.js';
import {
  authVhostName,
  isSiteEnabled,
  readInstalledVhost,
  renderAuthVhost,
  vhostCertDir,
  writeAuthVhost,
} from './nginx.js';
import { resetLinkState } from './mail-store.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { getStateDb } from './state-db.js';

/** One change or reconcile of the brands at a time. */
const brandingMutex = new PromiseChainMutex();

/** How long Authelia's locale files and version are kept in memory: they change only with its binary. */
const LOCALES_CACHE_MS = 10 * 60_000;

/** How long `authelia --version` may take. */
const AUTHELIA_VERSION_TIMEOUT_MS = 10_000;

/**
 * The version of the Authelia that runs, read from its binary (execa,
 * array arguments): `4.39.28`. Throws when it cannot be read.
 */
async function readRunningAutheliaVersion() {
  const { stdout } = await execa(AUTHELIA_BIN, ['--version'], {
    timeout: AUTHELIA_VERSION_TIMEOUT_MS,
  });
  const version = normaliseAutheliaVersion(stdout);
  if (version === null) throw new Error('Authelia did not say its version');
  return version;
}

/** The two assets a brand may carry, with their checks and limits. */
const ASSETS = Object.freeze({
  logo: Object.freeze({
    column: 'logo',
    inspect: inspectBrandLogo,
    maxBytes: AUTH_BRANDING_LOGO_MAX_BYTES,
  }),
  favicon: Object.freeze({
    column: 'favicon',
    inspect: inspectBrandFavicon,
    maxBytes: AUTH_BRANDING_FAVICON_MAX_BYTES,
  }),
});

export const BRAND_ASSET_KINDS = Object.freeze(Object.keys(ASSETS));

// ---------------------------------------------------------------------------
// What the relay runs (replaced in tests)
// ---------------------------------------------------------------------------

const realDeps = Object.freeze({
  webRoot: AUTH_BRANDING_WEB_ROOT,
  /** The running Authelia's version. */
  autheliaVersion: () => readRunningAutheliaVersion(),
  fetchLocales: () => fetchAutheliaLocales(),
  ensureBase: () => ensureAutheliaBrandingBase(execa),
  /** The installed auth vhost of a domain: read, its link state, written (lib/nginx.js). */
  vhost: Object.freeze({
    readInstalled: (domain) => readInstalledVhost(authVhostName(domain)),
    isEnabled: (domain) => isSiteEnabled(authVhostName(domain)),
    write: (domain, opts) => writeAuthVhost(domain, opts),
  }),
});

/** What tests replaced, read at every use (a test may change a value between calls). */
let overridden = null;

/** The dependency `key`: the test's when one is set, else the relay's. */
function dep(key) {
  return overridden && key in overridden ? overridden[key] : realDeps[key];
}

/**
 * Point the web root, the Authelia version, the locale source, the
 * Authelia base check and the auth vhost elsewhere (tests); `null`
 * restores the relay's and forgets that the base was ensured. The locale
 * cache, the failure streaks and the pending vhosts are forgotten either
 * way.
 *
 * @param {{ webRoot?: string, autheliaVersion?: () => Promise<string>, fetchLocales?: () => Promise<object>, ensureBase?: () => Promise<{ logoWritten: boolean, restarted: boolean }>, vhost?: { readInstalled: (domain: string) => Promise<string | null>, isEnabled: (domain: string) => Promise<boolean>, write: (domain: string, opts: { primary: boolean, enabled: boolean } & AuthVhostInputs) => Promise<unknown> } } | null} overrides
 */
export function setAuthBrandingForTests(overrides) {
  overridden = overrides;
  localesCache = null;
  versionCache = null;
  flaggedVersion = null;
  renderFailing.clear();
  vhostPending.clear();
  if (overrides === null) {
    baseReady = false;
    baseInFlight = null;
  }
}

/** Whether {@link ensureBrandingBase} has run this process: before that, nothing is rendered. */
let baseReady = false;
/** The base check under way, shared by whoever asks meanwhile ({@link ensureBrandingBase}). */
let baseInFlight = null;

/**
 * What every branded relay needs from Authelia (core
 * `ensureAutheliaBrandingBase`): the placeholder logo in its asset
 * directory and `server.asset_path` + `theme` in its configuration — the
 * structural change the upgrade makes, one restart, audited
 * `authelia.restarted` with reason `branding-base`. Throws when it cannot
 * be done; the caller tries again next time.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 */
export async function ensureBrandingBase({ logger } = {}) {
  // One check at a time: the start's call and the first tick's reconcile
  // overlap, and two checks reading the configuration before either wrote
  // it would both add the keys and restart Authelia (seen on an upgraded
  // relay: two `branding-base` restarts 2 ms apart).
  if (baseInFlight) return baseInFlight;
  baseInFlight = (async () => {
    const result = await dep('ensureBase')();
    if (result.restarted) {
      logger?.info('Authelia restarted for the branded sign-in (asset path, theme)');
      await recordAuditBestEffort(
        { actor: 'lamaste', action: 'authelia.restarted', details: { reason: 'branding-base' } },
        logger,
      );
    }
    if (result.logoWritten) logger?.info('Authelia placeholder logo written');
    baseReady = true;
    return result;
  })();
  try {
    return await baseInFlight;
  } finally {
    baseInFlight = null;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The record of `domain` with its blobs, or null. */
function brandingRow(db, domain) {
  return db.prepare('SELECT * FROM domain_branding WHERE domain = ?').get(domain) ?? null;
}

/** The fields of a row as the API shows them. */
function rowFields(row) {
  return {
    name: row.name,
    tagline: row.tagline,
    theme: row.theme,
    accent: row.accent,
    supportEmail: row.support_email,
    supportUrl: row.support_url,
  };
}

/** One asset as the API shows it: digest and what the inspector read from the stored bytes, never the bytes. */
function assetView(kind, row) {
  const bytes = row[ASSETS[kind].column];
  if (!bytes) return null;
  const inspected = ASSETS[kind].inspect(bytes);
  return {
    sha256: row[`${ASSETS[kind].column}_sha256`],
    bytes: bytes.length,
    ...(inspected.ok
      ? { format: inspected.format, width: inspected.width, height: inspected.height }
      : {}),
  };
}

/**
 * Whether `rendered` is what the domain's inputs make now: the brand —
 * its revision (0 without one) and the digest of its `brand.json`, as a
 * brand set after a removal starts again at revision 1 —, the language,
 * the running Authelia (null when unknown: not current) and this release's
 * pages — nginx sends their CSP hashes, so a page of another release would
 * be blocked by the browser.
 */
function renderingCurrent(rendered, { revision, brandSha256, language }, version) {
  return (
    rendered !== null &&
    version !== null &&
    rendered.revision === revision &&
    rendered.brandSha256 === brandSha256 &&
    rendered.language === language &&
    rendered.autheliaVersion === version &&
    rendered.pagesDigest === authPagesDigest()
  );
}

/** The view of a row: fields, assets without the bytes, revision, and what is rendered. */
async function brandingView(row) {
  const db = await getStateDb();
  const rendered = await readRenderedBrand(row.domain, dep('webRoot'));
  return {
    domain: row.domain,
    ...rowFields(row),
    logo: assetView('logo', row),
    favicon: assetView('favicon', row),
    revision: row.revision,
    updatedAt: row.updated_at,
    rendered,
    /** Whether the directory nginx serves is this revision and language, from the running Authelia, with this release's pages. */
    renderedCurrent: renderingCurrent(
      rendered,
      {
        revision: row.revision,
        brandSha256: brandSha256Of(row),
        language: languageOf(db, row.domain),
      },
      await knownAutheliaVersion(),
    ),
  };
}

/**
 * The digest a rendering of brand record `row` records
 * (`rendered.json` `brandSha256`, core `renderedBrandSha256`), or null
 * without a record.
 */
function brandSha256Of(row) {
  if (!row) return null;
  return renderedBrandSha256(row.domain, rowFields(row), row.revision, {
    logoSha256: row.logo ? sha256Hex(row.logo) : null,
    faviconSha256: row.favicon ? sha256Hex(row.favicon) : null,
  });
}

/**
 * What each domain's rendering is made from, by name: its brand's revision
 * (0 without a brand) and digest (null without one), and its page language
 * (null without one).
 *
 * @returns {Array<{ domain: string, revision: number, brandSha256: string | null, language: import('@lamalibre/lamaste').PageLanguage | null }>}
 */
function renderInputs(db) {
  return db
    .prepare('SELECT name AS domain, language FROM domains ORDER BY name')
    .all()
    .map((r) => {
      const row = brandingRow(db, r.domain);
      return {
        domain: r.domain,
        revision: row ? row.revision : 0,
        brandSha256: brandSha256Of(row),
        language: isPageLanguage(r.language) ? r.language : null,
      };
    });
}

/** Whether a domain has a rendering of its own: a brand or a language. */
const wantsRendering = ({ revision, language }) => revision > 0 || language !== null;

/**
 * The page language of domain `domain` (`domains.language`), or null —
 * none set, no such domain, or a value this release does not know.
 */
function languageOf(db, domain) {
  const value = db.prepare('SELECT language FROM domains WHERE name = ?').get(domain)?.language;
  return isPageLanguage(value) ? value : null;
}

/**
 * The domain's row — name, status, whether it is the primary — or null.
 * Its own query, not lib/domains.js: that module imports this one (a
 * removed domain takes its brand with it), and the dependency runs one way.
 */
function domainRow(db, name) {
  const row = db.prepare('SELECT name, status, is_primary FROM domains WHERE name = ?').get(name);
  return row ? { name: row.name, status: row.status, primary: row.is_primary === 1 } : null;
}

/** The domain's row or a 404 `unknown_domain`. */
async function domainOr404(name) {
  const row = domainRow(await getStateDb(), name);
  if (!row) throw httpError('Domain not found', 404, { code: 'unknown_domain' });
  return row;
}

/**
 * What the auth vhost says of a brand (lib/nginx.js `renderAuthVhost`):
 * Authelia's theme for the page and whether a logo is served. Null for a
 * row without a brand.
 *
 * @typedef {{ theme: string, logo: boolean }} AuthVhostBranding
 * @returns {AuthVhostBranding | null}
 */
function vhostBrandingOf(row) {
  return row ? { theme: row.theme, logo: row.logo_sha256 !== null } : null;
}

function sameVhostBranding(a, b) {
  return a === null || b === null ? a === b : a.theme === b.theme && a.logo === b.logo;
}

/**
 * What the auth vhost of a domain says (lib/nginx.js `renderAuthVhost`):
 * its brand's theme and logo switch, its page language, and where its
 * portal links "Reset password?" (mail-design.md §5: Authelia's one reset
 * URL, rewritten to the domain's own page or emptied).
 *
 * @typedef {{ primaryResetUrl: string | null, domainResetUrl: string | null }} AuthVhostMail
 * @typedef {{ branding: AuthVhostBranding | null, language: import('@lamalibre/lamaste').PageLanguage | null, mail: AuthVhostMail }} AuthVhostInputs
 */

/** The vhost inputs of `domain` from its records. */
function vhostInputsOf(db, domain) {
  const reset = resetLinkState(db);
  return {
    branding: vhostBrandingOf(brandingRow(db, domain)),
    language: languageOf(db, domain),
    mail: {
      primaryResetUrl: reset.autheliaResetUrl,
      domainResetUrl: reset.domainResetUrl(domain),
    },
  };
}

/**
 * What the auth vhost of `domain` says — `{ branding, language }`: the
 * brand's `{ theme, logo }` (null for a domain without one) and its page
 * language (null for none) — read from the records, the source of truth
 * (the rendered files catch up within a minute). For whoever writes the
 * vhost: activation (lib/domains.js), the start's vhost reconcile
 * (lib/vhost-reconcile.js). A domain the relay does not have answers both
 * null.
 *
 * @param {string} domain
 * @returns {Promise<AuthVhostInputs>}
 */
export async function authVhostInputs(domain) {
  return vhostInputsOf(await getStateDb(), domain);
}

/**
 * What a page Lamaste renders for a host under `domain` is written with —
 * its brand's `{ name, tagline, logo }` (null for none) and its page
 * language (English when none is set) — read from the records, as
 * {@link authVhostInputs} reads them.
 *
 * @param {string} domain
 * @returns {Promise<{ brand: { name: string, tagline: string | null, logo: boolean } | null, language: import('@lamalibre/lamaste').PageLanguage }>}
 */
export async function pageInputsOf(domain) {
  const db = await getStateDb();
  const row = brandingRow(db, domain);
  return {
    brand: row ? { name: row.name, tagline: row.tagline, logo: Boolean(row.logo) } : null,
    language: languageOf(db, domain) ?? 'en',
  };
}

/**
 * How Lamaste's pages and mails on domain `domain` look: the page brand
 * (core `InviteBrand`; null for a domain without one), the mail brand
 * (name and accent; null likewise) and the page language (`en` when the
 * domain sets none). Read from the records.
 *
 * @param {string} domain
 */
export async function domainPresentation(domain) {
  const db = await getStateDb();
  const row = brandingRow(db, domain);
  return {
    pageBrand: row
      ? {
          name: row.name,
          tagline: row.tagline,
          theme: row.theme,
          accent: row.accent,
          logo: row.logo_sha256 !== null,
        }
      : null,
    mailBrand: row ? { name: row.name, accent: row.accent } : null,
    language: languageOf(db, domain) ?? 'en',
  };
}

/**
 * The brand of domain `name` as the API shows it — fields, `logo` and
 * `favicon` as `{ sha256, bytes, format, width, height }`, `revision`,
 * `rendered` — or null when the domain has none. 404 `unknown_domain`.
 *
 * @param {string} name
 */
export async function getDomainBranding(name) {
  await domainOr404(name);
  const row = brandingRow(await getStateDb(), name);
  return row ? brandingView(row) : null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Authelia's locales, fetched at most once per {@link LOCALES_CACHE_MS}
 * and again whenever the running version changed (`version`: what
 * {@link runningAutheliaVersion} answered; null when unknown).
 */
let localesCache = null;

async function locales(version) {
  if (localesCache && localesCache.expiresAt > Date.now() && localesCache.version === version) {
    return localesCache.locales;
  }
  const fetched = await dep('fetchLocales')();
  localesCache = { locales: fetched, version, expiresAt: Date.now() + LOCALES_CACHE_MS };
  return fetched;
}

/** The running Authelia's version, read at most once per {@link LOCALES_CACHE_MS}. */
let versionCache = null;

/** The running Authelia version last raised as differing from the pin (this process). */
let flaggedVersion = null;

/**
 * The running Authelia's version — what a rendering records and is
 * compared with. One that differs from the pin is flagged
 * ({@link flagUnpinnedAuthelia}). Throws when it cannot be read.
 *
 * @param {import('pino').Logger} [logger]
 */
async function runningAutheliaVersion(logger) {
  if (versionCache && versionCache.expiresAt > Date.now()) return versionCache.version;
  const version = await dep('autheliaVersion')();
  versionCache = { version, expiresAt: Date.now() + LOCALES_CACHE_MS };
  await flagUnpinnedAuthelia(version, logger);
  return version;
}

/** The running Authelia's version when it can be read, else null (a view: not current). */
async function knownAutheliaVersion() {
  try {
    return await runningAutheliaVersion();
  } catch {
    return null;
  }
}

/**
 * Raise a running Authelia that is not the pinned release: audited
 * `authelia.version.unpinned` `{ running, pinned }` and notified to the
 * administrators once per running version — the audit log remembers it
 * across restarts. Best effort; the rendering goes on either way.
 */
async function flagUnpinnedAuthelia(version, logger) {
  const pinned = AUTHELIA_RELEASE.version;
  if (version === pinned || flaggedVersion === version) return;
  flaggedVersion = version;
  try {
    const [last] = await listAudit({ action: 'authelia.version.unpinned', limit: 1 });
    if (last?.details?.running === version) return;
  } catch (err) {
    logger?.warn({ err: err.message }, 'Could not read the audit log');
  }
  logger?.warn({ running: version, pinned }, 'The running Authelia is not the pinned release');
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'authelia.version.unpinned',
      details: { running: version, pinned },
    },
    logger,
  );
  await notifyAdminsBestEffort(
    {
      source: 'lamaste',
      level: 'warning',
      message: `Authelia ${version} runs on this relay; Lamaste is tested with ${pinned}. Domains with a page language may show some sign-in texts in English or in the browser's language until Lamaste's pin catches up.`,
    },
    logger,
  );
}

/**
 * What the Domains page shows of the relay's Authelia: the running
 * version (null when it cannot be read) and the pinned one.
 */
export async function autheliaVersions() {
  return { running: await knownAutheliaVersion(), pinned: AUTHELIA_RELEASE.version };
}

/** The domains whose last rendering failed — a streak is audited once. */
const renderFailing = new Map();

/** Audit and notify the start of a failure streak, audit its end (the domain and the step, never the brand). */
async function recordRenderOutcome(domain, err, logger) {
  const failing = err !== null;
  if ((renderFailing.get(domain) ?? false) === failing) return;
  renderFailing.set(domain, failing);
  await recordAuditBestEffort(
    failing
      ? {
          actor: 'lamaste',
          action: 'domain.branding.render.failed',
          details: { domain, message: err.message },
        }
      : { actor: 'lamaste', action: 'domain.branding.render.recovered', details: { domain } },
    logger,
  );
  if (failing) {
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'warning',
        message: `The brand and language of ${domain} could not be rendered for its sign-in pages (${err.message}); visitors see the pages as they were. The panel retries every minute.`,
      },
      logger,
    );
  }
}

/**
 * Render `domain` from its records — its brand, its language, or both —
 * (holding the lock). Nothing for a domain with neither (null). Throws
 * when it cannot be rendered; the outcome of the streak is recorded.
 */
async function renderLocked(domain, logger) {
  const db = await getStateDb();
  const row = brandingRow(db, domain);
  const language = languageOf(db, domain);
  if (!row && language === null) return null;
  try {
    const version = await runningAutheliaVersion(logger);
    const all = await locales(version);
    const rendered = await renderAuthBranding({
      domain,
      brand: row ? rowFields(row) : null,
      language,
      revision: row ? row.revision : 0,
      logo: row?.logo ?? null,
      favicon: row?.favicon ?? null,
      locales: all,
      autheliaVersion: version,
      root: dep('webRoot'),
    });
    await recordRenderOutcome(domain, null, logger);
    // Files Authelia lists but does not serve (4.39.28: `srp`) are left out
    // of the rendering, as they are of the stock page.
    logger?.info(
      {
        domain,
        revision: rendered.revision,
        language,
        localeFiles: all.files.length,
        localesMissing: all.missing?.length ?? 0,
      },
      'Sign-in pages rendered',
    );
    if (rendered.fromEnglish.length > 0) {
      // A newer Authelia than the pin added texts Lamaste has no translation
      // of: they read in English (counted, never listed in the log).
      logger?.warn(
        {
          domain,
          language,
          keys: rendered.fromEnglish.length,
          autheliaVersion: rendered.autheliaVersion,
        },
        'Some sign-in texts have no translation and stay in English',
      );
    }
    return rendered;
  } catch (err) {
    logger?.warn({ domain, err: err.message }, 'Sign-in pages rendering failed');
    await recordRenderOutcome(domain, err, logger);
    throw err;
  }
}

/**
 * Render after a change (`what` was saved: the brand, the language): the
 * warning the answer carries when it failed, else none.
 */
async function renderAfterChange(domain, logger, what = 'brand') {
  try {
    await renderLocked(domain, logger);
    return [];
  } catch (err) {
    return [
      {
        step: 'render',
        message: `The ${what} was saved but not rendered (${err.message}); the panel renders it again within a minute`,
      },
    ];
  }
}

/**
 * Bring the rendering of `domain` in line with its records after a change
 * (holding the lock): rendered when it has a brand or a language, removed
 * when it has neither. The warnings of a failure.
 */
async function rerenderAfterChange(domain, logger, what) {
  const db = await getStateDb();
  if (brandingRow(db, domain) || languageOf(db, domain) !== null) {
    return renderAfterChange(domain, logger, what);
  }
  return removeRenderedLocked(domain, logger);
}

/** Remove the rendering of `domain` (holding the lock), logging a failure. */
async function removeRenderedLocked(domain, logger) {
  try {
    await removeAuthBranding(domain, dep('webRoot'));
    renderFailing.delete(domain);
  } catch (err) {
    logger?.warn({ domain, err: err.message }, 'The rendered brand of a domain stayed');
    return [{ step: 'render', message: `The rendered files stayed (${err.message})` }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The auth vhost
// ---------------------------------------------------------------------------

/**
 * The domains whose auth vhost does not say what their record says: a
 * rewrite that nginx or lamaste-priv refused, retried at every reconcile.
 * Entering is audited (`domain.branding.vhost.failed`) and raised to the
 * administrators, leaving too (`domain.branding.vhost.recovered`).
 */
const vhostPending = new Set();

/** Audit and notify a domain joining {@link vhostPending}, audit its leaving (the domain and the step, never the brand). */
async function recordVhostOutcome(domain, err, logger) {
  const failing = err !== null;
  if (vhostPending.has(domain) === failing) return;
  if (failing) vhostPending.add(domain);
  else vhostPending.delete(domain);
  await recordAuditBestEffort(
    failing
      ? {
          actor: 'lamaste',
          action: 'domain.branding.vhost.failed',
          details: { domain, message: err.message },
        }
      : { actor: 'lamaste', action: 'domain.branding.vhost.recovered', details: { domain } },
    logger,
  );
  if (failing) {
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'warning',
        message: `The sign-in page of ${domain} could not be switched to its brand's theme and logo or its language (${err.message}); visitors see the page as it was. The panel retries every minute.`,
      },
      logger,
    );
  }
}

/**
 * Bring the auth vhost of `domain` in line with its record (holding the
 * lock): rendered on the certificate the installed vhost names, written —
 * its link state kept — only when the installed text differs. Nothing for
 * a domain that is not active (its activation renders the vhost from the
 * record) or whose vhost is not installed (the start's vhost reconcile
 * reports that); either leaves the pending set. Throws when the write
 * failed, the domain pending; the outcome of the streak is recorded.
 *
 * @param {string} domain
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<'written' | 'unchanged' | 'not_active' | 'not_installed'>}
 */
async function convergeAuthVhostLocked(domain, logger) {
  const db = await getStateDb();
  const row = domainRow(db, domain);
  if (!row || row.status !== 'active') {
    vhostPending.delete(domain);
    return 'not_active';
  }
  const vhost = dep('vhost');
  try {
    const installed = await vhost.readInstalled(domain);
    const certDir = installed === null ? null : vhostCertDir(installed);
    if (certDir === null) {
      logger?.warn({ domain }, 'The auth vhost is not installed; its brand waits for it');
      vhostPending.delete(domain);
      return 'not_installed';
    }
    const inputs = vhostInputsOf(db, domain);
    const expected = renderAuthVhost(domain, certDir, { primary: row.primary, ...inputs });
    if (expected.config === installed) {
      await recordVhostOutcome(domain, null, logger);
      return 'unchanged';
    }
    await vhost.write(domain, {
      primary: row.primary,
      enabled: await vhost.isEnabled(domain),
      ...inputs,
    });
    await recordVhostOutcome(domain, null, logger);
    logger?.info(
      { domain, branded: inputs.branding !== null, language: inputs.language },
      'Auth vhost rewritten for the brand, language and mail',
    );
    return 'written';
  } catch (err) {
    logger?.warn(
      { domain, err: err.message },
      'Auth vhost rewrite for the brand and language failed',
    );
    await recordVhostOutcome(domain, err, logger);
    throw err;
  }
}

/**
 * Bring every active domain's auth vhost in line with its records — after
 * a change of the relay's mail moved where the portals link "Reset
 * password?" (mail-design.md §5). A vhost that could not be written stays
 * pending and is retried within a minute ({@link reconcileAuthBranding});
 * the answer names it.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<{ written: string[], failed: string[] }>}
 */
export async function convergeAuthVhosts({ logger } = {}) {
  return brandingMutex.run(async () => {
    const result = { written: [], failed: [] };
    const domains = (await getStateDb())
      .prepare("SELECT name FROM domains WHERE status = 'active' ORDER BY name")
      .all()
      .map((row) => row.name);
    for (const domain of domains) {
      try {
        if ((await convergeAuthVhostLocked(domain, logger)) === 'written')
          result.written.push(domain);
      } catch {
        result.failed.push(domain);
      }
    }
    return result;
  });
}

/**
 * Rewrite the vhost after a change that moved what it says
 * ({@link vhostBrandingOf} before and after differ): the warning the
 * answer carries when it failed, else none.
 */
async function convergeAuthVhostAfterChange(domain, before, after, logger) {
  if (sameVhostBranding(before, after)) return [];
  return convergeAuthVhostWarnings(
    domain,
    logger,
    'The brand was saved but the sign-in page keeps its previous theme and logo switch',
  );
}

/** Rewrite the vhost of `domain` (holding the lock): `[{ step: 'vhost', message }]` when it failed. */
async function convergeAuthVhostWarnings(domain, logger, saved) {
  try {
    await convergeAuthVhostLocked(domain, logger);
    return [];
  } catch (err) {
    return [
      {
        step: 'vhost',
        message: `${saved} (${err.message}); the panel retries within a minute`,
      },
    ];
  }
}

/**
 * Retry the vhosts of {@link vhostPending} (holding the lock): the domains
 * rewritten and those still failing. Never throws.
 */
async function convergePendingVhostsLocked(logger) {
  const result = { rewritten: [], failed: [] };
  for (const domain of [...vhostPending]) {
    try {
      if ((await convergeAuthVhostLocked(domain, logger)) === 'written')
        result.rewritten.push(domain);
    } catch {
      result.failed.push(domain);
    }
  }
  return result;
}

/**
 * Remove the rendering of a domain that was removed (lib/domains.js
 * `removeDomain`, whose transaction deleted its records). Idempotent.
 *
 * @param {string} domain
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeRenderedBranding(domain, { logger } = {}) {
  return brandingMutex.run(() => removeRenderedLocked(domain, logger));
}

/**
 * Bring every rendering in line with the records: render each domain with
 * a brand or a language whose directory is missing, at another revision or
 * language, from another running Authelia or of another release's pages;
 * remove the directories of domains with neither. Nothing
 * before {@link ensureBrandingBase} succeeded — tried here again when the
 * start's attempt failed. Then the auth vhosts a change could not rewrite
 * ({@link vhostPending}), base or no base: `vhostsRewritten` and
 * `vhostsFailed` name them when there were any. Never throws.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<{ rendered: string[], removed: string[], failed: string[], skipped?: 'base', vhostsRewritten?: string[], vhostsFailed?: string[] }>}
 */
export async function reconcileAuthBranding({ logger } = {}) {
  const result = { rendered: [], removed: [], failed: [] };
  if (!baseReady) {
    try {
      await ensureBrandingBase({ logger });
    } catch (err) {
      logger?.warn(
        { err: err.message },
        'Authelia branding base not in place; brands not rendered',
      );
      result.skipped = 'base';
    }
  }
  return brandingMutex.run(async () => {
    if (result.skipped !== 'base') await reconcileRenderingsLocked(result, logger);
    const vhosts = await convergePendingVhostsLocked(logger);
    if (vhosts.rewritten.length > 0) result.vhostsRewritten = vhosts.rewritten;
    if (vhosts.failed.length > 0) result.vhostsFailed = vhosts.failed;
    return result;
  });
}

/** The renderings in line with the records (holding the lock); see {@link reconcileAuthBranding}. */
async function reconcileRenderingsLocked(result, logger) {
  try {
    // Every domain with a brand or a language — a rendering of its own.
    const records = renderInputs(await getStateDb()).filter(wantsRendering);
    const known = new Set(records.map((r) => r.domain));
    for (const domain of await listRenderedBrands(dep('webRoot'))) {
      if (known.has(domain)) continue;
      if ((await removeRenderedLocked(domain, logger)).length === 0) result.removed.push(domain);
    }
    if (records.length === 0) return;
    const version = await runningAutheliaVersion(logger);
    for (const record of records) {
      const current = await readRenderedBrand(record.domain, dep('webRoot'));
      if (renderingCurrent(current, record, version)) continue;
      try {
        await renderLocked(record.domain, logger);
        result.rendered.push(record.domain);
      } catch {
        result.failed.push(record.domain);
      }
    }
  } catch (err) {
    logger?.warn({ err: err.message }, 'Could not reconcile the rendered brands');
  }
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

/** The revision check a change asks for: 409 `revision_mismatch` with the current one. */
function assertRevision(row, ifRevision) {
  if (ifRevision === undefined || row === null || row.revision === ifRevision) return;
  throw httpError(`The brand changed since it was read (revision ${row.revision})`, 409, {
    code: 'revision_mismatch',
    revision: row.revision,
  });
}

/** `{ warnings }` when there are any, else nothing. */
const withWarnings = (warnings) => (warnings.length > 0 ? { warnings } : {});

/**
 * Set the fields of the brand of domain `name` — created when the domain
 * has none — validated with core `validateBrandFields` (400
 * `invalid_branding` with `errors` by field name, never a value). Assets
 * stay. `ifRevision` refuses a stale change (409 `revision_mismatch`).
 * Audited `domain.branding.updated` with the names of the fields that
 * changed. Then rendered; the auth vhost rewritten when the theme changed
 * (warning `vhost` when nginx refused it; see the module comment).
 *
 * @param {string} name
 * @param {unknown} fields
 * @param {{ ifRevision?: number, actor: string, logger?: import('pino').Logger }} opts
 */
export async function updateDomainBranding(name, fields, { ifRevision, actor, logger }) {
  await domainOr404(name);
  const validation = validateBrandFields(fields);
  if (!validation.ok) {
    throw httpError('The brand fields are not valid', 400, {
      code: 'invalid_branding',
      errors: validation.errors,
    });
  }
  const brand = validation.value;
  return brandingMutex.run(async () => {
    const db = await getStateDb();
    const row = brandingRow(db, name);
    assertRevision(row, ifRevision);
    const now = new Date().toISOString();
    const changed = row
      ? BRAND_FIELD_NAMES.filter((field) => rowFields(row)[field] !== brand[field])
      : [...BRAND_FIELD_NAMES];
    if (row && changed.length === 0) {
      return { branding: await brandingView(row), created: false, changed: false };
    }
    const revision = row ? row.revision + 1 : 1;
    db.prepare(
      `INSERT INTO domain_branding (domain, name, tagline, theme, accent, support_email, support_url, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (domain) DO UPDATE SET
         name = excluded.name, tagline = excluded.tagline, theme = excluded.theme,
         accent = excluded.accent, support_email = excluded.support_email,
         support_url = excluded.support_url, revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ).run(
      name,
      brand.name,
      brand.tagline,
      brand.theme,
      brand.accent,
      brand.supportEmail,
      brand.supportUrl,
      revision,
      now,
    );
    await recordAuditBestEffort(
      {
        actor,
        action: 'domain.branding.updated',
        details: { domain: name, fields: changed, revision, created: row === null },
      },
      logger,
    );
    const updated = brandingRow(db, name);
    const warnings = [
      ...(await renderAfterChange(name, logger)),
      ...(await convergeAuthVhostAfterChange(
        name,
        vhostBrandingOf(row),
        vhostBrandingOf(updated),
        logger,
      )),
    ];
    return {
      branding: await brandingView(updated),
      created: row === null,
      changed: true,
      ...withWarnings(warnings),
    };
  });
}

/**
 * Remove the brand of domain `name`: the record, its rendering and the
 * brand in its auth vhost — back to the stock page. `removed: false` when
 * there was none. Audited `domain.branding.removed`.
 *
 * @param {string} name
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeDomainBranding(name, { actor, logger }) {
  await domainOr404(name);
  return brandingMutex.run(async () => {
    const db = await getStateDb();
    const row = brandingRow(db, name);
    if (!row) return { removed: false };
    db.prepare('DELETE FROM domain_branding WHERE domain = ?').run(name);
    await recordAuditBestEffort(
      {
        actor,
        action: 'domain.branding.removed',
        details: { domain: name, revision: row.revision },
      },
      logger,
    );
    // A domain with a language keeps a rendering of its own, unbranded.
    const warnings = [
      ...(await rerenderAfterChange(name, logger, 'removal')),
      ...(await convergeAuthVhostAfterChange(name, vhostBrandingOf(row), null, logger)),
    ];
    return { removed: true, ...withWarnings(warnings) };
  });
}

/** The largest base64 text an asset of `maxBytes` can be. */
export function base64LengthFor(maxBytes) {
  return Math.ceil(maxBytes / 3) * 4;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The bytes of `data` (base64), checked as `kind` (core inspectors): 413
 * `asset_too_large` before decoding when the text is longer than the
 * limit allows, 400 `invalid_image` with `reason` when the bytes are not
 * the image kind.
 *
 * @param {'logo' | 'favicon'} kind
 * @param {string} data
 */
export function decodeBrandAsset(kind, data) {
  const asset = ASSETS[kind];
  if (typeof data !== 'string' || data.length > base64LengthFor(asset.maxBytes)) {
    throw httpError(`The ${kind} is larger than ${asset.maxBytes / 1024} KiB`, 413, {
      code: 'asset_too_large',
    });
  }
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64_RE.test(data)) {
    throw httpError(`The ${kind} is not base64`, 400, {
      code: 'invalid_image',
      reason: 'not_base64',
    });
  }
  const bytes = Buffer.from(data, 'base64');
  const inspected = asset.inspect(bytes);
  if (!inspected.ok) {
    throw httpError(inspected.message, inspected.reason === 'too_large' ? 413 : 400, {
      code: inspected.reason === 'too_large' ? 'asset_too_large' : 'invalid_image',
      reason: inspected.reason,
    });
  }
  return { bytes, inspected };
}

/**
 * Set the logo or the favicon of the brand of domain `name` from base64
 * `data`: checked (400 `invalid_image`, 413 `asset_too_large`), stored
 * with its digest, the revision bumped, audited by digest and dimensions,
 * rendered — and, for the first logo, the auth vhost rewritten to show it.
 * 404 `no_branding` when the domain has no brand yet (set its fields
 * first).
 *
 * @param {string} name
 * @param {'logo' | 'favicon'} kind
 * @param {string} data
 * @param {{ ifRevision?: number, actor: string, logger?: import('pino').Logger }} opts
 */
export async function setDomainBrandingAsset(name, kind, data, { ifRevision, actor, logger }) {
  await domainOr404(name);
  const { bytes, inspected } = decodeBrandAsset(kind, data);
  const sha256 = sha256Hex(bytes);
  return brandingMutex.run(async () => {
    const db = await getStateDb();
    const row = brandingRow(db, name);
    if (!row) throw noBranding(name);
    assertRevision(row, ifRevision);
    if (row[`${ASSETS[kind].column}_sha256`] === sha256) {
      return { branding: await brandingView(row), changed: false };
    }
    const revision = row.revision + 1;
    db.prepare(
      `UPDATE domain_branding SET ${ASSETS[kind].column} = ?, ${ASSETS[kind].column}_sha256 = ?,
         revision = ?, updated_at = ? WHERE domain = ?`,
    ).run(bytes, sha256, revision, new Date().toISOString(), name);
    await recordAuditBestEffort(
      {
        actor,
        action: 'domain.branding.updated',
        details: {
          domain: name,
          asset: kind,
          sha256,
          format: inspected.format,
          width: inspected.width,
          height: inspected.height,
          bytes: inspected.bytes,
          revision,
        },
      },
      logger,
    );
    const updated = brandingRow(db, name);
    const warnings = [
      ...(await renderAfterChange(name, logger)),
      ...(await convergeAuthVhostAfterChange(
        name,
        vhostBrandingOf(row),
        vhostBrandingOf(updated),
        logger,
      )),
    ];
    return {
      branding: await brandingView(updated),
      changed: true,
      ...withWarnings(warnings),
    };
  });
}

/**
 * Remove the logo or the favicon of the brand of domain `name`
 * (`removed: false` when there was none). Audited, rendered; the auth
 * vhost rewritten when it was the logo.
 *
 * @param {string} name
 * @param {'logo' | 'favicon'} kind
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeDomainBrandingAsset(name, kind, { actor, logger }) {
  await domainOr404(name);
  return brandingMutex.run(async () => {
    const db = await getStateDb();
    const row = brandingRow(db, name);
    if (!row) throw noBranding(name);
    const current = row[`${ASSETS[kind].column}_sha256`];
    if (!current) return { removed: false, branding: await brandingView(row) };
    const revision = row.revision + 1;
    db.prepare(
      `UPDATE domain_branding SET ${ASSETS[kind].column} = NULL, ${ASSETS[kind].column}_sha256 = NULL,
         revision = ?, updated_at = ? WHERE domain = ?`,
    ).run(revision, new Date().toISOString(), name);
    await recordAuditBestEffort(
      {
        actor,
        action: 'domain.branding.updated',
        details: { domain: name, asset: kind, removed: true, sha256: current, revision },
      },
      logger,
    );
    const updated = brandingRow(db, name);
    const warnings = [
      ...(await renderAfterChange(name, logger)),
      ...(await convergeAuthVhostAfterChange(
        name,
        vhostBrandingOf(row),
        vhostBrandingOf(updated),
        logger,
      )),
    ];
    return {
      removed: true,
      branding: await brandingView(updated),
      ...withWarnings(warnings),
    };
  });
}

/**
 * Bring the rendering and the auth vhost of domain `name` in line with its
 * language after lib/domains.js `setDomainLanguage` committed it (under
 * its domain lock and the domain rendering's, then this module's): the
 * domain rendered — or its rendering removed when it has neither a brand
 * nor a language — and its vhost rewritten. Nothing of Authelia's
 * configuration changes, so Authelia never restarts. The warnings of what
 * failed (`render`, `vhost`); the reconcile retries both.
 *
 * @param {string} name
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<Array<{ step: string, message: string }>>}
 */
export async function applyDomainLanguage(name, { logger } = {}) {
  return brandingMutex.run(async () => [
    ...(await rerenderAfterChange(name, logger, 'language')),
    ...(await convergeAuthVhostWarnings(
      name,
      logger,
      'The language was saved and rendered, but the sign-in page may mix its previous and new language until its vhost is rewritten',
    )),
  ]);
}

/**
 * The rendering of every domain as the Domains page shows it: what
 * `rendered.json` says, whether it is current, and whether its last
 * rendering or vhost rewrite failed (the reconcile retries both). Null for
 * a domain with neither a brand nor a language and nothing rendered — there
 * is no rendering to speak of; one still on disk is listed (not current)
 * until the reconcile removes it.
 *
 * @returns {Promise<Map<string, { rendered: object | null, current: boolean, renderFailing: boolean, vhostPending: boolean } | null>>}
 */
export async function domainRenderings() {
  const [inputs, version] = [renderInputs(await getStateDb()), await knownAutheliaVersion()];
  const rendered = await Promise.all(
    inputs.map((input) => readRenderedBrand(input.domain, dep('webRoot'))),
  );
  return new Map(
    inputs.map((input, i) => {
      const wanted = wantsRendering(input);
      if (!wanted && rendered[i] === null) return [input.domain, null];
      return [
        input.domain,
        {
          rendered: rendered[i],
          current: wanted && renderingCurrent(rendered[i], input, version),
          renderFailing: renderFailing.get(input.domain) ?? false,
          vhostPending: vhostPending.has(input.domain),
        },
      ];
    }),
  );
}

function noBranding(name) {
  return httpError(`Domain '${name}' has no brand yet — set its fields first`, 404, {
    code: 'no_branding',
  });
}

/**
 * What the panel previews: the domain's `brand.css` and the title and
 * footer as the sign-in shows them — in the domain's language when it has
 * one (its forced portal file, as rendered), else Authelia's English. 404
 * `no_branding`; 503 `authelia_unavailable` when Authelia's locales cannot
 * be read.
 *
 * @param {string} name
 */
export async function getDomainBrandingPreview(name) {
  await domainOr404(name);
  const db = await getStateDb();
  const row = brandingRow(db, name);
  if (!row) throw noBranding(name);
  const language = languageOf(db, name);
  let all;
  try {
    all = await locales(await knownAutheliaVersion());
  } catch (err) {
    throw httpError(`Authelia's texts could not be read: ${err.message}`, 503, {
      code: 'authelia_unavailable',
    });
  }
  const portalOf = (locale) =>
    all.files.find((f) => f.locale === locale && f.namespace === 'portal')?.messages;
  const english = portalOf('en');
  const messages =
    english && language !== null
      ? renderForcedAutheliaLocale({
          namespace: 'portal',
          language,
          english,
          embedded: portalOf(AUTHELIA_LOCALE_OF_LANGUAGE[language]) ?? null,
        }).messages
      : english;
  const strings = messages ? renderBrandLocale(messages, row.name) : {};
  return {
    locale: language ?? 'en',
    css: renderDomainCss({ accent: row.accent, theme: row.theme }, language),
    title: strings['Login - {{authelia}}'] ?? `Login - ${row.name}`,
    footer: strings['Powered by {{authelia}}'] ?? `Powered by ${row.name}`,
    theme: row.theme,
    logo: row.logo_sha256 !== null,
    favicon: row.favicon_sha256 !== null,
  };
}
