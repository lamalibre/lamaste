/**
 * A domain's brand on its auth pages, in the panel's words — the Branding
 * section of the Domains page (packages/core/docs/auth-branding-design.md).
 * Pure: the form's state from the brand the panel holds, the request a form
 * makes, the pre-checks of a logo or favicon file, the model of the
 * sign-in preview, and refusals in words. The rules and limits are core's
 * (`@lamalibre/lamaste/branding`), never copied here. Nothing here calls
 * the panel, and no message ever carries a value of the form.
 */

import {
  AUTH_BRANDING_FAVICON_MAX_BYTES,
  AUTH_BRANDING_LOGO_MAX_BYTES,
  AUTH_BRANDING_THEMES,
  BRAND_FIELD_NAMES,
  accentForeground,
  validateBrandFields,
} from '@lamalibre/lamaste/branding';

import { errorMessage, refusalOf } from './errorMessage.js';
import { explainDomainRefusal } from './domains.js';
import { warningText } from './identity.js';

/** The two assets a brand carries: their limits and what the file input takes. */
export const BRAND_ASSETS = Object.freeze({
  logo: Object.freeze({
    label: 'Logo',
    maxBytes: AUTH_BRANDING_LOGO_MAX_BYTES,
    accept: 'image/png',
    hint: 'A PNG of at most 512 KiB and 1024 pixels a side. No SVG.',
  }),
  favicon: Object.freeze({
    label: 'Favicon',
    maxBytes: AUTH_BRANDING_FAVICON_MAX_BYTES,
    accept: '.ico,image/png,image/x-icon,image/vnd.microsoft.icon',
    hint: 'An ICO, or a PNG of at most 256 pixels a side; at most 64 KiB. No SVG.',
  }),
});

/** Where a brand reaches, in one sentence (shown on the section). */
export const BRAND_REACH =
  'The brand reaches every page a visitor of the domain can meet: the sign-in at auth.<domain> (its title, logo, favicon, theme and accent; the "Powered by Authelia" footer is hidden), the invitation page, and the access-request and refusal pages on the domain’s hosts.';

/** A theme as the select shows it. */
export const THEME_LABELS = Object.freeze({
  light: 'light',
  dark: 'dark',
  grey: 'grey',
  oled: 'OLED (black)',
  auto: 'auto (the visitor’s preference)',
});

/** The empty form, for a domain without a brand. */
const EMPTY_FORM = Object.freeze({
  name: '',
  tagline: '',
  theme: 'light',
  accent: '',
  supportEmail: '',
  supportUrl: '',
});

/**
 * The form's state from the brand the panel holds (`GET …/branding`), or
 * the empty form for null: every field a string (an unset one empty).
 *
 * @param {{ name: string, tagline: string | null, theme: string, accent: string | null, supportEmail: string | null, supportUrl: string | null } | null | undefined} view
 */
export function brandFormFrom(view) {
  if (!view) return { ...EMPTY_FORM };
  return {
    name: view.name ?? '',
    tagline: view.tagline ?? '',
    theme: AUTH_BRANDING_THEMES.includes(view.theme) ? view.theme : 'light',
    accent: view.accent ?? '',
    supportEmail: view.supportEmail ?? '',
    supportUrl: view.supportUrl ?? '',
  };
}

/**
 * The brand fields a form asks for: trimmed, an empty optional field null,
 * the accent lower-cased (the rule is `#rrggbb` in lower case; a colour
 * input gives it so, a hand-typed `#ABCDEF` means the same colour).
 *
 * @param {ReturnType<typeof brandFormFrom>} form
 */
export function brandFieldsOf(form) {
  const text = (value) => {
    const trimmed = String(value ?? '').trim();
    return trimmed === '' ? null : trimmed;
  };
  const accent = text(form.accent);
  return {
    name: String(form.name ?? '').trim(),
    tagline: text(form.tagline),
    theme: form.theme,
    accent: accent === null ? null : accent.toLowerCase(),
    supportEmail: text(form.supportEmail),
    supportUrl: text(form.supportUrl),
  };
}

/**
 * The body of `PUT …/branding` from a form: the fields, and `ifRevision`
 * when the brand was read at a revision (a change over one not seen is
 * refused `revision_mismatch`; a new brand has none).
 *
 * @param {ReturnType<typeof brandFormFrom>} form
 * @param {number | null | undefined} revision
 */
export function brandRequest(form, revision) {
  return {
    ...brandFieldsOf(form),
    ...(Number.isSafeInteger(revision) && revision > 0 ? { ifRevision: revision } : {}),
  };
}

