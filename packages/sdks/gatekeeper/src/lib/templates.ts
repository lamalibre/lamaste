import {
  AUTH_BRANDING_ACCENT_RE,
  brandSupportUrlProblem,
  formatMessage,
  formatMessageHtml,
  pageMessage,
} from '@lamalibre/lamaste';
import type { PageLanguage, PageMessageKey } from '@lamalibre/lamaste';
import type { AccessRequestTemplates, PageBrand, TemplateOptions } from './types.js';

/**
 * The language a page speaks: its domain's (`options.language`, from the
 * panel's projection), English when the domain has none or the host is
 * under no domain.
 */
function pageLanguage(options: TemplateOptions | undefined): PageLanguage {
  return options?.language ?? 'en';
}

/** The catalogue's words in one language (core `page-messages.ts`). */
function wordsOf(language: PageLanguage): (key: PageMessageKey) => string {
  return (key) => pageMessage(language, key);
}

/**
 * A sentence naming who to ask: the operator's name in `named`, else
 * `unnamed`, which says "your administrator" in the language's own grammar
 * (a placeholder could not take the suffix Turkish puts on it).
 */
function adminText(
  t: (key: PageMessageKey) => string,
  named: PageMessageKey,
  unnamed: PageMessageKey,
  options: TemplateOptions | undefined,
): string {
  const admin = options?.adminName;
  return admin === undefined
    ? formatMessageHtml(t(unnamed), {})
    : formatMessageHtml(t(named), { admin });
}

/** The pages' own accent (cyan-400), when the host's domain has no brand or no accent. */
export const PAGE_DEFAULT_ACCENT = '#22d3ee';

/**
 * The one URL a page loads a logo from: the domain's sign-in host, a host
 * under one of this relay's domains (`lib/brand.ts` builds it from the
 * domain of the panel's projection; a host under no domain has no brand,
 * so no logo). Checked again here before it enters an attribute.
 */
const LOGO_URL_RE =
  /^https:\/\/auth\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\/static\/media\/logo\.png$/;

/**
 * The look every page Gatekeeper serves shares: the panel's dark terminal
 * style, with the accent of the host's domain when it has a brand.
 */
