/**
 * A domain's brand on its auth pages (packages/core/docs/auth-branding-design.md):
 * the record in `state.db` (`domain_branding`, migration 0019) and its
 * rendering under `/var/www/lamaste/auth/<domain>/`, which nginx serves on
 * `auth.<domain>` for the routes Authelia lets a file override.
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
 * logo is served ({@link authVhostBranding}). A change to either on an
 * active domain rewrites the vhost once the record is committed and the
 * directory rendered ({@link convergeAuthVhostLocked}: the installed text
 * compared with the rendering, written only when it differs, its link
 * state kept); a change to anything else touches nginx not at all. A
 * rewrite nginx or lamaste-priv refused keeps the record, answers with a
 * `vhost` warning, and the domain joins {@link vhostPending}, retried at
 * every reconcile until it converges or the domain is gone — the pending
 * set rather than a compare of every vhost at every tick, because the
 * start's vhost reconcile (lib/vhost-reconcile.js, which reads the record
 * through `authVhostBranding`) already compares every auth vhost once, so
 * a restart loses nothing. A brand set on a pending domain waits for its
 * activation, which renders the vhost from the record.
 *
 * Everything that writes runs under one lock; reads do not.
 */

import { execa } from 'execa';
import {
  AUTHELIA_RELEASE,
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
  AUTH_BRANDING_WEB_ROOT,
  BRAND_FIELD_NAMES,
  PromiseChainMutex,
  inspectBrandFavicon,
  inspectBrandLogo,
  renderBrandCss,
  renderBrandLocale,
  validateBrandFields,
} from '@lamalibre/lamaste';
import {
  ensureAutheliaBrandingBase,
  fetchAutheliaLocales,
  listRenderedBrands,
  readRenderedBrand,
  removeAuthBranding,
  renderAuthBranding,
  sha256Hex,
} from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import {
  authVhostName,
  isSiteEnabled,
  readInstalledVhost,
  renderAuthVhost,
  vhostCertDir,
  writeAuthVhost,
} from './nginx.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { getStateDb } from './state-db.js';

/** One change or reconcile of the brands at a time. */
const brandingMutex = new PromiseChainMutex();

/** How long Authelia's locale files are kept in memory: they change only with its binary. */
const LOCALES_CACHE_MS = 10 * 60_000;

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
  autheliaVersion: AUTHELIA_RELEASE.version,
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
 * @param {{ webRoot?: string, autheliaVersion?: string, fetchLocales?: () => Promise<object>, ensureBase?: () => Promise<{ logoWritten: boolean, restarted: boolean }>, vhost?: { readInstalled: (domain: string) => Promise<string | null>, isEnabled: (domain: string) => Promise<boolean>, write: (domain: string, opts: { primary: boolean, enabled: boolean, branding: AuthVhostBranding | null }) => Promise<unknown> } } | null} overrides
 */
export function setAuthBrandingForTests(overrides) {
  overridden = overrides;
  localesCache = null;
  renderFailing.clear();
  vhostPending.clear();
  if (overrides === null) baseReady = false;
}

/** Whether {@link ensureBrandingBase} has run this process: before that, nothing is rendered. */
let baseReady = false;

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

/** The view of a row: fields, assets without the bytes, revision, and what is rendered. */
async function brandingView(row) {
  const rendered = await readRenderedBrand(row.domain, dep('webRoot'));
  return {
    domain: row.domain,
    ...rowFields(row),
    logo: assetView('logo', row),
    favicon: assetView('favicon', row),
    revision: row.revision,
    updatedAt: row.updated_at,
    rendered,
    /** Whether the directory nginx serves is this revision from this Authelia release. */
    renderedCurrent:
      rendered !== null &&
      rendered.revision === row.revision &&
      rendered.autheliaVersion === dep('autheliaVersion'),
  };
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
 * What the auth vhost of `domain` says of its brand — `{ theme, logo }`,
 * or null for a domain without one — read from the record, the source of
 * truth (the rendered files catch up within a minute). For whoever writes
 * the vhost: activation (lib/domains.js), the start's vhost reconcile
 * (lib/vhost-reconcile.js). A domain the relay does not have answers null.
 *
 * @param {string} domain
 * @returns {Promise<AuthVhostBranding | null>}
 */
export async function authVhostBranding(domain) {
  const db = await getStateDb();
  return vhostBrandingOf(
    db.prepare('SELECT theme, logo_sha256 FROM domain_branding WHERE domain = ?').get(domain) ??
      null,
  );
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

/** Authelia's locales, fetched at most once per {@link LOCALES_CACHE_MS}. */
let localesCache = null;

async function locales() {
  if (localesCache && localesCache.expiresAt > Date.now()) return localesCache.locales;
  const fetched = await dep('fetchLocales')();
  localesCache = { locales: fetched, expiresAt: Date.now() + LOCALES_CACHE_MS };
  return fetched;
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
        message: `The brand of ${domain} could not be rendered for its sign-in page (${err.message}); visitors see the page as it was. The panel retries every minute.`,
      },
      logger,
    );
  }
}

/**
 * Render the brand of `domain` from its record (holding the lock). Throws
 * when it cannot be rendered; the outcome of the streak is recorded.
 */
