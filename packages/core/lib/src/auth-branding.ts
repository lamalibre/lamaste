/**
 * Per-domain branding of the auth pages (packages/core/docs/auth-branding-design.md):
 * the brand record's fields and their rules, the image checks, and the
 * rendering a visitor receives — the files nginx serves from
 * `/var/www/lamaste/auth/<domain>/` for the three routes Authelia lets a
 * file override (`/favicon.ico`, `/static/media/logo.png`,
 * `/locales/<lang>/<namespace>.json`), the stylesheet, and `brand.json`
 * for Lamaste's own pages.
 *
 * Browser-safe (no node built-ins): the panel's branding form validates
 * with the same rules the relay enforces, so no client keeps a copy of
 * one. The relay's side — the rendered directory, Authelia's locale
 * list — is `server/auth-branding-store.ts`.
 *
 * Nothing here is free-form. Every byte a visitor of `auth.<domain>` gets
 * from the brand is rendered from a validated field: a name that can carry
 * no tag or interpolation, a colour that matches a regex, an image whose
 * header was parsed. No CSS, HTML or SVG of the operator's ever reaches
 * the sign-in origin.
 *
 * **Authelia 4.39.28's theme contract** (`web/src/themes/tailwind-themes.css`,
 * pinned by a unit test against a fixture of that file): each theme is a
 * set of CSS custom properties on `[data-theme="<theme>"]`, applied by the
 * portal to `<html>` (`document.documentElement.dataset.theme`, resolved —
 * `auto` becomes `light` or `dark`). {@link renderBrandCss} sets, from
 * `accent`, on `[data-theme]` with `!important` (so it wins over every
 * theme's own value whatever the resolved theme):
 *
 * - `--primary` — buttons, links, the active state of controls;
 * - `--primary-foreground` — the text on them, black or white by the
 *   accent's luminance;
 * - `--ring` — focus rings;
 * - `--custom-icon` — the generic user icon shown when no logo is served;
 * - `--custom-loading-bar` — the loading bar.
 *
 * `--secondary` is left to the theme. The footer link to authelia.com
 * (`web/src/components/Brand.tsx`: "Powered by Authelia", the href
 * decoded from `EncodedURL` = `https://www.authelia.com`) is hidden with
 * `a[href^="https://www.authelia.com"] { display: none }` (decision D3).
 *
 * **Authelia's texts** come from `/locales/<lang>/<namespace>.json`
 * (i18next): the brand-bearing values interpolate `{{authelia}}` from a
 * constant ("Login - {{authelia}}", "Powered by {{authelia}}",
 * "Settings - {{authelia}}"). {@link renderBrandLocale} splices the brand
 * name into every string value that carries the placeholder and keeps
 * everything else verbatim, so a Turkish visitor still reads Turkish.
 */

import { LETSENCRYPT_EMAIL_REGEX } from './constants.js';

// ---------------------------------------------------------------------------
// Limits and rules
// ---------------------------------------------------------------------------

/** Authelia's themes (`theme` in its configuration; `data-theme` on the page). */
export const AUTH_BRANDING_THEMES = ['light', 'dark', 'grey', 'oled', 'auto'] as const;

export type BrandTheme = (typeof AUTH_BRANDING_THEMES)[number];

export const AUTH_BRANDING_NAME_MAX_LENGTH = 64;
export const AUTH_BRANDING_TAGLINE_MAX_LENGTH = 160;
export const AUTH_BRANDING_SUPPORT_URL_MAX_LENGTH = 512;

/** The logo: a PNG of at most this many bytes … */
export const AUTH_BRANDING_LOGO_MAX_BYTES = 512 * 1024;
/** … and at most this many pixels a side. */
export const AUTH_BRANDING_LOGO_MAX_DIMENSION = 1024;
/** The favicon: an ICO or a PNG of at most this many bytes … */
export const AUTH_BRANDING_FAVICON_MAX_BYTES = 64 * 1024;
/** … and, as a PNG, at most this many pixels a side (an ICO entry is 256 at most by its format). */
export const AUTH_BRANDING_FAVICON_MAX_DIMENSION = 256;

/** `#rrggbb`, lower case. */
export const AUTH_BRANDING_ACCENT_RE = /^#[0-9a-f]{6}$/;

/**
 * What a brand text may not carry: control characters (C0, DEL, C1),
 * bidirectional and other invisible format characters (a name that reads
 * one way and renders another), and the four characters that could be a
 * tag or an interpolation in Authelia's translation strings, some of which
 * carry `<policy>` tags and `{{…}}` placeholders.
 */