/**
 * What core refuses about a form, by field — the same rules the relay
 * applies, so a refusal is shown beside the field before anything is
 * sent. `{}` when the fields are fine.
 *
 * @param {ReturnType<typeof brandFormFrom>} form
 * @returns {Record<string, string>}
 */
export function formProblems(form) {
  const validation = validateBrandFields(brandFieldsOf(form));
  return validation.ok ? {} : fieldErrorMap(validation.errors);
}

/** `[{ field, message }]` as a map; a field of `""` is the request as a whole (`_`); the first message per field. */
function fieldErrorMap(errors) {
  const map = {};
  for (const { field, message } of errors) {
    const key = field === '' ? '_' : field;
    if (!(key in map)) map[key] = message;
  }
  return map;
}

/**
 * The per-field messages of a refused brand (`invalid_branding`: the Error
 * carries `errors: [{ field, message }]`), as a map by field name — `_`
 * for the request as a whole — or `{}` when the error carries none.
 *
 * @param {unknown} err
 * @returns {Record<string, string>}
 */
export function fieldErrorsOf(err) {
  if (err === null || typeof err !== 'object' || !Array.isArray(err.errors)) return {};
  return fieldErrorMap(
    err.errors.filter((e) => typeof e?.field === 'string' && typeof e?.message === 'string'),
  );
}

/** `12.3 KiB` / `512 KiB` / `1.0 MiB` — a size in words. */
export function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${Number.isInteger(kib) ? kib : kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

/**
 * Why a chosen file cannot be sent as the `kind` asset, or null when it
 * can: empty, or over the limit (named, with the file's size — the relay
 * would refuse it 413). The bytes themselves are checked by the relay
 * (PNG header, ICO directory).
 *
 * @param {'logo' | 'favicon'} kind
 * @param {{ size: number } | null | undefined} file
 */
export function assetProblem(kind, file) {
  const asset = BRAND_ASSETS[kind];
  if (!asset) return 'Not a brand asset';
  if (!file) return 'Choose a file';
  if (!Number.isFinite(file.size) || file.size <= 0) return `The ${kind} file is empty`;
  if (file.size > asset.maxBytes) {
    return `The ${kind} is larger than ${sizeText(asset.maxBytes)} (the file is ${sizeText(file.size)})`;
  }
  return null;
}

/** The base64 of a data URL (`data:image/png;base64,…`), or null when it is not one. */
export function base64OfDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma === -1) return null;
  if (!dataUrl.slice(0, comma).endsWith(';base64')) return null;
  return dataUrl.slice(comma + 1);
}

/** An asset as the view shows it, in one line: `PNG 512×512, 12.3 KiB`. */
export function assetText(asset) {
  if (!asset) return 'not set';
  const parts = [];
  if (asset.format) parts.push(asset.format.toUpperCase());
  if (Number.isInteger(asset.width) && Number.isInteger(asset.height)) {
    parts.push(`${asset.width}×${asset.height}`);
  }
  const head = parts.join(' ');
  const size = sizeText(asset.bytes);
  return [head, size].filter(Boolean).join(', ') || 'set';
}

/**
 * The look of each of Authelia's themes, as Tailwind classes for the
 * preview: the page, the card, the text. `auto` previews as light (the
 * visitor's preference decides on the real page).
 */
const THEME_LOOKS = Object.freeze({
  light: {
    page: 'bg-white',
    card: 'bg-white border-zinc-200',
    text: 'text-zinc-900',
    muted: 'text-zinc-500',
    input: 'border-zinc-300 bg-white',
  },
  dark: {
    page: 'bg-zinc-900',
    card: 'bg-zinc-800 border-zinc-700',
    text: 'text-white',
    muted: 'text-zinc-400',
    input: 'border-zinc-600 bg-zinc-900',
  },
  grey: {
    page: 'bg-zinc-600',
    card: 'bg-zinc-700 border-zinc-500',
    text: 'text-white',
    muted: 'text-zinc-300',
    input: 'border-zinc-500 bg-zinc-600',
  },
  oled: {
    page: 'bg-black',
    card: 'bg-zinc-950 border-zinc-800',
    text: 'text-white',
    muted: 'text-zinc-400',
    input: 'border-zinc-700 bg-black',
  },
});

/** The logo's URL on the domain's sign-in, as the pages load it (`?r=` defeats a cached earlier logo). */
export function brandLogoUrl(domain, revision) {
  return `https://auth.${domain}/static/media/logo.png?r=${encodeURIComponent(String(revision))}`;
}