async function renderLocked(domain, logger) {
  const row = brandingRow(await getStateDb(), domain);
  if (!row) return null;
  try {
    const all = await locales();
    const rendered = await renderAuthBranding({
      domain,
      brand: rowFields(row),
      revision: row.revision,
      logo: row.logo ?? null,
      favicon: row.favicon ?? null,
      locales: all,
      autheliaVersion: dep('autheliaVersion'),
      root: dep('webRoot'),
    });
    await recordRenderOutcome(domain, null, logger);
    // Files Authelia lists but does not serve (4.39.28: `srp`) are left out
    // of the rendering, as they are of the stock page.
    logger?.info(
      {
        domain,
        revision: row.revision,
        localeFiles: all.files.length,
        localesMissing: all.missing?.length ?? 0,
      },
      'Brand rendered',
    );
    return rendered;
  } catch (err) {
    logger?.warn({ domain, err: err.message }, 'Brand rendering failed');
    await recordRenderOutcome(domain, err, logger);
    throw err;
  }
}

/** Render after a change: the warning the answer carries when it failed, else none. */
async function renderAfterChange(domain, logger) {
  try {
    await renderLocked(domain, logger);
    return [];
  } catch (err) {
    return [
      {
        step: 'render',
        message: `The brand was saved but not rendered (${err.message}); the panel renders it again within a minute`,
      },
    ];
  }
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
        message: `The sign-in page of ${domain} could not be switched to its brand's theme and logo (${err.message}); visitors see the page as it was. The panel retries every minute.`,
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
    const branding = vhostBrandingOf(brandingRow(db, domain));
    const expected = renderAuthVhost(domain, certDir, { primary: row.primary, branding });
    if (expected.config === installed) {
      await recordVhostOutcome(domain, null, logger);
      return 'unchanged';
    }
    await vhost.write(domain, {
      primary: row.primary,
      enabled: await vhost.isEnabled(domain),
      branding,
    });
    await recordVhostOutcome(domain, null, logger);
    logger?.info({ domain, branded: branding !== null }, 'Auth vhost rewritten for the brand');
    return 'written';
  } catch (err) {
    logger?.warn({ domain, err: err.message }, 'Auth vhost rewrite for the brand failed');
    await recordVhostOutcome(domain, err, logger);
    throw err;
  }
}

/**
 * Rewrite the vhost after a change that moved what it says
 * ({@link vhostBrandingOf} before and after differ): the warning the
 * answer carries when it failed, else none.
 */
async function convergeAuthVhostAfterChange(domain, before, after, logger) {
  if (sameVhostBranding(before, after)) return [];
  try {
    await convergeAuthVhostLocked(domain, logger);
    return [];
  } catch (err) {
    return [
      {
        step: 'vhost',
        message: `The brand was saved but the sign-in page keeps its previous theme and logo switch (${err.message}); the panel retries within a minute`,
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
 * Remove the rendered brand of a domain that was removed (lib/domains.js
 * `removeDomain`, whose transaction deleted the record). Idempotent.
 *
 * @param {string} domain
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function removeRenderedBranding(domain, { logger } = {}) {
  return brandingMutex.run(() => removeRenderedLocked(domain, logger));
}

/**
 * Bring every rendering in line with the records: render each whose
 * directory is missing, at another revision or from another Authelia
 * release; remove the directories of domains without a record. Nothing
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
    const db = await getStateDb();
    const records = db
      .prepare('SELECT domain, revision FROM domain_branding ORDER BY domain')
      .all();
    const known = new Set(records.map((r) => r.domain));
    for (const domain of await listRenderedBrands(dep('webRoot'))) {
      if (known.has(domain)) continue;
      if ((await removeRenderedLocked(domain, logger)).length === 0) result.removed.push(domain);
    }
    for (const record of records) {
      const current = await readRenderedBrand(record.domain, dep('webRoot'));
      if (
        current &&
        current.revision === record.revision &&
        current.autheliaVersion === dep('autheliaVersion')
      ) {
        continue;
      }
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
    const warnings = [
      ...(await removeRenderedLocked(name, logger)),
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

function noBranding(name) {
  return httpError(`Domain '${name}' has no brand yet — set its fields first`, 404, {
    code: 'no_branding',
  });
}

/**
 * What the panel previews: the brand's `brand.css` and the English title
 * and footer as the sign-in shows them. 404 `no_branding`; 503
 * `authelia_unavailable` when Authelia's locales cannot be read.
 *
 * @param {string} name
 */
export async function getDomainBrandingPreview(name) {
  await domainOr404(name);
  const row = brandingRow(await getStateDb(), name);
  if (!row) throw noBranding(name);
  let all;
  try {
    all = await locales();
  } catch (err) {
    throw httpError(`Authelia's texts could not be read: ${err.message}`, 503, {
      code: 'authelia_unavailable',
    });
  }
  const en = all.files.find((f) => f.locale === 'en' && f.namespace === 'portal');
  const strings = en ? renderBrandLocale(en.messages, row.name) : {};
  return {
    locale: 'en',
    css: renderBrandCss({ accent: row.accent }),
    title: strings['Login - {{authelia}}'] ?? `Login - ${row.name}`,
    footer: strings['Powered by {{authelia}}'] ?? `Powered by ${row.name}`,
    theme: row.theme,
    logo: row.logo_sha256 !== null,
    favicon: row.favicon_sha256 !== null,
  };
}