// eslint-disable-next-line no-control-regex
const BRAND_TEXT_FORBIDDEN_RE = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁠⁦-⁩﻿<>{}]/u;

/** Why a brand text is refused, or null when it is fine. Never echoes the text. */
export function brandTextProblem(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return 'must be a string';
  if (value !== value.trim()) return 'must not start or end with whitespace';
  if (value.length === 0) return 'must not be empty';
  if (value.length > maxLength) return `must be at most ${maxLength} characters`;
  if (BRAND_TEXT_FORBIDDEN_RE.test(value)) {
    return 'must not contain control, bidirectional or invisible characters, or < > { }';
  }
  return null;
}

/** Why a support URL is refused, or null: `https:` only, no credentials, at most 512 characters. */
export function brandSupportUrlProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  if (value.length === 0) return 'must not be empty';
  if (value.length > AUTH_BRANDING_SUPPORT_URL_MAX_LENGTH) {
    return `must be at most ${AUTH_BRANDING_SUPPORT_URL_MAX_LENGTH} characters`;
  }
  if (BRAND_TEXT_FORBIDDEN_RE.test(value) || /\s/u.test(value)) {
    return 'must not contain whitespace, control or invisible characters, or < > { }';
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'must be an absolute https:// URL';
  }
  if (url.protocol !== 'https:') return 'must be an https:// URL';
  if (url.username !== '' || url.password !== '') return 'must not carry credentials';
  if (url.hostname === '') return 'must name a host';
  return null;
}

// ---------------------------------------------------------------------------
// The brand record
// ---------------------------------------------------------------------------

/** The fields of a domain's brand, as stored and as the API takes them. */
export interface BrandFields {
  /** The brand's name — "Code Lama": the browser title, the footer, Lamaste's own pages. */
  readonly name: string;
  /** Under the name on Lamaste's own pages (the invitation and refusal pages). */
  readonly tagline: string | null;
  /** Authelia's theme for the domain's sign-in. */
  readonly theme: BrandTheme;
  /** `#rrggbb`: buttons, focus rings, links. */
  readonly accent: string | null;
  /** Shown on refusal pages (else Gatekeeper's `adminEmail`). */
  readonly supportEmail: string | null;
  /** `https:` only. */
  readonly supportUrl: string | null;
}

export const BRAND_FIELD_NAMES = [
  'name',
  'tagline',
  'theme',
  'accent',
  'supportEmail',
  'supportUrl',
] as const;

export type BrandFieldName = (typeof BRAND_FIELD_NAMES)[number];

/** One refused field — the field's name and why, never its value. */
export interface BrandFieldError {
  readonly field: string;
  readonly message: string;
}

export type BrandFieldsValidation =
  | { readonly ok: true; readonly value: BrandFields }
  | { readonly ok: false; readonly errors: readonly BrandFieldError[] };

/**
 * Validate the fields of a brand as the API takes them: `name` required,
 * the others optional (absent or null = unset; `theme` defaults to
 * `light`). Unknown fields are refused. The result never echoes a value
 * — a message names the rule, the form shows it beside the field.
 */
