/**
 * What Lamaste's own pages on a domain's sign-in host share — the
 * invitation page (`/invite`, {@link renderInvitePage}) and the inviter's
 * page (`/invitations/<route>`, {@link renderInvitationsPage}): the shell
 * around their content, one inline stylesheet, and the response headers
 * nginx sends with them.
 *
 * The inline script and style of a page are **one text for every brand**:
 * what a brand changes is markup (the title, the header with its name,
 * tagline and logo) and `/brand.css`, which a branded page links and whose
 * `:root` block sets the pages' colours (`renderAuthPageThemeCss`). So each
 * page's Content-Security-Policy names its script and style by hash, fixed
 * per release, and a brand change never makes a hash stale.
 */

import crypto from 'node:crypto';

import { AUTH_PAGE_DARK_PALETTE, AUTH_PAGE_DEFAULT_ACCENT } from '../auth-branding.js';
import type { AuthPagePalette, BrandTheme } from '../auth-branding.js';

/** What the pages take from a domain's brand. */
export interface InviteBrand {
  readonly name: string;
  readonly tagline: string | null;
  readonly theme: BrandTheme;
  /** `#rrggbb`, or null for the default accent (only `/brand.css` carries it). */
  readonly accent: string | null;
  /** Whether the domain serves `/static/media/logo.png`. */
  readonly logo: boolean;
}

/** The pages' own path to the domain's logo (served by the auth vhost from the rendering). */
export const INVITE_PAGE_LOGO_PATH = '/static/media/logo.png';

/** The brand stylesheet a branded page links (the auth vhost serves it from the rendering). */
export const AUTH_PAGE_BRAND_CSS_PATH = '/brand.css';

/** `var(--lamaste-page-<name>, <the dark value>)`. */
function v(name: keyof AuthPagePalette | 'accent' | 'accent-foreground'): string {
  const fallback =
    name === 'accent'
      ? AUTH_PAGE_DEFAULT_ACCENT
      : name === 'accent-foreground'
        ? '#000000'
        : AUTH_PAGE_DARK_PALETTE[name];
  return `var(--lamaste-page-${name}, ${fallback})`;
}