function baseCss(brand: PageBrand | null | undefined): string {
  return `    :root { --accent: ${pageAccent(brand)}; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
      background: #09090b; color: #e4e4e7;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1rem;
    }
    .card {
      background: #18181b; border: 1px solid #27272a; border-radius: 0.75rem;
      max-width: 560px; width: 100%; padding: 2rem;
    }${
      brand
        ? `
    .brand {
      display: flex; align-items: center; gap: 0.75rem;
      padding-bottom: 1rem; margin-bottom: 1.25rem; border-bottom: 1px solid #27272a;
    }
    .brand-logo { max-height: 40px; max-width: 120px; }
    .brand-name { color: #f4f4f5; font-size: 0.9375rem; font-weight: 700; }
    .brand-tagline { color: #a1a1aa; font-size: 0.75rem; margin-top: 0.125rem; }`
        : ''
    }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; color: #f4f4f5; margin-bottom: 0.5rem; text-wrap: balance; }
    .fqdn { color: var(--accent); }`;
}

/** The accent a page uses: the brand's when it is a colour, else the pages' own. */
function pageAccent(brand: PageBrand | null | undefined): string {
  const accent = brand?.accent ?? null;
  return accent !== null && AUTH_BRANDING_ACCENT_RE.test(accent) ? accent : PAGE_DEFAULT_ACCENT;
}

/**
 * The brand's header at the top of the card — the logo when the brand
 * serves one at a URL the page may load, the name, the tagline when set —
 * or nothing for the stock page. Name and tagline are escaped (the record's
 * validation already refuses `<`, `>`, `{`, `}`).
 */
function brandHeader(brand: PageBrand | null | undefined): string {
  if (!brand) return '';
  const logo =
    brand.logoUrl !== null && LOGO_URL_RE.test(brand.logoUrl)
      ? `<img class="brand-logo" src="${escapeAttr(brand.logoUrl)}" alt="">`
      : '';
  const tagline =
    brand.tagline === null ? '' : `<div class="brand-tagline">${escapeHtml(brand.tagline)}</div>`;
  return `
    <header class="brand">${logo}<div><div class="brand-name">${escapeHtml(brand.name)}</div>${tagline}</div></header>`;
}

/**
 * Who a refused visitor is told to contact: the brand's support e-mail
 * when the host's domain has one, else the settings' administrator
 * e-mail; empty when neither is set.
 */
function contactEmail(options: TemplateOptions | undefined): string {
  return options?.brand?.supportEmail ?? options?.adminContact ?? '';
}

/**
 * The contact lines at the foot of a page: the e-mail as a `mailto:` link
 * and, when the brand names a support URL (an `https:` URL by the
 * record's rule, checked again), that as a link.
 */
function contactLines(options: TemplateOptions | undefined): string {
  const t = wordsOf(pageLanguage(options));
  const email = contactEmail(options);
  const url = options?.brand?.supportUrl ?? null;
  const lines: string[] = [];
  if (email) {
    lines.push(
      `<p class="contact">${escapeHtml(t('contact.admin'))} <a href="mailto:${escapeAttr(email)}">${escapeHtml(email)}</a></p>`,
    );
  }
  if (url !== null && brandSupportUrlProblem(url) === null) {
    lines.push(
      `<p class="contact">${escapeHtml(t('contact.help'))} <a href="${escapeAttr(url)}" rel="noopener">${escapeHtml(url)}</a></p>`,
    );
  }
  return lines.join('\n    ');
}

/** The title's tail: the brand's name, when there is one. */
function titleSuffix(brand: PageBrand | null | undefined): string {
  return brand ? ` — ${escapeHtml(brand.name)}` : '';
}

/** The messages the access-request page offers to copy, in one language. */
interface MessageTemplates {
  readonly subject: string;
  readonly body: string;
  readonly chat: string;
  readonly whatsapp: string;
}

/**
 * The pre-filled messages in `language`, addressed to the settings'
 * `adminName`, else the catalogue's salutation ("Administrator"; the
 * Turkish body names nobody).
 */
function messageTemplates(
  language: PageLanguage,
  username: string,
  resourceName: string,
  options: TemplateOptions | undefined,
): MessageTemplates {
  const t = wordsOf(language);
  const values = {
    resource: resourceName,
    username,
    admin: options?.adminName ?? t('access.defaultAdminSalutation'),
  };
  return {
    subject: formatMessage(t('template.subject'), values),
    body: formatMessage(t('template.body'), values),
    chat: formatMessage(t('template.chat'), values),
    whatsapp: formatMessage(t('template.whatsapp'), values),
  };
}

/**
 * Generate pre-filled message templates for requesting access to a resource
 * — for JSON callers (`checkAccess`), so always in English, whatever the
 * domain's page language: the page renders its own, in its language.
 *
 * @param username - The authenticated user's username
 * @param resourceName - Human-readable resource name (e.g., FQDN or plugin name)
 * @param options - Optional admin contact info and domain
 * @returns Templates for email, Slack, Teams, WhatsApp, and generic
 */
export function getAccessRequestTemplates(
  username: string,
  resourceName: string,
  options?: TemplateOptions,
): AccessRequestTemplates {
  const english = messageTemplates('en', username, resourceName, options);
  const contact = contactEmail(options);
  const generic = formatMessage(pageMessage('en', 'template.generic'), {
    resource: resourceName,
    username,
    contact,
  });
  return {
    email: { subject: english.subject, body: english.body },
    slack: english.chat,
    teams: `Hi, could I get access to **${resourceName}**? My username is **${username}**.`,
    whatsapp: english.whatsapp,
    // The catalogue's last line names the contact: left out when there is none.
    generic: contact ? generic : generic.slice(0, generic.lastIndexOf('\n')),
  };
}

/**
 * One message to copy: its text in an element of its own — what the
 * button copies — and the button, its label and its "copied" word in
 * attributes, so the script needs no word of any language.
 */
function templateBox(id: string, text: string, t: (key: PageMessageKey) => string): string {
  return `<div class="template-box"><div id="${id}">${escapeHtml(text)}</div><button class="copy-btn" data-label="${escapeAttr(t('access.copy'))}" data-copied="${escapeAttr(t('access.copied'))}" onclick="copyTemplate('${id}', this)">${escapeHtml(t('access.copy'))}</button></div>`;
}

/**
 * Build an HTML page for the access-request denial page.
 * Server-rendered with inline CSS, no external dependencies — but, with
 * `options.brand`, the brand of the host's domain: its name in the title
 * and a header, its logo from the domain's sign-in host, its accent, its
 * support contact in place of the administrator's e-mail. The message
 * templates stay addressed to `adminName`. In `options.language` (the
 * domain's page language; English by default), the message templates too.
 *
 * @param username - The authenticated user's username
 * @param resourceFqdn - The tunnel FQDN the user tried to access
 * @param options - Optional admin contact info and the domain's brand
 * @returns Full HTML page string
 */
export function buildAccessRequestPage(
  username: string,
  resourceFqdn: string,
  options?: TemplateOptions,
): string {
  const language = pageLanguage(options);
  const t = wordsOf(language);
  const templates = messageTemplates(language, username, resourceFqdn, options);
  const brand = options?.brand;

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t('access.title'))} — ${escapeHtml(resourceFqdn)}${titleSuffix(brand)}</title>
  <style>
${baseCss(brand)}
    .subtitle { color: #a1a1aa; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .section-label {
      color: #71717a; font-size: 0.75rem; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 0.5rem; margin-top: 1.25rem;
    }
    .template-box {
      background: #0f0f12; border: 1px solid #27272a; border-radius: 0.5rem;
      padding: 2.25rem 1rem 0.75rem; margin-bottom: 0.5rem; position: relative;
      font-size: 0.8125rem; line-height: 1.5; white-space: pre-wrap;
      word-break: break-word; color: #d4d4d8;
    }
    .copy-btn {
      position: absolute; top: 0.5rem; right: 0.5rem;
      background: #27272a; border: 1px solid #3f3f46; border-radius: 0.375rem;
      color: #a1a1aa; font-size: 0.6875rem; padding: 0.25rem 0.5rem;
      cursor: pointer; font-family: inherit;
      transition: background 0.15s, color 0.15s;
    }
    .copy-btn:hover { background: #3f3f46; color: #e4e4e7; }
    .copy-btn.copied { background: #065f46; color: #6ee7b7; border-color: #065f46; }
    .contact { color: #a1a1aa; font-size: 0.8125rem; margin-top: 1.5rem; }
    .contact + .contact { margin-top: 0.375rem; }
    .contact a { color: var(--accent); text-decoration: none; }
    .contact a:hover { text-decoration: underline; }
    .user-badge {
      display: inline-block; background: #27272a; border-radius: 0.25rem;
      padding: 0.125rem 0.375rem; font-size: 0.75rem; color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="card">${brandHeader(brand)}
    <div class="icon">&#128274;</div>
    <h1>${escapeHtml(t('access.heading'))}</h1>
    <p class="subtitle">
      ${formatMessageHtml(t('access.noAccess'), { host: { text: resourceFqdn, tag: 'span', className: 'fqdn' } })}
    </p>
    <p class="subtitle">
      ${formatMessageHtml(t('access.signedInAs'), { username: { text: username, tag: 'span', className: 'user-badge' } })}
    </p>
    <p class="subtitle">
      ${adminText(t, 'access.contact', 'access.contactDefault', options)}
    </p>

    <div class="section-label">${escapeHtml(t('access.labelEmail'))}</div>
    ${templateBox('tpl-email', `${t('access.subjectLabel')} ${templates.subject}\n\n${templates.body}`, t)}

    <div class="section-label">Slack / Teams</div>
    ${templateBox('tpl-slack', templates.chat, t)}

    <div class="section-label">WhatsApp</div>
    ${templateBox('tpl-whatsapp', templates.whatsapp, t)}

    ${contactLines(options)}
  </div>
  <script>
    function copyTemplate(id, btn) {
      var el = document.getElementById(id);
      if (!el) return;
      navigator.clipboard.writeText(el.textContent).then(function() {
        btn.textContent = btn.getAttribute('data-copied');
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = btn.getAttribute('data-label');
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

/**
 * The page a signed-in user is answered with on a host of a domain they
 * are not a member of (the multi-domain relay): no access request — the
 * whole domain is closed to them — but who to ask, and a way to sign in as
 * someone else. It names no user (Authelia's refusal carries none). Shares
 * the access-request page's look. With `site`, the page of a static site
 * that refused a signed-in user — for its domain or its own user list
 * (Authelia's 403 does not say which).
 *
 * @param domain - The base domain the requested host is under; null when it
 *   is under none (the page then links to no sign-in: there is none to trust)
 * @param options - Optional admin contact info
 * @param host - The requested hostname; `site` when the refusal is a static
 *   site's (for its domain or its own user list)
 * @returns Full HTML page string
 */
export function buildDomainRefusalPage(
  domain: string | null,
  options: TemplateOptions | undefined,
  { host, site = false }: { host: string; site?: boolean },
): string {
  const language = pageLanguage(options);
  const t = wordsOf(language);
  const brand = options?.brand;
  const fqdn = (text: string) => ({ text, tag: 'span', className: 'fqdn' }) as const;
  // A host under no domain is nobody's to open: not a permission of this
  // user's, and nothing an administrator can add them to.
  const heading =
    domain === null
      ? formatMessageHtml(t('refusal.noDomainTitle'), { host: fqdn(host) })
      : site
        ? formatMessageHtml(t('refusal.notAllowedOn'), { host: fqdn(host) })
        : formatMessageHtml(t('refusal.notMember'), { domain: fqdn(domain) });
  const title =
    domain === null
      ? formatMessageHtml(t('refusal.noDomainTitle'), { host })
      : formatMessageHtml(t('refusal.title'), { domain: site ? host : domain });
  const ask =
    domain === null
      ? adminText(t, 'refusal.noDomainAsk', 'refusal.noDomainAskDefault', options)
      : adminText(t, 'refusal.ask', 'refusal.askDefault', options);
  const explanation =
    domain === null
      ? formatMessageHtml(t('refusal.noDomain'), {})
      : formatMessageHtml(t(site ? 'refusal.site' : 'refusal.domain'), { domain });
  // Only a domain of this relay has a sign-in to send the user to; a host
  // under none could name a stranger's.
  const signOut =
    domain === null
      ? ''
      : `<p class="subtitle">
      ${formatMessageHtml(t('refusal.signOut'), {}, { href: `https://auth.${domain}/logout` })}
    </p>`;
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}${titleSuffix(brand)}</title>
  <style>
${baseCss(brand)}
    .subtitle { color: #a1a1aa; font-size: 0.875rem; margin-bottom: 1rem; }
    .contact { color: #a1a1aa; font-size: 0.8125rem; margin-top: 1.5rem; }
    .contact + .contact { margin-top: 0.375rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">${brandHeader(brand)}
    <div class="icon">&#128683;</div>
    <h1>${heading}</h1>
    <p class="subtitle">
      ${explanation} ${ask}
    </p>
    ${signOut}
    ${contactLines(options)}
  </div>
</body>
</html>`;
}

/**
 * The page a plugin's site answers when Gatekeeper does not allow the
 * request at all — its web surface not served (yet, or any more), or a
 * request no vhost of this version sends: not an access request (there is
 * nothing to ask for), "not allowed", in the language and brand of the
 * host's domain. Names nothing of the request.
 *
 * @param options - The settings' contact, the domain's brand and language
 * @returns Full HTML page string
 */
export function buildForbiddenPage(options: TemplateOptions | undefined): string {
  const language = pageLanguage(options);
  const t = wordsOf(language);
  const brand = options?.brand;
  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t('forbidden.title'))}${titleSuffix(brand)}</title>
  <style>
${baseCss(brand)}
    .subtitle { color: #a1a1aa; font-size: 0.875rem; margin-bottom: 1rem; }
    .contact { color: #a1a1aa; font-size: 0.8125rem; margin-top: 1.5rem; }
    .contact + .contact { margin-top: 0.375rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">${brandHeader(brand)}
    <div class="icon">&#128683;</div>
    <h1>${escapeHtml(t('forbidden.title'))}</h1>
    <p class="subtitle">${escapeHtml(t('forbidden.text'))}</p>
    ${contactLines(options)}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