export function validateBrandFields(input: unknown): BrandFieldsValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: '', message: 'must be an object' }] };
  }
  const record = input as Record<string, unknown>;
  const errors: BrandFieldError[] = [];
  const known = new Set<string>(BRAND_FIELD_NAMES);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) errors.push({ field: key, message: 'is not a brand field' });
  }

  const nameProblem = brandTextProblem(record.name, AUTH_BRANDING_NAME_MAX_LENGTH);
  if (nameProblem) errors.push({ field: 'name', message: nameProblem });

  const optionalText = (field: 'tagline', maxLength: number): string | null => {
    const value = record[field];
    if (value === undefined || value === null) return null;
    const problem = brandTextProblem(value, maxLength);
    if (problem) errors.push({ field, message: problem });
    return typeof value === 'string' ? value : null;
  };
  const tagline = optionalText('tagline', AUTH_BRANDING_TAGLINE_MAX_LENGTH);

  let theme: BrandTheme = 'light';
  if (record.theme !== undefined && record.theme !== null) {
    if (
      typeof record.theme === 'string' &&
      (AUTH_BRANDING_THEMES as readonly string[]).includes(record.theme)
    ) {
      theme = record.theme as BrandTheme;
    } else {
      errors.push({ field: 'theme', message: `must be one of ${AUTH_BRANDING_THEMES.join(', ')}` });
    }
  }

  let accent: string | null = null;
  if (record.accent !== undefined && record.accent !== null) {
    if (typeof record.accent === 'string' && AUTH_BRANDING_ACCENT_RE.test(record.accent)) {
      accent = record.accent;
    } else {
      errors.push({ field: 'accent', message: 'must be a colour as #rrggbb (lower case)' });
    }
  }

  let supportEmail: string | null = null;
  if (record.supportEmail !== undefined && record.supportEmail !== null) {
    if (
      typeof record.supportEmail === 'string' &&
      LETSENCRYPT_EMAIL_REGEX.test(record.supportEmail)
    ) {
      supportEmail = record.supportEmail;
    } else {
      errors.push({ field: 'supportEmail', message: 'must be an e-mail address' });
    }
  }

  let supportUrl: string | null = null;
  if (record.supportUrl !== undefined && record.supportUrl !== null) {
    const problem = brandSupportUrlProblem(record.supportUrl);
    if (problem) errors.push({ field: 'supportUrl', message: problem });
    else supportUrl = record.supportUrl as string;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name: record.name as string, tagline, theme, accent, supportEmail, supportUrl },
  };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** What an image check found. */
export type BrandImageInspection =
  | {
      readonly ok: true;
      readonly format: 'png' | 'ico';
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
    }
  | { readonly ok: false; readonly reason: BrandImageRefusal; readonly message: string };

export type BrandImageRefusal = 'empty' | 'too_large' | 'not_png' | 'not_ico_or_png' | 'bad_image';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

function endsWith(bytes: Uint8Array, suffix: readonly number[]): boolean {
  if (bytes.length < suffix.length) return false;
  const offset = bytes.length - suffix.length;
  return suffix.every((b, i) => bytes[offset + i] === b);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * The width and height of a PNG from its signature and IHDR chunk, or null
 * when the bytes are not a whole PNG (signature, IHDR first, IEND last).
 */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 8 + 25 + 12) return null;
  // Chunk 1 at offset 8: length (13), type 'IHDR', width, height, …
  if (u32be(bytes, 8) !== 13) return null;
  if (!(bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52)) {
    return null;
  }
  if (!endsWith(bytes, PNG_IEND)) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/**
 * Check the bytes of a logo: a PNG — signature, IHDR width and height, IEND
 * — of at most {@link AUTH_BRANDING_LOGO_MAX_BYTES} and at most
 * {@link AUTH_BRANDING_LOGO_MAX_DIMENSION} pixels a side. Anything else is
 * refused, SVG explicitly: a script carrier on the sign-in origin.
 */
export function inspectBrandLogo(bytes: Uint8Array): BrandImageInspection {
  if (bytes.length === 0) return { ok: false, reason: 'empty', message: 'The logo is empty' };
  if (bytes.length > AUTH_BRANDING_LOGO_MAX_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      message: `The logo is larger than ${AUTH_BRANDING_LOGO_MAX_BYTES / 1024} KiB`,
    };
  }
  const dims = pngDimensions(bytes);
  if (!dims) {
    return { ok: false, reason: 'not_png', message: 'The logo must be a PNG (no SVG, no JPEG)' };
  }
  if (
    dims.width > AUTH_BRANDING_LOGO_MAX_DIMENSION ||
    dims.height > AUTH_BRANDING_LOGO_MAX_DIMENSION
  ) {
    return {
      ok: false,
      reason: 'bad_image',
      message: `The logo must be at most ${AUTH_BRANDING_LOGO_MAX_DIMENSION} pixels a side`,
    };
  }
  return { ok: true, format: 'png', width: dims.width, height: dims.height, bytes: bytes.length };
}

/** An ICO directory: reserved 0, type 1 (icon), one entry at least, each entry's image inside the file. */
function icoDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 6 + 16) return null;
  if (u16le(bytes, 0) !== 0 || u16le(bytes, 2) !== 1) return null;
  const count = u16le(bytes, 4);
  if (count === 0 || count > 64) return null;
  const directoryEnd = 6 + 16 * count;
  if (bytes.length < directoryEnd) return null;
  let best: { width: number; height: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + 16 * i;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const size = u32le(bytes, entry + 8);
    const offset = u32le(bytes, entry + 12);
    if (size === 0 || offset < directoryEnd || offset + size > bytes.length) return null;
    if (!best || width * height > best.width * best.height) best = { width, height };
  }
  return best;
}

