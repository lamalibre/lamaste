/**
 * `lamaste-server domains branding` — a domain's brand on its auth pages
 * as the CLI reads and changes it: the flags of `set`, the merged body it
 * sends, the pre-check of a logo or favicon file, the brand in lines, and
 * refusals in words. Pure helpers, exported for tests (the command is
 * src/commands/domains.js). The limits are core's
 * (`@lamalibre/lamaste/branding`), never copied here; no line ever
 * carries a value the panel refused.
 */

import {
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
  AUTH_BRANDING_THEMES,
} from '@lamalibre/lamaste/branding';

import { formatMoment, terminalText } from './plugin-settings.js';

/** The two assets a brand carries, with their limits. */
export const BRAND_ASSETS = Object.freeze({
  logo: Object.freeze({ maxBytes: AUTH_BRANDING_LOGO_MAX_BYTES, what: 'a PNG' }),
  favicon: Object.freeze({ maxBytes: AUTH_BRANDING_FAVICON_MAX_BYTES, what: 'an ICO or a PNG' }),
});

/** The flags of `set`, each to the field it sets. */
const SET_FLAGS = Object.freeze({
  '--name': 'name',
  '--tagline': 'tagline',
  '--theme': 'theme',
  '--accent': 'accent',
  '--support-email': 'supportEmail',
  '--support-url': 'supportUrl',
});

/** What `--clear` takes, each to the field it clears (the name cannot be cleared: a brand has one). */
const CLEARABLE = Object.freeze({
  tagline: 'tagline',
  accent: 'accent',
  'support-email': 'supportEmail',
  'support-url': 'supportUrl',
});

/** `12.3 KiB` / `512 KiB` — a size in words. */
export function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${Number.isInteger(kib) ? kib : kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

/** `--if-revision`'s value: a positive integer, or null for anything else. */
export function parseRevision(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * The arguments of `domains branding <domain> set …`:
 * `--name <n>`, `--tagline <t>`, `--theme <light|dark|grey|oled|auto>`,
 * `--accent <#rrggbb>`, `--support-email <e>`, `--support-url <u>`,
 * `--clear <tagline|accent|support-email|support-url>` (repeatable) and
 * `--if-revision <n>`. The values are passed to the panel as given — it
 * applies the rules and answers by field — except that a flag with no
 * value, an unknown flag, a theme that is not one of Authelia's, a field
 * both set and cleared, or a revision that is not a positive integer is a
 * usage error here.
 *
 * @param {string[]} rest  what follows `set`
 * @returns {{ fields: Record<string, string>, clears: string[], ifRevision?: number } | { error: string }}
 */
export function brandingSetArgs(rest) {
  const fields = {};
  const clears = [];
  let ifRevision;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--clear') {
      if (value === undefined) return { error: '--clear needs a field' };
      const field = CLEARABLE[value];
      if (!field) {
        return { error: `--clear takes one of ${Object.keys(CLEARABLE).join(', ')}` };
      }
      if (!clears.includes(field)) clears.push(field);
      i += 1;
      continue;
    }
    if (flag === '--if-revision') {
      if (value === undefined) return { error: '--if-revision needs a revision' };
      const n = parseRevision(value);
      if (n === null) return { error: '--if-revision takes a positive integer' };
      ifRevision = n;
      i += 1;
      continue;
    }
    const field = SET_FLAGS[flag];
    if (!field) return { error: `Unknown option: ${terminalText(flag)}` };
    if (value === undefined) return { error: `${flag} needs a value` };
    if (field === 'theme' && !AUTH_BRANDING_THEMES.includes(value)) {
      return { error: `--theme takes one of ${AUTH_BRANDING_THEMES.join(', ')}` };
    }
    fields[field] = value;
    i += 1;
  }
  for (const field of clears) {
    if (field in fields) return { error: `${field} is both set and cleared` };
  }
  if (Object.keys(fields).length === 0 && clears.length === 0) {
    return { error: 'set needs at least one field to set or clear' };
  }
  return { fields, clears, ...(ifRevision === undefined ? {} : { ifRevision }) };
}

