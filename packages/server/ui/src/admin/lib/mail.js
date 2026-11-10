/**
 * Mail in the panel's words (packages/core/docs/mail-design.md): which
 * client methods a scope uses, a transport and its budget as lines, the
 * forms' bodies, and the refusals explained. The bounds are core's
 * (`@lamalibre/lamaste/mail`), never copied here. Nothing here calls the
 * panel, and nothing here holds a secret: the forms read theirs from their
 * inputs when they submit.
 */

import {
  GOOGLE_CLIENT_ID_RE,
  MAIL_BUDGET,
  MAIL_DAILY_LIMIT,
  SMTP_SECURITY_MODES,
  isDeliverableAddress,
} from '@lamalibre/lamaste/mail';

export { MAIL_DAILY_LIMIT, SMTP_SECURITY_MODES };

/** Google Workspace's daily limit once the Workspace is paid (the trial's is the default). */
export const GOOGLE_PAID_DAILY_LIMIT = 2000;

/**
 * The client methods of one scope: the relay's (`domain` null) or a
 * domain's override. `setSender` is the relay's PATCH, a domain's
 * `PUT …/mail/sender` (which makes a sender-only override when the domain
 * has none).
 *
 * @param {import('@lamalibre/lamaste').AdminClient} client
 * @param {string | null} domain
 */
export function mailApi(client, domain) {
  if (domain === null) {
    return {
      get: () => client.getMailSettings(),
      setSmtp: (input) => client.setMailSmtp(input),
      startGoogle: (input) => client.startMailGoogleConsent(input),
      update: (input) => client.setMailSender(input),
      setSender: (input) => client.setMailSender(input),
      resume: () => client.resumeMail(),
      clear: () => client.clearMailSettings(),
      test: (to) => client.sendTestMail(to),
    };
  }
  return {
    get: () => client.getDomainMail(domain),
    setSmtp: (input) => client.setDomainMailSmtp(domain, input),
    startGoogle: (input) => client.startDomainMailGoogleConsent(domain, input),
    update: (input) => client.updateDomainMail(domain, input),
    setSender: (input) => client.setDomainMailSender(domain, input),
    resume: () => client.resumeDomainMail(domain),
    clear: () => client.clearDomainMail(domain),
    test: (to) => client.sendDomainTestMail(domain, to),
  };
}

/** The react-query key of a scope's mail. */
export function mailQueryKey(domain) {
  return domain === null ? ['mail'] : ['mail', domain];
}

/** `Name <address>`, or the address alone. */
export function senderText(sender) {
  if (!sender?.address) return '—';
  return sender.name ? `${sender.name} <${sender.address}>` : sender.address;
}

/**
 * What a transport is, in one line: the Google account it sends as, or
 * the SMTP server; a sender-only override says it rides the relay's.
 *
 * @param {import('@lamalibre/lamaste').MailTransportView} transport
 */
export function transportSummary(transport) {
  if (transport.kind === null) return 'The relay’s transport, with this domain’s sender';
  if (transport.kind === 'gmail-api') {
    return `Gmail API as ${transport.settings?.account ?? 'an unknown account'}`;
  }
  const s = transport.settings ?? {};
  const security = s.security === 'tls' ? 'TLS' : 'STARTTLS';
  const auth = s.username ? `, signing in as ${s.username}` : ', no sign-in';
  const ca = s.hasCaPem ? ', a private CA trusted' : '';
  return `SMTP ${s.host}:${s.port} (${security}${auth}${ca})`;
}

/**
 * The last check, in words, and its tone: `invalid_grant` tells the
 * administrator to connect Google again.
 *
 * @param {import('@lamalibre/lamaste').MailTransportHealth | null} health
 * @returns {{ text: string, tone: 'ok' | 'failing' | 'unknown' } | null}
 */
export function healthText(health) {
  if (!health) return null;
  const when = health.checkedAt ? ` (checked ${formatWhen(health.checkedAt)})` : '';
  if (health.status === 'up') return { text: `Working${when}`, tone: 'ok' };
  if (health.status === 'down') {
    const why =
      health.reason === 'invalid_grant'
        ? 'Google no longer accepts the grant — connect Google again'
        : `not working${health.reason ? `: ${health.reason}` : ''}`;
    return { text: `${capitalize(why)}${when}`, tone: 'failing' };
  }
  return { text: 'Not checked yet', tone: 'unknown' };
}

/**
 * Whether a provider's refusal stops the sending account now.
 *
 * @param {import('@lamalibre/lamaste').MailBudgetView | null} budget
 * @param {Date} [now]
 */
export function isLimited(budget, now = new Date()) {
  if (!budget?.limitedUntil) return false;
  return Date.parse(budget.limitedUntil) > now.getTime();
}

/**
 * The budget as lines (§3.7): what was sent of what may be, the share
 * public mails may use, the reset cap, and why sending stops or when it
 * resumes. `level` is the bar's colour.
 *
 * @param {import('@lamalibre/lamaste').MailBudgetView} budget
 * @param {Date} [now]
 */