/**
 * Check the bytes of a favicon: an ICO (a valid directory, every entry's
 * image inside the file) or a PNG, of at most
 * {@link AUTH_BRANDING_FAVICON_MAX_BYTES}; a PNG at most
 * {@link AUTH_BRANDING_FAVICON_MAX_DIMENSION} pixels a side. The
 * dimensions reported are the largest entry's.
 */
export function inspectBrandFavicon(bytes: Uint8Array): BrandImageInspection {
  if (bytes.length === 0) return { ok: false, reason: 'empty', message: 'The favicon is empty' };
  if (bytes.length > AUTH_BRANDING_FAVICON_MAX_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      message: `The favicon is larger than ${AUTH_BRANDING_FAVICON_MAX_BYTES / 1024} KiB`,
    };
  }
  const png = pngDimensions(bytes);
  if (png) {
    if (
      png.width > AUTH_BRANDING_FAVICON_MAX_DIMENSION ||
      png.height > AUTH_BRANDING_FAVICON_MAX_DIMENSION
    ) {
      return {
        ok: false,
        reason: 'bad_image',
        message: `A PNG favicon must be at most ${AUTH_BRANDING_FAVICON_MAX_DIMENSION} pixels a side`,
      };
    }
    return { ok: true, format: 'png', width: png.width, height: png.height, bytes: bytes.length };
  }
  const ico = icoDimensions(bytes);
  if (ico)
    return { ok: true, format: 'ico', width: ico.width, height: ico.height, bytes: bytes.length };
  return {
    ok: false,
    reason: 'not_ico_or_png',
    message: 'The favicon must be an ICO or a PNG (no SVG)',
  };
}

// ---------------------------------------------------------------------------
// The rendering: where it lives and what it holds
// ---------------------------------------------------------------------------

/** Where the rendered brands live: one directory per domain under it. */
export const AUTH_BRANDING_WEB_ROOT = '/var/www/lamaste/auth';

/** The files of a rendered brand, relative to the domain's directory. */
export const AUTH_BRANDING_FILES = Object.freeze({
  /** Served for `/favicon.ico` when set (ICO or PNG bytes, content type by the extension). */
  favicon: 'favicon.ico',
  /** Served for `/static/media/logo.png` when set. */
  logo: 'static/media/logo.png',
  /** The generated stylesheet ({@link renderBrandCss}). */
  css: 'brand.css',
  /** The brand for Lamaste's own pages (Gatekeeper, the invitation page) — {@link renderBrandJson}. */
  brand: 'brand.json',
  /** What was rendered: revision and Authelia version ({@link RenderedBrand}). */
  rendered: 'rendered.json',
});

/** Where Authelia's locale files are rendered: `locales/<locale>/<namespace>.json`. */
export const AUTH_BRANDING_LOCALES_DIR = 'locales';

/**
 * A locale as Authelia routes it: `[a-z]{1,3}` with an optional
 * `-<variant>` (`en`, `tr`, `tr-TR`, `zh-CN`, `srp`, `fil-PH`) — the
 * patterns of `/locales/{language}[-{variant}]/{namespace}.json` in
 * `internal/server/handlers.go`.
 */
export const AUTHELIA_LOCALE_RE = /^[a-z]{1,3}(-[a-zA-Z0-9-]{1,24})?$/;
/** A namespace as Authelia routes it (`portal`, `settings`, `consent`). */
export const AUTHELIA_LOCALE_NAMESPACE_RE = /^[a-z]{1,32}$/;

/** The rendered path of one locale file, or a throw for a name Authelia would not route. */
export function authBrandingLocaleFile(locale: string, namespace: string): string {
  if (!AUTHELIA_LOCALE_RE.test(locale)) throw new Error(`Not an Authelia locale: "${locale}"`);
  if (!AUTHELIA_LOCALE_NAMESPACE_RE.test(namespace)) {
    throw new Error(`Not an Authelia locale namespace: "${namespace}"`);
  }
  return `${AUTH_BRANDING_LOCALES_DIR}/${locale}/${namespace}.json`;
}

/** `rendered.json`: what a domain's directory was rendered from. */
export interface RenderedBrand {
  readonly v: 1;
  /** The brand record's revision. */
  readonly revision: number;
  /** The Authelia release the locale files came from — a pin bump re-renders. */
  readonly autheliaVersion: string;
  readonly renderedAt: string;
}