/**
 * The body of `PUT …/branding` from the brand the panel holds (`current`,
 * null for none) and the parsed `set` arguments: every field the panel
 * takes, unnamed ones kept as they are, cleared ones null, and
 * `ifRevision` — the one given, else the revision read, so a change made
 * elsewhere between the read and the write is refused. A domain without
 * a brand needs `--name`.
 *
 * @param {{ name: string, tagline: string | null, theme: string, accent: string | null, supportEmail: string | null, supportUrl: string | null, revision: number } | null} current
 * @param {{ fields: Record<string, string>, clears: string[], ifRevision?: number }} parsed
 * @returns {{ body: Record<string, unknown> } | { error: string }}
 */
export function brandingSetBody(current, parsed) {
  if (!current && !('name' in parsed.fields)) {
    return { error: 'The domain has no brand yet: give it a name with --name' };
  }
  const body = {
    name: current?.name ?? '',
    tagline: current?.tagline ?? null,
    theme: current?.theme ?? 'light',
    accent: current?.accent ?? null,
    supportEmail: current?.supportEmail ?? null,
    supportUrl: current?.supportUrl ?? null,
    ...parsed.fields,
  };
  for (const field of parsed.clears) body[field] = null;
  const revision = parsed.ifRevision ?? current?.revision;
  if (Number.isSafeInteger(revision) && revision > 0) body.ifRevision = revision;
  return { body };
}

/**
 * Why a file cannot be sent as the `kind` asset, or null when it can:
 * empty, or over the limit (named — the panel would refuse it 413). The
 * bytes themselves are checked by the panel (PNG header, ICO directory).
 *
 * @param {'logo' | 'favicon'} kind
 * @param {number} bytes  the file's size
 */
export function assetFileProblem(kind, bytes) {
  const asset = BRAND_ASSETS[kind];
  if (!asset) return 'Not a brand asset';
  if (!Number.isFinite(bytes) || bytes <= 0) return `The ${kind} file is empty`;
  if (bytes > asset.maxBytes) {
    return `The ${kind} is larger than ${sizeText(asset.maxBytes)} (the file is ${sizeText(bytes)}; ${asset.what} of at most ${sizeText(asset.maxBytes)})`;
  }
  return null;
}

/** An asset as the view shows it, in one line: `PNG 512×512, 12.3 KiB, sha256 ab12…`. */
export function assetLine(asset) {
  if (!asset) return 'not set';
  const parts = [];
  if (asset.format) parts.push(String(asset.format).toUpperCase());
  if (Number.isInteger(asset.width) && Number.isInteger(asset.height)) {
    parts.push(`${asset.width}×${asset.height}`);
  }
  const head = parts.join(' ');
  const size = sizeText(asset.bytes);
  const digest = typeof asset.sha256 === 'string' ? `sha256 ${asset.sha256.slice(0, 16)}…` : '';
  return [head, size, digest].filter(Boolean).join(', ') || 'set';
}

/**
 * The brand in lines — `label: value`, as terminal text — for
 * `domains branding <domain>`: the fields, the assets, the revision and
 * the rendering's state.
 *
 * @param {Record<string, any>} view  as `GET …/branding` answers it
 * @param {number} now  epoch ms, for "updated 12m ago"
 * @returns {Array<[string, string]>}
 */
export function brandingLines(view, now = Date.now()) {
  const unset = '—';
  const rendered =
    view.renderedCurrent === true
      ? 'current'
      : view.rendered
        ? `revision ${view.rendered.revision} from Authelia ${view.rendered.autheliaVersion} (this revision is rendered within a minute)`
        : 'not yet (rendered within a minute)';
  const lines = [
    ['name', view.name],
    ['tagline', view.tagline ?? unset],
    ['theme', view.theme],
    ['accent', view.accent ?? unset],
    ['support e-mail', view.supportEmail ?? unset],
    ['support URL', view.supportUrl ?? unset],
    ['logo', assetLine(view.logo)],
    ['favicon', assetLine(view.favicon)],
    ['revision', `${view.revision} (updated ${formatMoment(view.updatedAt, now)})`],
    ['rendered', rendered],
  ];
  return lines.map(([label, value]) => [label, terminalText(value)]);
}