/**
 * The model of the sign-in preview: a mock of Authelia's card from the
 * form's current values, the panel's preview (`GET …/branding/preview`:
 * the `en` title and footer — null while there is none) and the brand the
 * panel holds. The logo is shown from `https://auth.<domain>/…` only when
 * the page would show it: the domain active, the rendering current, a
 * logo set; otherwise `logoNote` says why not.
 *
 * @param {ReturnType<typeof brandFormFrom>} form
 * @param {{ title: string, footer: string } | null | undefined} preview
 * @param {{ logo: object | null, revision: number, renderedCurrent: boolean } | null | undefined} view
 * @param {{ name: string, status: string }} domain
 */
export function previewModel(form, preview, view, domain) {
  const fields = brandFieldsOf(form);
  const theme = fields.theme === 'auto' ? 'light' : fields.theme;
  const look = THEME_LOOKS[theme] ?? THEME_LOOKS.light;
  const name = fields.name || 'Your brand';
  const accentValid = fields.accent !== null && /^#[0-9a-f]{6}$/.test(fields.accent);
  const accent = accentValid ? fields.accent : null;
  const hasLogo = Boolean(view?.logo);
  const logoServed = hasLogo && domain.status === 'active' && view.renderedCurrent === true;
  let logoNote = null;
  if (!hasLogo) logoNote = 'No logo: the sign-in shows Authelia’s generic user icon.';
  else if (domain.status !== 'active') {
    logoNote = 'The logo is shown once the domain is active.';
  } else if (!logoServed) {
    logoNote = 'The logo is shown once the brand is rendered (within a minute).';
  }
  return {
    theme,
    themeNote: fields.theme === 'auto' ? 'auto — previewed as light' : fields.theme,
    ...look,
    accent,
    accentText: accent ? accentForeground(accent) : '#ffffff',
    title: preview?.title ?? `Login - ${name}`,
    footer: preview?.footer ?? `Powered by ${name}`,
    footerHidden: true,
    logoUrl: logoServed ? brandLogoUrl(domain.name, view.revision) : null,
    logoNote,
    name,
  };
}

/** A refused image's `reason` in words (the relay's message says the same; the reason is the stable part). */
export function imageReasonText(kind, reason) {
  switch (reason) {
    case 'empty':
      return `The ${kind} file is empty`;
    case 'too_large':
      return `The ${kind} is larger than ${sizeText(BRAND_ASSETS[kind]?.maxBytes ?? 0)}`;
    case 'not_png':
      return 'The logo must be a PNG — no SVG, no JPEG';
    case 'not_ico_or_png':
      return 'The favicon must be an ICO or a PNG — no SVG';
    case 'not_base64':
      return `The ${kind} did not arrive as base64 — choose the file again`;
    case 'bad_image':
      return `The ${kind} is larger than allowed (pixels a side) or not a whole image`;
    default:
      return null;
  }
}

/**
 * A refused brand change in words — a line per refused field for
 * `invalid_branding`, the reason of a refused image, the limit of one too
 * large, a stale revision, Authelia not answering for the preview — and
 * every other refusal as a domain's. Never a value.
 *
 * @param {unknown} err
 * @param {'logo' | 'favicon'} [kind]  the asset of an image refusal
 */
export function explainBrandingRefusal(err, kind = 'logo') {
  const { code } = refusalOf(err);
  const message = errorMessage(err);
  switch (code) {
    case 'invalid_branding': {
      const lines = Object.entries(fieldErrorsOf(err)).map(([field, text]) =>
        field === '_' ? text : `${field} ${text}`,
      );
      return lines.length > 0 ? `${message}: ${lines.join('; ')}` : message;
    }
    case 'invalid_image':
      return imageReasonText(kind, err?.reason) ?? message;
    case 'asset_too_large':
      return imageReasonText(kind, 'too_large');
    case 'no_branding':
      return 'The domain has no brand yet — save its name first, then add the images.';
    case 'revision_mismatch':
      return `The brand changed elsewhere since it was read${Number.isInteger(err?.revision) ? ` (now revision ${err.revision})` : ''} — the form shows the current brand; make your change again.`;
    case 'authelia_unavailable':
      return `${message} — the preview needs Authelia; the brand itself is saved.`;
    default:
      return explainDomainRefusal(err);
  }
}

/** A change's warnings (`{ step, message }` or a sentence), one line each. */
export function warningLines(warnings) {
  return (warnings ?? []).map(warningText);
}

/** The brand field names, for a form that iterates them. */
export const BRAND_FIELDS = BRAND_FIELD_NAMES;