/** The pages' one stylesheet: every colour a custom property with the dark value as its fallback. */
export const AUTH_PAGE_STYLE = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: ${v('background')}; color: ${v('text')};
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: ${v('card')}; border: 1px solid ${v('border')}; border-radius: 0.75rem;
      max-width: 520px; width: 100%; padding: 2.5rem;
    }
    .brand { text-align: center; margin-bottom: 2rem; }
    .brand-logo { max-width: 160px; max-height: 80px; margin-bottom: 0.75rem; }
    .brand-name { color: ${v('heading')}; font-size: 1rem; font-weight: 700; }
    .brand-tagline { font-size: 0.8125rem; margin-top: 0.25rem; }
    .icon { text-align: center; font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: ${v('heading')}; font-size: 1.25rem; text-align: center; margin-bottom: 0.5rem; }
    h2 { color: ${v('heading')}; font-size: 0.9375rem; margin: 2rem 0 0.75rem; }
    .subtitle { text-align: center; margin-bottom: 2rem; font-size: 0.875rem; line-height: 1.6; }
    .field { margin-bottom: 1.25rem; }
    .field label {
      display: block; font-size: 0.8125rem; color: ${v('text')};
      margin-bottom: 0.375rem; font-weight: 600;
    }
    .field input, .field select {
      width: 100%; padding: 0.625rem 0.875rem;
      background: ${v('input')}; border: 1px solid ${v('border')}; border-radius: 0.5rem;
      color: ${v('heading')}; font-family: inherit; font-size: 0.875rem;
      outline: none; transition: border-color 0.15s;
    }
    .field input:focus, .field select:focus { border-color: ${v('accent')}; }
    .field input:disabled, .field input[readonly] { color: ${v('disabled')}; }
    .field .hint { font-size: 0.75rem; color: ${v('hint')}; margin-top: 0.25rem; }
    .error-msg {
      background: ${v('error-background')}; border: 1px solid ${v('error-border')}; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 1.25rem;
      font-size: 0.8125rem; color: ${v('error-text')};
    }
    .note-msg {
      background: ${v('note-background')}; border-color: ${v('note-border')}; color: ${v('note-text')};
    }
    .success-card { text-align: center; }
    .success-card h1 { color: ${v('success')}; margin-bottom: 1rem; }
    .success-card p { margin-bottom: 1.5rem; font-size: 0.875rem; line-height: 1.6; }
    .accent { color: ${v('accent')}; }
    .btn {
      display: block; width: 100%;
      background: ${v('accent')}; color: ${v('accent-foreground')}; font-weight: 700;
      border: none; border-radius: 0.5rem; padding: 0.75rem;
      font-size: 0.875rem; cursor: pointer; font-family: inherit;
      transition: filter 0.15s;
    }
    .btn:hover { filter: brightness(0.92); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-link { text-decoration: none; text-align: center; margin-top: 1rem; }
    .btn-outline {
      background: transparent; border: 1px solid ${v('border')}; color: ${v('text')};
    }
    .btn-outline:hover { border-color: ${v('accent')}; color: ${v('heading')}; }
    .btn-small { display: inline-block; width: auto; padding: 0.25rem 0.625rem; font-size: 0.75rem; }
    .row { display: flex; gap: 0.5rem; }
    .row input { flex: 1; }
    .loading {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 3rem 0; font-size: 0.875rem;
    }
    .spinner {
      width: 1.25rem; height: 1.25rem;
      border: 2px solid ${v('border')}; border-top-color: ${v('accent')};
      border-radius: 50%; animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .detail-row {
      display: flex; justify-content: space-between; align-items: center; gap: 1rem;
      padding: 0.5rem 0; border-bottom: 1px solid ${v('border')};
      font-size: 0.8125rem;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: ${v('muted')}; }
    .detail-value { color: ${v('heading')}; font-weight: 500; text-align: right; word-break: break-all; }
    .details-box {
      background: ${v('input')}; border: 1px solid ${v('border')}; border-radius: 0.5rem;
      padding: 0.75rem 1rem; margin-bottom: 1.5rem;
    }
    .qr {
      display: flex; justify-content: center; margin: 0 auto 1.5rem;
      background: #fff; border-radius: 0.5rem; padding: 1rem; max-width: 220px;
    }
    .qr img { width: 100%; height: auto; }
    .manual { font-size: 0.75rem; color: ${v('hint')}; margin-bottom: 1rem; word-break: break-all; }
    .manual strong { color: ${v('text')}; }
    .muted { color: ${v('muted')}; font-size: 0.75rem; }
    .back { display: inline-block; margin-top: 1.5rem; font-size: 0.8125rem; color: ${v('accent')}; }
  `;

/** The page's markup around its content: the brand's title, header and stylesheet link. */
export function authPageShell(opts: {
  readonly brand: InviteBrand | null;
  readonly title: string;
  readonly loading: string;
  readonly script: string;
}): string {
  const { brand } = opts;
  const title =
    brand === null ? `Lamaste — ${opts.title}` : `${escapeHtml(brand.name)} — ${opts.title}`;
  const brandCss =
    brand === null ? '' : `\n  <link rel="stylesheet" href="${AUTH_PAGE_BRAND_CSS_PATH}">`;
  const header =
    brand === null
      ? ''
      : `
    <header class="brand">${
      brand.logo
        ? `
      <img class="brand-logo" src="${INVITE_PAGE_LOGO_PATH}" alt="">`
        : ''
    }
      <div class="brand-name">${escapeHtml(brand.name)}</div>${
        brand.tagline === null
          ? ''
          : `
      <div class="brand-tagline">${escapeHtml(brand.tagline)}</div>`
      }
    </header>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${AUTH_PAGE_STYLE}</style>${brandCss}
</head>
<body>
  <div class="card">${header}
    <div id="app">
      <div class="loading">
        <div class="spinner"></div>
        ${opts.loading}
      </div>
    </div>
  </div>
  <script>${opts.script}</script>
</body>
</html>
`;
}

/** `'sha256-<base64>'` of an inline element's exact text, as a CSP source. */
export function cspHashSource(text: string): string {
  return `'sha256-${crypto.createHash('sha256').update(text, 'utf-8').digest('base64')}'`;
}

/**
 * The response headers of a page whose only inline script is `script`: a
 * Content-Security-Policy naming it and the shared style by hash — nothing
 * else may run, nothing load from elsewhere, nothing frame it, nothing be
 * posted anywhere (the pages post with `fetch`, to their own host) — and
 * the headers that keep it out of other windows and caches.
 */
export function authPageHeaders(script: string): Readonly<Record<string, string>> {
  const csp = [
    "default-src 'none'",
    `script-src ${cspHashSource(script)}`,
    `style-src 'self' ${cspHashSource(AUTH_PAGE_STYLE)}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  return Object.freeze({
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // `no-referrer` would make a same-origin fetch POST send `Origin: null`.
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