/** `brand.json`, version 1: the brand as Lamaste's own pages read it. */
export interface BrandJson extends BrandFields {
  readonly v: 1;
  readonly domain: string;
  readonly revision: number;
  /** Whether `static/media/logo.png` is served, and its digest. */
  readonly logo: { readonly sha256: string } | null;
  /** Whether `favicon.ico` is served, and its digest. */
  readonly favicon: { readonly sha256: string } | null;
}

/** The interpolation Authelia's strings carry for its own name. */
export const AUTHELIA_NAME_PLACEHOLDER = '{{authelia}}';

/**
 * Authelia's locale file with the brand name in place of `{{authelia}}` in
 * every string value that carries it; every other key and value verbatim
 * (nested objects and arrays walked, non-strings never touched). The keys
 * — which are the English source strings, placeholder included — stay as
 * they are: i18next looks them up by key.
 */
export function renderBrandLocale<T>(embedded: T, brandName: string): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.includes(AUTHELIA_NAME_PLACEHOLDER)
        ? value.split(AUTHELIA_NAME_PLACEHOLDER).join(brandName)
        : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = walk(v);
      return out;
    }
    return value;
  };
  return walk(embedded) as T;
}

/** The custom properties `brand.css` sets from the accent (the pinned theme contract, see the module comment). */
export const BRAND_CSS_ACCENT_PROPERTIES = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--custom-icon',
  '--custom-loading-bar',
] as const;

/** The footer link `brand.css` hides (decision D3). */
export const BRAND_CSS_FOOTER_SELECTOR = 'a[href^="https://www.authelia.com"]';

/** WCAG relative luminance of `#rrggbb`. */
function relativeLuminance(accent: string): number {
  const channel = (hex: string): number => {
    const c = parseInt(hex, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(accent.slice(1, 3)) +
    0.7152 * channel(accent.slice(3, 5)) +
    0.0722 * channel(accent.slice(5, 7))
  );
}

/**
 * The text colour on the accent: white on a dark accent, black on a light
 * one (the contrast against each, by WCAG's formula, decides).
 */
export function accentForeground(accent: string): '#000000' | '#ffffff' {
  const l = relativeLuminance(accent);
  // Contrast with white = 1.05 / (l + 0.05); with black = (l + 0.05) / 0.05.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#000000';
}

/**
 * The stylesheet of a brand, generated from its validated fields alone
 * (never authored): the accent's custom properties on `[data-theme]` when
 * an accent is set, and the hidden footer. Served as `/brand.css` on the
 * domain's sign-in; Authelia's CSP allows a same-origin stylesheet.
 */
export function renderBrandCss(brand: Pick<BrandFields, 'accent'>): string {
  const lines = ['/* Generated by Lamaste from the domain’s brand. Not edited by hand. */'];
  if (brand.accent !== null) {
    if (!AUTH_BRANDING_ACCENT_RE.test(brand.accent)) {
      throw new Error('An accent is a colour as #rrggbb');
    }
    const foreground = accentForeground(brand.accent);
    const values: Record<(typeof BRAND_CSS_ACCENT_PROPERTIES)[number], string> = {
      '--primary': brand.accent,
      '--primary-foreground': foreground,
      '--ring': brand.accent,
      '--custom-icon': brand.accent,
      '--custom-loading-bar': brand.accent,
    };
    lines.push('[data-theme] {');
    for (const property of BRAND_CSS_ACCENT_PROPERTIES) {
      lines.push(`  ${property}: ${values[property]} !important;`);
    }
    lines.push('}');
  }
  lines.push(`${BRAND_CSS_FOOTER_SELECTOR} { display: none !important; }`);
  return `${lines.join('\n')}\n`;
}

/** `brand.json` of a domain's brand. */
export function renderBrandJson(
  domain: string,
  brand: BrandFields,
  revision: number,
  assets: { readonly logoSha256: string | null; readonly faviconSha256: string | null },
): BrandJson {
  return {
    v: 1,
    domain,
    revision,
    name: brand.name,
    tagline: brand.tagline,
    theme: brand.theme,
    accent: brand.accent,
    supportEmail: brand.supportEmail,
    supportUrl: brand.supportUrl,
    logo: assets.logoSha256 ? { sha256: assets.logoSha256 } : null,
    favicon: assets.faviconSha256 ? { sha256: assets.faviconSha256 } : null,
  };
}