export function budgetLines(budget, now = new Date()) {
  const lines = [
    `${budget.sent24h} of ${budget.ceiling} mails in the last 24 hours (the daily limit is ${budget.dailyLimit}; Lamaste stops at ${Math.round(MAIL_BUDGET.ceilingRatio * 100)}%)`,
    `By class: ${budget.byClass.essential} essential · ${budget.byClass.admin} administrators’ invitations · ${budget.byClass.public} public (reset mails and delegated invitations, up to ${budget.publicCap})`,
    `Reset mails in the last hour: ${budget.resetsLastHour} of ${MAIL_BUDGET.resetsPerHour}`,
  ];
  if (isLimited(budget, now)) {
    lines.push(
      `The provider refused for reaching its limit: nothing is sent until ${formatWhen(budget.limitedUntil)}. Resume earlier only once the provider shows the account sending again.`,
    );
  } else if (budget.resumesAt) {
    lines.push(`At the ceiling: sending resumes at ${formatWhen(budget.resumesAt)}.`);
  }
  return lines;
}

/**
 * The share of the ceiling used and the bar's level: `warning` from
 * {@link MAIL_BUDGET.warningRatio}, `full` at the ceiling or while limited.
 *
 * @param {import('@lamalibre/lamaste').MailBudgetView} budget
 * @param {Date} [now]
 * @returns {{ percent: number, level: 'ok' | 'warning' | 'full' }}
 */
export function budgetLevel(budget, now = new Date()) {
  const percent = budget.ceiling > 0 ? Math.min(100, (budget.sent24h / budget.ceiling) * 100) : 100;
  if (isLimited(budget, now) || budget.sent24h >= budget.ceiling) return { percent, level: 'full' };
  if (budget.sent24h >= budget.ceiling * MAIL_BUDGET.warningRatio) {
    return { percent, level: 'warning' };
  }
  return { percent, level: 'ok' };
}

/** A daily limit typed into a field, or an error. */
export function parseDailyLimit(text) {
  const value = Number(String(text).trim());
  if (!Number.isInteger(value) || value < MAIL_DAILY_LIMIT.min || value > MAIL_DAILY_LIMIT.max) {
    return {
      error: `A whole number from ${MAIL_DAILY_LIMIT.min} to ${MAIL_DAILY_LIMIT.max.toLocaleString('en')}`,
    };
  }
  return { value };
}

/**
 * The sender fields of a form as body fields: the name null when cleared.
 *
 * @param {{ senderAddress: string, senderName: string }} form
 */
function senderFields(form) {
  const name = form.senderName.trim();
  return { senderAddress: form.senderAddress.trim(), senderName: name === '' ? null : name };
}

/** The daily limit field of a form, when typed: `{ dailyLimit }`, `{}`, or an error. */
function dailyLimitField(form) {
  if (String(form.dailyLimit ?? '').trim() === '') return {};
  const parsed = parseDailyLimit(form.dailyLimit);
  return parsed.error ? { error: parsed.error } : { dailyLimit: parsed.value };
}

/** An empty SMTP form, or one prefilled from a stored `smtp` transport. */
export function smtpForm(transport) {
  const s = transport?.kind === 'smtp' ? transport.settings : null;
  return {
    host: s?.host ?? '',
    port: String(s?.port ?? 587),
    security: s?.security ?? 'starttls',
    username: s?.username ?? '',
    // Whether to trust a private CA; the stored bundle is never shown.
    useCaPem: Boolean(s?.hasCaPem),
    caPem: '',
    // The server a stored bundle is kept for when none is pasted.
    storedCaHost: s?.hasCaPem ? s.host : null,
    senderAddress: transport?.sender?.address ?? '',
    senderName: transport?.sender?.name ?? '',
    dailyLimit: transport?.budget ? String(transport.budget.dailyLimit) : '',
  };
}

/**
 * The body of `PUT …/mail` from an SMTP form and the password typed (empty:
 * keep the stored one), or the form's errors by field. A stored CA bundle
 * is never shown: an empty paste keeps it (for the same server only), and
 * unticking "trust a private CA" removes it.
 *
 * @returns {{ body: object } | { errors: Record<string, string> }}
 */
