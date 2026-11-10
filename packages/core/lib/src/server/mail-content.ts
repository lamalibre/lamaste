/**
 * What the relay's mail says (packages/core/docs/mail-design.md §3.6, §6)
 * and the page Google's consent returns to (§3.3) — in the domain's page
 * language, under its brand's name and accent.
 *
 * Every mail is a multipart text + HTML message; the HTML is a plain table
 * layout with inline styles (mail programs load no stylesheet), every
 * value escaped, every link `https://`. Placeholders are filled in one
 * pass ({@link formatMessage}), so a name holding `{brand}` stays text.
 */

import { assertDomainName } from '../domains.js';
import { formatMailbox } from '../mail.js';
import type { MailSender } from '../mail.js';
import { PASSWORD_RESET_TTL_MINUTES } from '../account.js';
import { AUTH_PAGE_DEFAULT_ACCENT_LIGHT } from '../auth-branding.js';
import {
  escapeHtml,
  formatMessage,
  formatMessageHtml,
  isPageLanguage,
  pageMessage,
  pluralKey,
} from '../page-messages.js';
import type { PageLanguage, PageMessageKey } from '../page-messages.js';
import { authPageStaticShell } from './auth-pages.js';
import type { InviteBrand } from './auth-pages.js';

/** What a mail takes from a domain's brand; null: Lamaste's name and accent. */
export interface MailBrand {
  readonly name: string;
  /** `#rrggbb`, or null for the default accent. */
  readonly accent: string | null;
}

