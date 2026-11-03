/**
 * The "not available" page of a plugin's site (packages/core/docs/page-language-design.md
 * §2, P8): what a visitor of a plugin's web surface gets while the surface
 * is not served, in place of nginx's stock English 503. A static file —
 * `unavailable/index.html` of the domain's rendering, or the stock copy
 * (English, no brand) at `/var/www/lamaste/unavailable/index.html` for a
 * domain without one — that the web-surface vhost names in
 * `error_page 503`.
 *
 * It carries no script. It cannot link `/brand.css` — on the plugin's host
 * every path answers 503 — so its style is inline and **one text for every
 * brand and language** ({@link UNAVAILABLE_PAGE_STYLE}, one hash per
 * release): the stock dark look, with the brand's name and tagline in
 * markup and its logo from the domain's sign-in host, as Gatekeeper's pages
 * show it. Its CSP ({@link unavailablePageHeaders}) admits that style and
 * that logo and nothing else.
 */

import { assertDomainName } from '../domains.js';
import { isPageLanguage, pageMessage } from '../page-messages.js';
import type { PageLanguage } from '../page-messages.js';
import type { InviteBrand } from './auth-pages.js';
import { INVITE_PAGE_LOGO_PATH, cspHashSource, escapeHtml } from './auth-pages.js';

/** Where the stock page lives on the relay (English, no brand). */
export const UNAVAILABLE_PAGE_STOCK_DIR = '/var/www/lamaste/unavailable';

/** The page's one stylesheet — the same text for every brand and language. */
export const UNAVAILABLE_PAGE_STYLE = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #09090b; color: #a1a1aa;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #18181b; border: 1px solid #27272a; border-radius: 0.75rem;
      max-width: 520px; width: 100%; padding: 2.5rem; text-align: center;
    }
    .brand { margin-bottom: 2rem; }
    .brand-logo { max-width: 160px; max-height: 80px; margin-bottom: 0.75rem; }
    .brand-name { color: #f4f4f5; font-size: 1rem; font-weight: 700; }
    .brand-tagline { font-size: 0.8125rem; margin-top: 0.25rem; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { color: #f4f4f5; font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; line-height: 1.6; }
  `;

/** `'sha256-…'` of {@link UNAVAILABLE_PAGE_STYLE}, as the page's CSP names it. */
export const UNAVAILABLE_PAGE_STYLE_HASH = cspHashSource(UNAVAILABLE_PAGE_STYLE);

/** What the page shows of a domain's brand. */
export type UnavailablePageBrand = Pick<InviteBrand, 'name' | 'tagline' | 'logo'>;

/** The URL the page loads a domain's logo from: its sign-in host. */
export function unavailablePageLogoUrl(domain: string): string {
  assertDomainName(domain);
  return `https://auth.${domain}${INVITE_PAGE_LOGO_PATH}`;
}

/**
 * The headers the web-surface vhost sends with the page: a CSP admitting
 * its style by hash and, for a domain, images from its sign-in host only;
 * no caching, no framing. Printable ASCII, as everything in a vhost.
 */
export function unavailablePageHeaders(domain: string | null): Readonly<Record<string, string>> {
  if (domain !== null) assertDomainName(domain);
  const img = domain === null ? "'none'" : `https://auth.${domain}`;
  return Object.freeze({
    'Content-Security-Policy': [
      "default-src 'none'",
      `style-src ${UNAVAILABLE_PAGE_STYLE_HASH}`,
      `img-src ${img}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
}

/**
 * The page in `language`, for a domain's brand (its logo when it serves
 * one, from `https://auth.<domain>`), or the stock one (`brand` null).
 */
export function renderUnavailablePage(opts: {
  readonly brand: UnavailablePageBrand | null;
  readonly language: PageLanguage;
  readonly domain: string | null;
}): string {
  const { brand, language, domain } = opts;
  if (!isPageLanguage(language)) throw new Error('A page is rendered in a page language');
  if (domain !== null) assertDomainName(domain);
  if (brand?.logo && domain === null)
    throw new Error('A logo is loaded from a domain’s sign-in host');
  const title = pageMessage(language, 'unavailable.title');
  const header =
    brand === null
      ? ''
      : `
    <header class="brand">${
      brand.logo && domain !== null
        ? `
      <img class="brand-logo" src="${escapeHtml(unavailablePageLogoUrl(domain))}" alt="">`
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
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(brand === null ? 'Lamaste' : brand.name)} — ${escapeHtml(title)}</title>
  <style>${UNAVAILABLE_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">${header}
    <div class="icon">⏳</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(pageMessage(language, 'unavailable.text'))}</p>
  </div>
</body>
</html>
`;
}