/** The preview in lines, for `domains branding <domain> preview` (the CSS is printed after them). */
export function previewLines(preview) {
  return [
    ['title', preview.title],
    ['footer', `${preview.footer} (hidden on the sign-in: the "Powered by" link is not shown)`],
    ['theme', preview.theme],
    ['logo', preview.logo ? 'served at /static/media/logo.png' : 'none (the generic icon)'],
    ['favicon', preview.favicon ? 'served at /favicon.ico' : "none (Authelia's)"],
  ].map(([label, value]) => [label, terminalText(value)]);
}

/** A refused image's `reason` in words, or null for one the CLI does not know (the panel's message says it). */
function imageReasonText(kind, reason) {
  const asset = BRAND_ASSETS[kind];
  switch (reason) {
    case 'empty':
      return `The ${kind} file is empty`;
    case 'too_large':
      return `The ${kind} is larger than ${sizeText(asset.maxBytes)}`;
    case 'not_png':
      return 'The logo must be a PNG — no SVG, no JPEG';
    case 'not_ico_or_png':
      return 'The favicon must be an ICO or a PNG — no SVG';
    case 'not_base64':
      return `The ${kind} did not arrive as base64`;
    case 'bad_image':
      return `The ${kind} is larger than allowed (pixels a side) or not a whole image`;
    default:
      return null;
  }
}

/**
 * A refused brand read or change in words: the headline and the lines
 * that say what to do — `invalid_branding` lists the refused fields by
 * name, `invalid_image` the reason, `asset_too_large` the limit,
 * `no_branding`, `revision_mismatch` the current revision,
 * `authelia_unavailable`. Never a value (the panel's messages hold none),
 * every line as {@link terminalText}.
 *
 * @param {Error & { code?: string, errors?: Array<{ field: string, message: string }>, reason?: string, revision?: number }} err
 * @param {string} domain
 * @param {'logo' | 'favicon'} [kind]  the asset of an image refusal
 * @returns {{ message: string, details: string[] }}
 */
export function explainBrandingRefusal(err, domain, kind = 'logo') {
  const details = [];
  let message = err.message;
  switch (err.code) {
    case 'invalid_branding':
      message = 'The brand fields are not valid';
      for (const entry of Array.isArray(err.errors) ? err.errors : []) {
        if (typeof entry?.message !== 'string') continue;
        details.push(entry.field ? `${entry.field}: ${entry.message}` : entry.message);
      }
      if (details.length === 0) details.push(err.message);
      break;
    case 'invalid_image':
      message = imageReasonText(kind, err.reason) ?? err.message;
      break;
    case 'asset_too_large':
      message = imageReasonText(kind, 'too_large');
      break;
    case 'no_branding':
      message = `Domain '${domain}' has no brand yet`;
      details.push(
        `Give it a name first: lamaste-server domains branding ${domain} set --name <name>`,
      );
      break;
    case 'revision_mismatch':
      message = `The brand of '${domain}' changed since it was read${Number.isInteger(err.revision) ? ` (it is at revision ${err.revision})` : ''}; nothing was saved`;
      details.push(
        `Read it again (lamaste-server domains branding ${domain}) and run the command again — or pass --if-revision with the revision you mean to change.`,
      );
      break;
    case 'authelia_unavailable':
      message = "Authelia's texts could not be read, so there is no preview";
      details.push(
        'The brand itself is saved; try again once Authelia answers (systemctl status authelia).',
      );
      break;
    case 'unknown_domain':
      message = `'${domain}' is not a domain of this relay`;
      details.push('See them with: lamaste-server domains list');
      break;
    default:
      break;
  }
  return { message: terminalText(message), details: details.map(terminalText) };
}

/** A change's warning (`{ step, message }` or a sentence) as one line of terminal text. */
export function warningLine(warning) {
  if (typeof warning === 'string') return terminalText(warning);
  if (warning && typeof warning === 'object' && typeof warning.message === 'string') {
    return terminalText(warning.step ? `${warning.step}: ${warning.message}` : warning.message);
  }
  return terminalText(String(warning));
}