/** A mail, ready for a transport. */
export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/** A link a mail may carry: `https://` and printable ASCII without quotes, spaces or angle brackets. */
function assertMailLink(link: string): void {
  if (!/^https:\/\/[\x21-\x7e]+$/.test(link) || /["'<>\\]/.test(link)) {
    throw new Error('A mail link is an https URL of printable ASCII');
  }
}

function brandName(brand: MailBrand | null): string {
  return brand === null ? 'Lamaste' : brand.name;
}

/** A date as the mail's language writes it, in UTC (the relay knows no reader's zone). */
function formatMailDate(language: PageLanguage, date: Date): string {
  const locale = language === 'tr' ? 'tr-TR' : 'en-GB';
  const text = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
  return `${text} UTC`;
}

/** One part of a mail's body: a paragraph, a button, or a muted line. */
type MailBlock =
  | {
      readonly kind: 'p' | 'muted';
      readonly key: PageMessageKey;
      readonly values?: Readonly<Record<string, string | number>>;
    }
  | { readonly kind: 'button'; readonly key: PageMessageKey; readonly href: string };

/** The mail around its blocks: text and HTML, the footer naming the brand. */
function composeMail(
  language: PageLanguage,
  brand: MailBrand | null,
  subject: string,
  blocks: readonly MailBlock[],
): RenderedMail {
  if (!isPageLanguage(language)) throw new Error('A mail is written in a page language');
  if (brand !== null && brand.accent !== null && !ACCENT_RE.test(brand.accent)) {
    throw new Error('An accent is #rrggbb');
  }
  const accent = brand?.accent ?? AUTH_PAGE_DEFAULT_ACCENT_LIGHT;
  const name = brandName(brand);
  const footer: MailBlock = { kind: 'muted', key: 'mail.footer', values: { brand: name } };
  const all = [...blocks, footer];

  const text = all
    .map((block) => {
      if (block.kind === 'button') return `${pageMessage(language, block.key)}:\n${block.href}`;
      return formatMessage(pageMessage(language, block.key), block.values ?? {});
    })
    .join('\n\n');

  const rows = all
    .map((block) => {
      if (block.kind === 'button') {
        return `<tr><td style="padding:8px 0 16px"><a href="${escapeHtml(block.href)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px">${escapeHtml(pageMessage(language, block.key))}</a></td></tr>`;
      }
      const body = formatMessageHtml(pageMessage(language, block.key), block.values ?? {});
      const style =
        block.kind === 'muted'
          ? 'padding:8px 0;color:#71717a;font-size:13px;line-height:1.5'
          : 'padding:8px 0;color:#18181b;font-size:15px;line-height:1.6';
      return `<tr><td style="${style}">${body}</td></tr>`;
    })
    .join('\n');
  const html = `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<tr><td style="padding:0 0 16px;font-size:18px;font-weight:700;color:#18181b;border-bottom:3px solid ${accent}">${escapeHtml(name)}</td></tr>
${rows}
</table>
</body>
</html>
`;
  return { subject, text: `${text}\n`, html };
}

/** The invitation, an administrator's or a delegated one (§6.1). */
export function renderInvitationMail(opts: {
  readonly language: PageLanguage;
  readonly brand: MailBrand | null;
  /** `https://auth.<domain>/invite#<token>`. */
  readonly link: string;
  readonly expiresAt: Date;
  readonly delegated?: {
    /** Who invited — their display name — or null when they are not named. */
    readonly inviter: string | null;
    readonly plugin: string;
    readonly role: string;
  };
}): RenderedMail {
  assertMailLink(opts.link);
  const { language, brand, delegated } = opts;
  const name = brandName(brand);
  const subject =
    delegated === undefined
      ? formatMessage(pageMessage(language, 'mail.invite.subject'), { brand: name })
      : formatMessage(pageMessage(language, 'mail.invite.subjectDelegated'), {
          plugin: delegated.plugin,
        });
  const intro: MailBlock =
    delegated === undefined
      ? { kind: 'p', key: 'mail.invite.intro', values: { brand: name } }
      : delegated.inviter === null
        ? {
            kind: 'p',
            key: 'mail.invite.introDelegatedAnonymous',
            values: { plugin: delegated.plugin, role: delegated.role },
          }
        : {
            kind: 'p',
            key: 'mail.invite.introDelegated',
            values: { inviter: delegated.inviter, plugin: delegated.plugin, role: delegated.role },
          };
  return composeMail(language, brand, subject, [
    intro,
    { kind: 'button', key: 'mail.invite.action', href: opts.link },
    {
      kind: 'muted',
      key: 'mail.invite.expires',
      values: { date: formatMailDate(language, opts.expiresAt) },
    },
    { kind: 'muted', key: 'mail.ignore' },
  ]);
}

/**
 * The reset links of every account the request matched at one address
 * (§6.2): each username with its own `https://auth.<domain>/reset#<token>`.
 */
export function renderPasswordResetMail(opts: {
  readonly language: PageLanguage;
  readonly brand: MailBrand | null;
  readonly accounts: ReadonlyArray<{ readonly username: string; readonly link: string }>;
}): RenderedMail {
  const { language, brand, accounts } = opts;
  if (accounts.length === 0) throw new Error('A reset mail names at least one account');
  const name = brandName(brand);
  const blocks: MailBlock[] = [
    {
      kind: 'p',
      key: accounts.length === 1 ? 'mail.reset.intro' : 'mail.reset.introMany',
      values: { brand: name },
    },
  ];
  for (const account of accounts) {
    assertMailLink(account.link);
    blocks.push({ kind: 'p', key: 'mail.reset.account', values: { username: account.username } });
    blocks.push({ kind: 'button', key: 'mail.reset.action', href: account.link });
  }
  blocks.push(
    {
      kind: 'muted',
      key: pluralKey(language, 'mail.reset.expires', PASSWORD_RESET_TTL_MINUTES) as PageMessageKey,
      values: { minutes: PASSWORD_RESET_TTL_MINUTES },
    },
    { kind: 'muted', key: 'mail.reset.ignore' },
  );
  return composeMail(language, brand, pageMessage(language, 'mail.reset.subject'), blocks);
}

/** "Your password was changed" (§6.2, §6.3). */
export function renderPasswordChangedMail(opts: {
  readonly language: PageLanguage;
  readonly brand: MailBrand | null;
  readonly username: string;
  readonly changedAt: Date;
}): RenderedMail {
  const { language, brand } = opts;
  return composeMail(language, brand, pageMessage(language, 'mail.changed.subject'), [
    {
      kind: 'p',
      key: 'mail.changed.text',
      values: {
        username: opts.username,
        brand: brandName(brand),
        date: formatMailDate(language, opts.changedAt),
      },
    },
    { kind: 'p', key: 'mail.changed.warning' },
  ]);
}

/** The administrator's test mail (§3.4). */
export function renderTestMail(opts: {
  readonly language: PageLanguage;
  readonly brand: MailBrand | null;
  readonly sender: MailSender;
}): RenderedMail {
  const { language, brand } = opts;
  const name = brandName(brand);
  return composeMail(
    language,
    brand,
    formatMessage(pageMessage(language, 'mail.test.subject'), { brand: name }),
    [
      {
        kind: 'p',
        key: 'mail.test.text',
        values: { brand: name, sender: formatMailbox(opts.sender) },
      },
    ],
  );
}

// ---------------------------------------------------------------------------
// The consent's result page
// ---------------------------------------------------------------------------

/** Why a consent did not set the transport up — each worded by the page. */
export const MAIL_CONSENT_FAILURES = ['expired', 'denied', 'sender', 'token', 'generic'] as const;
export type MailConsentFailure = (typeof MAIL_CONSENT_FAILURES)[number];

/**
 * The page `https://auth.<primary>/mail/google/callback` answers with
 * (§3.3): the transport set up, as whom it sends — or why not. No script;
 * served with {@link authPageStaticHeaders}. `domain` is the auth host's
 * domain, checked only to refuse rendering for a stray value.
 */
export function renderMailConsentPage(opts: {
  readonly brand: InviteBrand | null;
  readonly language: PageLanguage;
  readonly domain: string;
  readonly result:
    | { readonly ok: true; readonly sender: MailSender }
    | { readonly ok: false; readonly reason: MailConsentFailure };
}): string {
  const { language, result } = opts;
  assertDomainName(opts.domain);
  const words = (key: PageMessageKey) => escapeHtml(pageMessage(language, key));
  const content = result.ok
    ? `
      <div class="success-card">
        <div class="icon">✅</div>
        <h1>${words('mailConsent.okTitle')}</h1>
        <p>${formatMessageHtml(pageMessage(language, 'mailConsent.ok'), {
          sender: { text: formatMailbox(result.sender), tag: 'strong', className: 'accent' },
        })}</p>
      </div>`
    : `
      <div class="icon">⚠️</div>
      <h1>${words('mailConsent.failedTitle')}</h1>
      <p class="subtitle">${words(`mailConsent.reason.${result.reason}`)}</p>
      <p class="subtitle">${words('mailConsent.again')}</p>`;
  return authPageStaticShell({
    brand: opts.brand,
    language,
    title: pageMessage(language, 'mailConsent.title'),
    content,
  });
}