export function smtpBody(form, password) {
  const errors = {};
  const host = form.host.trim();
  if (host === '') errors.host = 'Required';
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = '1 to 65535';
  if (!SMTP_SECURITY_MODES.includes(form.security)) errors.security = 'STARTTLS or TLS';
  const username = form.username.trim();
  if (password !== '' && username === '') errors.password = 'A password needs a username';
  const caPem = form.caPem.trim();
  const keepsStoredCa = form.storedCaHost !== null && form.storedCaHost === host.toLowerCase();
  if (form.useCaPem && caPem === '' && !keepsStoredCa) {
    errors.caPem =
      form.storedCaHost === null
        ? 'Paste the CA bundle'
        : 'Paste the CA bundle — the stored one is kept only for the same server';
  }
  const sender = senderFields(form);
  if (!isDeliverableAddress(sender.senderAddress)) errors.senderAddress = 'A deliverable address';
  const limit = dailyLimitField(form);
  if (limit.error) errors.dailyLimit = limit.error;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    body: {
      host,
      port,
      security: form.security,
      ...(username !== '' ? { username } : {}),
      ...(password !== '' ? { password } : {}),
      ...(form.useCaPem && caPem !== '' ? { caPem } : {}),
      ...(!form.useCaPem && form.storedCaHost !== null ? { caPem: null } : {}),
      ...sender,
      ...(limit.dailyLimit !== undefined ? { dailyLimit: limit.dailyLimit } : {}),
    },
  };
}

/** An empty Google form, or one prefilled from a stored `gmail-api` transport. */
export function googleForm(transport) {
  const g = transport?.kind === 'gmail-api' ? transport.settings : null;
  return {
    clientId: g?.clientId ?? '',
    senderAddress: transport?.sender?.address ?? '',
    senderName: transport?.sender?.name ?? '',
    dailyLimit: transport?.budget ? String(transport.budget.dailyLimit) : '',
  };
}

/**
 * The body of `POST …/mail/google/start` from a Google form and the client
 * secret typed, or the form's errors by field.
 *
 * @returns {{ body: object } | { errors: Record<string, string> }}
 */
export function googleBody(form, clientSecret) {
  const errors = {};
  const clientId = form.clientId.trim();
  if (!GOOGLE_CLIENT_ID_RE.test(clientId)) {
    errors.clientId = 'A Google OAuth client id (…apps.googleusercontent.com)';
  }
  if (clientSecret.trim() === '') errors.clientSecret = 'Required';
  const sender = senderFields(form);
  if (!isDeliverableAddress(sender.senderAddress)) errors.senderAddress = 'A deliverable address';
  const limit = dailyLimitField(form);
  if (limit.error) errors.dailyLimit = limit.error;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    body: {
      clientId,
      clientSecret: clientSecret.trim(),
      ...sender,
      ...(limit.dailyLimit !== undefined ? { dailyLimit: limit.dailyLimit } : {}),
    },
  };
}

/** An empty sender form, or one prefilled from a transport. */
export function senderForm(transport) {
  return {
    senderAddress: transport?.sender?.address ?? '',
    senderName: transport?.sender?.name ?? '',
    dailyLimit: transport?.budget ? String(transport.budget.dailyLimit) : '',
  };
}

/**
 * What changed in a sender form, as a `PATCH` body (or a domain's `PUT
 * …/sender` body when `senderOnly`), or its errors; `null` when nothing
 * changed.
 *
 * @param {object} form
 * @param {import('@lamalibre/lamaste').MailTransportView | null} transport
 * @param {{ senderOnly?: boolean }} [options]
 * @returns {{ body: object } | { errors: Record<string, string> } | null}
 */
export function senderBody(form, transport, { senderOnly = false } = {}) {
  const sender = senderFields(form);
  if (!isDeliverableAddress(sender.senderAddress)) {
    return { errors: { senderAddress: 'A deliverable address' } };
  }
  if (senderOnly) return { body: sender };
  const body = {};
  if (sender.senderAddress !== (transport?.sender?.address ?? '')) {
    body.senderAddress = sender.senderAddress;
  }
  if (sender.senderName !== (transport?.sender?.name ?? null)) body.senderName = sender.senderName;
  if (transport?.budget) {
    const limit = dailyLimitField(form);
    if (limit.error) return { errors: { dailyLimit: limit.error } };
    if (limit.dailyLimit !== undefined && limit.dailyLimit !== transport.budget.dailyLimit) {
      body.dailyLimit = limit.dailyLimit;
    }
  }
  return Object.keys(body).length > 0 ? { body } : null;
}

/**
 * What became of an invitation's mail, in words; null when there is
 * nothing to say (no mail state, an invitation made before mail).
 *
 * @param {{ status: string | null, error?: string } | null | undefined} mail
 * @param {string | null} [email]
 */
export function mailStatusText(mail, email = null) {
  switch (mail?.status) {
    case 'sent':
      return email ? `E-mailed to ${email}` : 'E-mailed';
    case 'failed':
      return 'Could not be e-mailed — share the link yourself';
    case 'deferred-budget':
      return 'Not e-mailed: the mail budget is used up — share the link yourself';
    case 'not-configured':
      return 'Not e-mailed: no mail is set up for its domain — share the link yourself';
    default:
      return null;
  }
}

/** Whether an invitation can be given a new link: a pending one, an expired one too. */
export function isReissuable(invitation) {
  return invitation?.status === 'pending' || invitation?.status === 'expired';
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatWhen(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}
