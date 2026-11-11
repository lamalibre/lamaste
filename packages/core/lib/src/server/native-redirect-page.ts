/**
 * The page an application host answers at a native client's redirect path
 * (packages/core/docs/native-apps-design.md D6). iOS and Android hand a
 * claimed HTTPS redirect to the app before anything loads; a browser that
 * still reaches the path — the app is not installed, or the system did not
 * hand it over — gets this page instead of the host's content: the sign-in
 * continues in the app.
 *
 * It is the "not available" page's sibling (`unavailable-page.ts`): no
 * script, the same one style for every brand and language (so the same CSP
 * hash), the domain's brand and language, and **nothing of the request** —
 * the query holds an authorization code, useless without the app's PKCE
 * verifier, and still never shown, linked or sent on (`Referrer-Policy:
 * no-referrer`, the vhost keeps it out of the access log).
 */

import { assertDomainName } from '../domains.js';
import { isPageLanguage, pageMessage } from '../page-messages.js';
import type { PageLanguage } from '../page-messages.js';
import { escapeHtml } from './auth-pages.js';
import {
  UNAVAILABLE_PAGE_STYLE,
  unavailablePageBrandHeader,
  unavailablePageHeaders,
} from './unavailable-page.js';
import type { UnavailablePageBrand } from './unavailable-page.js';

/**
 * The headers the host's vhost sends with the page: the "not available"
 * page's (its style by hash, the domain's logo, no caching, no framing) and
 * no referrer.
 */
export function nativeRedirectPageHeaders(domain: string | null): Readonly<Record<string, string>> {
  return Object.freeze({
    ...unavailablePageHeaders(domain),
    'Referrer-Policy': 'no-referrer',
  });
}

/**
 * The page in `language`, for a domain's brand (its logo from
 * `https://auth.<domain>` when it serves one), or the stock one (`brand`
 * null). Pure.
 */
export function renderNativeRedirectPage(opts: {
  readonly brand: UnavailablePageBrand | null;
  readonly language: PageLanguage;
  readonly domain: string | null;
}): string {
  const { brand, language, domain } = opts;
  if (!isPageLanguage(language)) throw new Error('A page is rendered in a page language');
  if (domain !== null) assertDomainName(domain);
  if (brand?.logo && domain === null) {
    throw new Error('A logo is loaded from a domain’s sign-in host');
  }
  const title = pageMessage(language, 'nativeRedirect.title');
  const header = unavailablePageBrandHeader(brand, domain);
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(brand === null ? 'Lamaste' : brand.name)} — ${escapeHtml(title)}</title>
  <style>${UNAVAILABLE_PAGE_STYLE}</style>
</head>
<body>
  <div class="card">${header}
    <div class="icon">📱</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(pageMessage(language, 'nativeRedirect.text'))}</p>
  </div>
</body>
</html>
`;
}
