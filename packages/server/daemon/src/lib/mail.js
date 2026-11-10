/**
 * The relay's mail (packages/core/docs/mail-design.md): which transport a
 * mail takes, composing and delivering it under the sending budget, and
 * the administrators' operations on transports — set, check, consent
 * (Google), change the sender or limit, clear, resume, test — plus the
 * health check every 6 hours.
 *
 * Callers send through {@link sendMail} (Lamaste's own mails, rendered in
 * the domain's language and brand) or {@link sendRawMail} (a message
 * already composed — Authelia's, through the submission listener), each
 * with a class (`essential`, `admin`, `public`) and a kind; the answer is
 * core's `MailSendResult` and never throws for a delivery failure.
 *
 * Secrets — SMTP passwords, Google client secrets and refresh tokens — go
 * from the request body to state.db and from state.db to the provider;
 * they are never answered, logged or audited. Audits and notifications
 * carry the kind of mail, the scope, the recipient's domain and a failure
 * class, never an address or a provider's message.
 */

import crypto from 'node:crypto';

import {
  MAIL_BUDGET,
  MAIL_DAILY_LIMIT,
  formatMailbox,
  isRelayHost,
  mailAddressDomain,
  mailBudgetDecision,
  mailBudgetThresholds,
  mailGoogleRedirectUri,
  parseMailAddress,
  PromiseChainMutex,
  resolveMailTransport,
} from '@lamalibre/lamaste';
import {
  MailCaPemError,
  hostnameHolder,
  parseMailCaPem,
  withTunnelLock,
} from '@lamalibre/lamaste/server';
import MailComposer from 'nodemailer/lib/mail-composer';

import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import { domainPresentation } from './auth-branding.js';
import { domainNames, getDomain, primaryDomainName } from './domains.js';
import { MailDeliveryError } from './mail-errors.js';
import {
  checkGmailCredentials,
  exchangeGoogleCode,
  forgetGmailAccessTokens,
  googleAuthorizeUrl,
  pkcePair,
  revokeGoogleToken,
  sendGmailMessage,
} from './mail-gmail.js';
import { checkSmtpTransport, sendSmtpMessage } from './mail-smtp.js';
import { syncMailConfiguration } from './mail-sync.js';
import {
  accountState,
  accountUsage,
  deleteTransportRow,
  insertPendingConsent,
  mailRecords,
  markAttemptSent,
  patchTransportRow,
  recordAttempt,
  senderHostnames,
  setTransportHealth,
  sweepMailRecords,
  takePendingConsent,
  transportRow,
  transportRows,
  transportSecret,
  transportView,
  updateAccountState,
  writeTransportRow,
} from './mail-store.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { readSites, readTunnels, withSitesLock } from './state.js';
import { getStateDb } from './state-db.js';

/** A send — every attempt and the retry — finishes within this. */
const SEND_BUDGET_MS = 30_000;
/** An admission check finishes within this. */
const CHECK_BUDGET_MS = 25_000;
/** A Google consent must come back within this. */
const CONSENT_TTL_MS = 10 * 60_000;
/** How often every transport is checked (§5.1). */
const HEALTH_INTERVAL_MS = 6 * 3_600_000;
const HOUR_MS = 3_600_000;

/** A consent state's SHA-256 (hex) — all that is kept of it. */
function stateHash(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

/** Every change to the transports, one at a time. */
const transportMutex = new PromiseChainMutex();

// ---------------------------------------------------------------------------
// Composing and delivering
// ---------------------------------------------------------------------------

/**
 * One message, RFC 5322: multipart text + HTML, `From` the sender, one
 * recipient, marked automatic (no auto-replies back). nodemailer reads no
 * file and no URL for it.
 *
 * @param {{ sender: import('@lamalibre/lamaste').MailSender, to: string,
 *   mail: { subject: string, text: string, html: string } }} input
 * @returns {Promise<Buffer>}
 */
export function composeMessage({ sender, to, mail }) {
  return new MailComposer({
    from: formatMailbox(sender),
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
}

/** The name the relay greets SMTP servers with. */
async function ehloName() {
  const primary = await primaryDomainName();
  return primary ? `panel.${primary}` : 'localhost';
}

/** What a row needs to reach its provider: settings, secret, the extra CA certificates. */
function deliveryParts(row) {
  const settings = JSON.parse(row.settings);
  const secret = transportSecret(row);
  const caCertificates =
    row.kind === 'smtp' && typeof settings.caPem === 'string'
      ? parseMailCaPem(settings.caPem)
      : null;
  return { settings, secret, caCertificates };
}

/** Reject with a transient timeout when `promise` outlives `ms`. */
function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new MailDeliveryError('transient', 'timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Hand one message to a row's provider within `ms`. */
async function transportSend(row, { from, to, raw }, ms) {
  const { settings, secret, caCertificates } = deliveryParts(row);
  if (row.kind === 'gmail-api') {
    const credentials = { clientId: settings.clientId, ...secret };
    return sendGmailMessage(credentials, raw, AbortSignal.timeout(ms));
  }
  const opts = { ehloName: await ehloName(), caCertificates };
  return withDeadline(sendSmtpMessage(settings, secret.password, { from, to, raw }, opts), ms);
}

/** How a scope is named in notifications. */
function scopeLabel(domain) {
  return domain === null ? 'the relay' : domain;
}

/** How a sending account is named in notifications (the administrator set it; no secret). */
function accountLabel(row) {
  const settings = JSON.parse(row.settings);
  return row.kind === 'gmail-api' ? settings.account : `${settings.host}`;
}

/** Record a row's health; a change of state is notified and audited. */
async function recordHealth(db, row, { status, reason }, logger) {
  setTransportHealth(db, row.id, { status, reason, at: new Date() });
  if (row.health_status === status) return;
  if (status === 'down') {
    const hint =
      reason === 'invalid_grant'
        ? ' — Google no longer accepts its grant: connect it again (consent)'
        : '';
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'critical',
        message: `Mail: the transport of ${scopeLabel(row.domain)} (${accountLabel(row)}) cannot send (${reason})${hint}.`,
      },
      logger,
    );
  } else if (status === 'up' && row.health_status === 'down') {
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'info',
        message: `Mail: the transport of ${scopeLabel(row.domain)} (${accountLabel(row)}) sends again.`,
      },
      logger,
    );
  }
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: status === 'down' ? 'mail.transport.down' : 'mail.transport.up',
      details: { scope: row.domain ?? 'relay', kind: row.kind, reason },
    },
    logger,
  );
}

/**
 * Admit one attempt under the budget (§3.7) and record it — one
 * synchronous step, so two sends never both take the last mail. Clears a
 * crossing's notification state once usage is back below it.
 */
function admitAttempt(db, row, { sendClass, kind, now }) {
  const usage = accountUsage(db, row.account_key, now);
  const state = accountState(db, row.account_key);
  const { publicCap, warningAt } = mailBudgetThresholds(row.daily_limit);
  if (state.warned_at !== null && usage.sent24h < warningAt) {
    updateAccountState(db, row.account_key, { warned_at: null });
  }
  if (state.exhausted_at !== null && usage.sent24h < publicCap) {
    updateAccountState(db, row.account_key, { exhausted_at: null });
  }
  const decision = mailBudgetDecision({
    dailyLimit: row.daily_limit,
    sent24h: usage.sent24h,
    resetsLastHour: usage.resetsLastHour,
    sendClass,
    kind,
    limitedUntil: state.limited_until,
    now,
  });
  if (!decision.ok) return { refusal: decision.reason, usage };
  return {
    attemptId: recordAttempt(db, { accountKey: row.account_key, sendClass, kind, at: now }),
    usage,
  };
}

/**
 * After a delivered mail — `sent24h` the account's usage counting it: the
 * 70 % warning, once per crossing.
 */
async function afterDelivered(db, row, sent24h, logger) {
  const { ceiling, warningAt } = mailBudgetThresholds(row.daily_limit);
  if (sent24h < warningAt || accountState(db, row.account_key).warned_at !== null) return;
  updateAccountState(db, row.account_key, { warned_at: new Date().toISOString() });
  await notifyAdminsBestEffort(
    {
      source: 'lamaste',
      level: 'warning',
      message: `Mail: ${sent24h} of the ${ceiling} mails ${accountLabel(row)} may send in 24 hours are used (daily limit ${row.daily_limit}).`,
    },
    logger,
  );
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'mail.budget.warning',
      details: { scope: row.domain ?? 'relay', sent24h, ceiling },
    },
    logger,
  );
}

/** A mail the budget held back: the "exhausted" notification, once per crossing. */
async function budgetRefused(db, row, refusal, usage, logger) {
  if (refusal !== 'ceiling' && refusal !== 'public-cap') return;
  if (accountState(db, row.account_key).exhausted_at !== null) return;
  const now = new Date();
  updateAccountState(db, row.account_key, { exhausted_at: now.toISOString() });
  const resumesAt =
    usage.oldestAt === null
      ? null
      : new Date(Date.parse(usage.oldestAt) + MAIL_BUDGET.windowHours * HOUR_MS).toISOString();
  const what =
    refusal === 'ceiling'
      ? 'no more mail'
      : 'only essential and administrators’ mail (password resets and delegated invitations wait)';
  await notifyAdminsBestEffort(
    {
      source: 'lamaste',
      level: 'critical',
      message: `Mail: ${accountLabel(row)} reached its sending budget — ${what} until ${resumesAt ?? 'the window moves on'}.`,
    },
    logger,
  );
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'mail.budget.exhausted',
      details: { scope: row.domain ?? 'relay', refusal, sent24h: usage.sent24h, resumesAt },
    },
    logger,
  );
}

/** A provider's limit refusal: the sending account — every row on it — stops for 24 h. */
async function providerLimited(db, row, logger) {
  const until = new Date(Date.now() + MAIL_BUDGET.limitedHours * HOUR_MS).toISOString();
  updateAccountState(db, row.account_key, { limited_until: until, limited_reason: 'provider' });
  await notifyAdminsBestEffort(
    {
      source: 'lamaste',
      level: 'critical',
      message: `Mail: the provider refused ${accountLabel(row)} for sending too much — no mail through it until ${until}. Resume earlier once the provider's console shows it sending again.`,
    },
    logger,
  );
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'mail.transport.limited',
      details: { scope: row.domain ?? 'relay', kind: row.kind, until },
    },
    logger,
  );
}

/**
 * Deliver a composed message through `row` under the budget: one retry
 * for a transient failure, all within 30 s.
 *
 * @returns {Promise<import('@lamalibre/lamaste').MailSendResult>}
 */
async function deliver(row, { scope, from, to, raw, kind, sendClass, logger }) {
  const db = await getStateDb();
  const deadline = Date.now() + SEND_BUDGET_MS;
  const audit = (action, extra = {}) =>
    recordAuditBestEffort(
      {
        actor: 'lamaste',
        action,
        details: {
          kind,
          scope: scope ?? 'relay',
          recipientDomain: mailAddressDomain(to),
          ...extra,
        },
      },
      logger,
    );

  for (let attempt = 0; ; attempt++) {
    const admitted = admitAttempt(db, row, { sendClass, kind, now: new Date() });
    if (admitted.refusal) {
      await budgetRefused(db, row, admitted.refusal, admitted.usage, logger);
      return { status: 'deferred-budget', error: admitted.refusal };
    }
    let failure;
    try {
      await transportSend(row, { from, to, raw }, Math.max(1, deadline - Date.now()));
      markAttemptSent(db, admitted.attemptId);
      if (row.health_status === 'down')
        await recordHealth(db, row, { status: 'up', reason: null }, logger);
      await afterDelivered(db, row, admitted.usage.sent24h + 1, logger);
      await audit('mail.sent');
      return { status: 'sent' };
    } catch (err) {
      failure =
        err instanceof MailDeliveryError ? err : new MailDeliveryError('transient', 'unexpected');
      if (!(err instanceof MailDeliveryError))
        logger?.error({ err: err?.message }, 'Mail send failed');
    }
    if (failure.failure === 'limited') {
      await providerLimited(db, row, logger);
      await audit('mail.failed', { error: failure.reason });
      return { status: 'deferred-budget', error: 'limited' };
    }
    if (failure.failure === 'down') {
      await recordHealth(db, row, { status: 'down', reason: failure.reason }, logger);
    }
    if (failure.failure === 'transient' && attempt === 0 && deadline - Date.now() > 2_000) continue;
    logger?.warn({ kind, failure: failure.failure, reason: failure.reason }, 'Mail not delivered');
    await audit('mail.failed', { error: failure.reason });
    return { status: 'failed', error: failure.reason };
  }
}

/**
 * Send one of Lamaste's own mails to `to` for `domain` (null: the relay's —
 * rendered as the primary domain's): resolved to its transport, rendered by
 * `render` in the domain's language and brand, delivered under the budget.
 * Never throws for a delivery failure — the answer says what happened.
 *
 * @param {{ domain: string | null, to: string,
 *   kind: import('@lamalibre/lamaste').MailKind,
 *   sendClass: import('@lamalibre/lamaste').MailSendClass,
 *   render: (context: { language: import('@lamalibre/lamaste').PageLanguage,
 *     brand: { name: string, accent: string | null } | null,
 *     sender: import('@lamalibre/lamaste').MailSender }) => { subject: string, text: string, html: string },
 *   logger?: import('pino').Logger }} input
 * @returns {Promise<import('@lamalibre/lamaste').MailSendResult>}
 */
export async function sendMail({ domain, to, kind, sendClass, render, logger }) {
  if (parseMailAddress(to) === null) throw new Error('Not an e-mail address');
  const db = await getStateDb();
  const scope = domain === null ? null : domain.toLowerCase();
  const resolved = resolveMailTransport(scope, mailRecords(db));
  if (resolved === null) return { status: 'not-configured' };
  const row = transportRow(db, resolved.transportOf);
  const shownAs = scope ?? (await primaryDomainName());
  const presentation = shownAs
    ? await domainPresentation(shownAs)
    : { mailBrand: null, language: 'en' };
  const mail = render({
    language: presentation.language,
    brand: presentation.mailBrand,
    sender: resolved.sender,
  });
  const raw = await composeMessage({ sender: resolved.sender, to, mail });
  return deliver(row, {
    scope,
    from: resolved.sender.address,
    to,
    raw,
    kind,
    sendClass,
    logger,
  });
}

/**
 * Send a message already composed (Authelia's, through the submission
 * listener) to one recipient through the relay's transport, under the
 * budget. `from` is the envelope sender — the relay's sender.
 *
 * @param {{ to: string, raw: Buffer, kind: import('@lamalibre/lamaste').MailKind,
 *   sendClass: import('@lamalibre/lamaste').MailSendClass, logger?: import('pino').Logger }} input
 * @returns {Promise<import('@lamalibre/lamaste').MailSendResult>}
 */
export async function sendRawMail({ to, raw, kind, sendClass, logger }) {
  if (parseMailAddress(to) === null) throw new Error('Not an e-mail address');
  const db = await getStateDb();
  const resolved = resolveMailTransport(null, mailRecords(db));
  if (resolved === null) return { status: 'not-configured' };
  const row = transportRow(db, null);
  return deliver(row, {
    scope: null,
    from: resolved.sender.address,
    to,
    raw,
    kind,
    sendClass,
    logger,
  });
}

/** The relay's sender, or null when it has no transport — what Authelia's notifier is given. */
export async function relayMailSender() {
  const row = transportRow(await getStateDb(), null);
  return row ? { address: row.sender_address, name: row.sender_name } : null;
}

/** Whether mail for `domain` (null: the relay's own) has a transport. */
export async function canSendMailFor(domain) {
  const records = mailRecords(await getStateDb());
  return resolveMailTransport(domain === null ? null : domain.toLowerCase(), records) !== null;
}

/**
 * The hostnames senders hold (decision D6) — what tunnels, sites and
 * aliases may not take: `sites.ts` `hostnameHolder`'s `mailSenderDomains`.
 */
export async function mailSenderHostnames() {
  return senderHostnames(await getStateDb(), await domainNames());
}

/**
 * Carry the relay's mail to the submission listener, Authelia and the auth
 * vhosts (lib/mail-sync.js): after every change of a transport or sender,
 * after a domain is activated or removed, and at start.
 *
 * @param {{ logger?: import('pino').Logger }} [opts]
 * @returns {Promise<{ submitting: boolean, warnings: Array<{ step: string, message: string }> }>}
 */
export function syncMail({ logger } = {}) {
  return syncMailConfiguration({ deliver: sendRawMail, logger });
}

/** `answer` with the warnings of {@link syncMail} after a change added to its own. */
async function withMailSync(answer, logger) {
  let warnings;
  try {
    ({ warnings } = await syncMail({ logger }));
  } catch (err) {
    logger?.warn({ err: err?.message }, 'Mail synchronisation after a change failed');
    warnings = [
      { step: 'sync', message: `The change was saved but not yet applied (${err?.message})` },
    ];
  }
  if (warnings.length === 0) return answer;
  return { ...answer, warnings: [...(answer.warnings ?? []), ...warnings] };
}

// ---------------------------------------------------------------------------
// Administrators' operations
// ---------------------------------------------------------------------------

/** 404 `unknown_domain` unless the relay has domain `name`; its name. */
async function domainOr404(name) {
  const domain = await getDomain(name.toLowerCase());
  if (!domain) throw httpError(`No domain '${name}'`, 404, { code: 'unknown_domain' });
  return domain.name;
}

/** The scope a request names: null for the relay, a domain the relay has (else 404). */
export async function mailScope(domain) {
  return domain === null ? null : domainOr404(domain);
}

/**
 * Refuse (409 `mail_sender_host_taken`) a sender whose domain is a web
 * hostname of the relay (decision D6): one of its own hostnames, or one a
 * tunnel, site or alias serves. A sender at a relay domain itself or
 * outside them takes no hostname and is never refused.
 */
async function assertSenderHostFree(address) {
  const host = mailAddressDomain(address);
  const relayDomains = await domainNames();
  if (host === null || !relayDomains.some((d) => host.endsWith(`.${d}`))) return;
  if (isRelayHost(host, relayDomains)) {
    throw httpError(
      `'${host}' is one of the relay's own hostnames — send from another domain`,
      409,
      {
        code: 'mail_sender_host_taken',
      },
    );
  }
  const [tunnels, sites] = await Promise.all([readTunnels(), readSites()]);
  const holder = hostnameHolder(host, { tunnels, sites });
  if (holder !== null) {
    throw httpError(
      `'${host}' is served by a ${holder.kind === 'tunnel' ? 'tunnel' : 'site'} — a sending domain carries mail records, so the relay's wildcard no longer reaches it; send from another subdomain or move it`,
      409,
      { code: 'mail_sender_host_taken' },
    );
  }
}

/** Write under the hostname locks (tunnel → sites), the sender's hostname checked inside them. */
function withSenderHost(address, fn) {
  return withTunnelLock(() =>
    withSitesLock(async () => {
      await assertSenderHostFree(address);
      return fn();
    }),
  );
}

/** What an admission failure tells the administrator (422 `mail_check_failed`). */
function checkFailed(err) {
  const reason = err instanceof MailDeliveryError ? err.reason : 'unexpected';
  const messages = {
    timeout:
      'The mail server did not answer — the host may block outbound SMTP (DigitalOcean does on new accounts); use the Gmail API transport',
    connection:
      'Could not connect to the mail server — check the host and port; the host may block outbound SMTP (use the Gmail API transport)',
    auth: 'The mail server refused the username or password',
    tls: "The mail server's certificate was not trusted — for a private CA, give its certificate (caPem)",
    invalid_grant: 'Google no longer accepts this grant — connect the account again',
    invalid_client: 'Google refused the OAuth client id or secret',
    scope:
      'The grant does not include sending mail (gmail.send) — consent again and keep it ticked',
    id_token: "Google's answer did not name a verified account",
    account_changed: 'The grant now belongs to another Google account — connect it again',
  };
  return httpError(messages[reason] ?? `The mail transport could not be checked (${reason})`, 422, {
    code: 'mail_check_failed',
    reason,
  });
}

/**
 * The answer after a sender change of `scope`: its row's view and, when
 * its mail resolves to a Gmail transport whose account is not the sender,
 * the warning to send a test — the relay cannot check a send-as alias
 * (§3.2).
 */
async function senderAnswer(scope) {
  const db = await getStateDb();
  const transport = transportView(db, transportRow(db, scope));
  const resolved = resolveMailTransport(scope, mailRecords(db));
  const account =
    resolved?.transport.kind === 'gmail-api' ? resolved.transport.settings.account : null;
  if (account === null || account === resolved.sender.address.toLowerCase()) return { transport };
  return {
    transport,
    warnings: [
      {
        step: 'sender',
        message: `Gmail sends as ${resolved.sender.address} only if it is a send-as address of ${account} — send a test mail and check its From`,
      },
    ],
  };
}

/** Revoke a replaced or cleared Google grant, best effort — a warning when Google did not confirm. */
async function revokeReplacedGrant(row, keepRefreshToken = null) {
  if (row?.kind !== 'gmail-api') return [];
  const { refreshToken } = transportSecret(row);
  if (refreshToken === keepRefreshToken) return [];
  forgetGmailAccessTokens();
  const revoked = await revokeGoogleToken(refreshToken, AbortSignal.timeout(10_000));
  return revoked
    ? []
    : [
        {
          step: 'revoke',
          message:
            "Google did not confirm revoking the previous grant — remove 'Lamaste' from the account's third-party access",
        },
      ];
}

/** `GET /api/settings/mail` / `GET /api/domains/:name/mail`: the row's view, or null. */
export async function getMailTransport(domain) {
  const scope = await mailScope(domain);
  const db = await getStateDb();
  const row = transportRow(db, scope);
  return { transport: row ? transportView(db, row) : null };
}

/**
 * Set an `smtp` transport for `domain` (null: the relay's) after checking
 * it (§3.4). A password omitted keeps the stored one — only for the same
 * server and username, never sent to another.
 *
 * @param {string | null} domain
 * @param {import('@lamalibre/lamaste').SmtpTransportInput} input
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function setSmtpTransport(domain, input, { actor, logger }) {
  const answer = await transportMutex.run(async () => {
    const scope = await mailScope(domain);
    const db = await getStateDb();
    const existing = transportRow(db, scope);
    const { password, senderAddress, senderName, dailyLimit, caPem, ...rest } = input;
    const settings = { ...rest };
    const stored = existing?.kind === 'smtp' ? JSON.parse(existing.settings) : null;
    const sameHost = stored !== null && stored.host === settings.host;

    // `caPem` like the password: omitted keeps the stored bundle — for the
    // same host only, never trusted for another server; null or '' removes it.
    let caCertificates = null;
    const bundle = caPem === undefined ? (sameHost ? (stored.caPem ?? null) : null) : caPem;
    if (bundle !== null && bundle.trim() !== '') {
      try {
        caCertificates = parseMailCaPem(bundle);
      } catch (err) {
        if (err instanceof MailCaPemError) {
          throw httpError(err.message, 400, { code: 'invalid_ca_pem' });
        }
        throw err;
      }
      settings.caPem = caCertificates.join('');
    }

    let secret = password ?? null;
    if (settings.username === undefined) {
      if (password !== undefined) {
        throw httpError('A password needs a username', 400, { code: 'password_without_username' });
      }
    } else if (secret === null) {
      if (sameHost && stored.username === settings.username) {
        secret = existing.secret;
      } else {
        throw httpError('A password is required for this server and username', 400, {
          code: 'password_required',
        });
      }
    }

    await assertSenderHostFree(senderAddress);
    try {
      await withDeadline(
        checkSmtpTransport(settings, secret, { ehloName: await ehloName(), caCertificates }),
        CHECK_BUDGET_MS,
      );
    } catch (err) {
      throw checkFailed(err);
    }

    const row = await withSenderHost(senderAddress, () =>
      writeTransportRow(db, {
        domain: scope,
        kind: 'smtp',
        settings,
        secret,
        senderAddress,
        senderName: senderName ?? null,
        dailyLimit: dailyLimit ?? existing?.daily_limit ?? MAIL_DAILY_LIMIT.default,
        now: new Date(),
      }),
    );
    const warnings = await revokeReplacedGrant(existing);
    await recordAuditBestEffort(
      {
        actor,
        action: 'mail.transport.set',
        details: {
          scope: scope ?? 'relay',
          kind: 'smtp',
          host: settings.host,
          sender: senderAddress,
          dailyLimit: row.daily_limit,
        },
      },
      logger,
    );
    return { transport: transportView(db, row), ...(warnings.length ? { warnings } : {}) };
  });
  return withMailSync(answer, logger);
}

/**
 * Start Google's consent for a `gmail-api` transport of `domain` (null:
 * the relay's) (§3.3): a PKCE pair and a 32-byte state (its SHA-256 kept,
 * 10 minutes), and the URL to open. Google returns to the primary auth
 * host.
 *
 * @param {string | null} domain
 * @param {import('@lamalibre/lamaste').MailGoogleStartInput} input
 * @param {{ actor: string }} opts
 */
export async function startGoogleConsent(domain, input, { actor }) {
  const scope = await mailScope(domain);
  const primary = await primaryDomainName();
  if (!primary) {
    throw httpError('The relay has no primary domain for Google to return to', 409, {
      code: 'no_primary_domain',
    });
  }
  await assertSenderHostFree(input.senderAddress);
  const db = await getStateDb();
  const now = new Date();
  sweepMailRecords(db, now);
  const state = crypto.randomBytes(32).toString('base64url');
  const { verifier, challenge } = pkcePair();
  const expiresAt = new Date(now.getTime() + CONSENT_TTL_MS).toISOString();
  insertPendingConsent(db, {
    stateSha256: stateHash(state),
    domain: scope,
    verifier,
    draft: {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      senderAddress: input.senderAddress,
      senderName: input.senderName ?? null,
      dailyLimit: input.dailyLimit ?? null,
      actor,
    },
    now,
    expiresAt,
  });
  return {
    authorizeUrl: googleAuthorizeUrl({
      clientId: input.clientId,
      redirectUri: mailGoogleRedirectUri(primary),
      state,
      challenge,
    }),
    expiresAt,
  };
}

/** The `Host` a request named, lower-cased, without a port. */
function hostName(host) {
  return typeof host === 'string' ? host.toLowerCase().replace(/:\d+$/, '') : '';
}

/**
 * Google's return to `https://auth.<primary>/mail/google/callback` (§3.3):
 * answered only on that host (the raw `Host` the auth vhost writes as a
 * literal). The consent is taken by its state — single use, 10 minutes —
 * the code exchanged with its verifier, the grant checked and the
 * transport stored. Answers `{ found: false }` on another host, else the
 * page's `{ primary, result }`.
 *
 * @param {{ query: Record<string, unknown>, host: string | undefined, logger?: import('pino').Logger }} input
 */
export async function completeGoogleConsent({ query, host, logger }) {
  const primary = await primaryDomainName();
  if (!primary || hostName(host) !== `auth.${primary}`) return { found: false };
  const fail = (reason) => ({ found: true, primary, result: { ok: false, reason } });

  const state = typeof query.state === 'string' ? query.state : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return fail('expired');
  const db = await getStateDb();
  const pending = takePendingConsent(db, stateHash(state));
  if (pending === null || Date.parse(pending.expires_at) <= Date.now()) return fail('expired');
  if (typeof query.error === 'string') {
    return fail(query.error === 'access_denied' ? 'denied' : 'generic');
  }
  const code = typeof query.code === 'string' ? query.code : '';
  if (code.length === 0 || code.length > 2048) return fail('generic');

  const { draft } = pending;
  const signal = AbortSignal.timeout(CHECK_BUDGET_MS);
  let refreshToken;
  let account;
  try {
    ({ refreshToken, account } = await exchangeGoogleCode(
      {
        clientId: draft.clientId,
        clientSecret: draft.clientSecret,
        code,
        verifier: pending.code_verifier,
        redirectUri: mailGoogleRedirectUri(primary),
      },
      signal,
    ));
    await checkGmailCredentials(
      { clientId: draft.clientId, clientSecret: draft.clientSecret, refreshToken },
      { account, signal },
    );
  } catch (err) {
    logger?.warn(
      { reason: err instanceof MailDeliveryError ? err.reason : 'unexpected' },
      'Google consent not completed',
    );
    return fail('token');
  }

  try {
    const stored = await transportMutex.run(async () => {
      if (pending.domain !== null && !(await getDomain(pending.domain))) return null;
      const existing = transportRow(db, pending.domain);
      const settings = { clientId: draft.clientId, account };
      const row = await withSenderHost(draft.senderAddress, () =>
        writeTransportRow(db, {
          domain: pending.domain,
          kind: 'gmail-api',
          settings,
          secret: JSON.stringify({ clientSecret: draft.clientSecret, refreshToken }),
          senderAddress: draft.senderAddress,
          senderName: draft.senderName,
          dailyLimit: draft.dailyLimit ?? existing?.daily_limit ?? MAIL_DAILY_LIMIT.default,
          now: new Date(),
        }),
      );
      await revokeReplacedGrant(existing, refreshToken);
      return row;
    });
    if (stored === null) return fail('generic');
    // The page says whether the transport was stored; what the sync could
    // not do is logged and reported where it applies (notifications, the
    // next change or start).
    await syncMail({ logger }).catch((err) => {
      logger?.warn({ err: err?.message }, 'Mail synchronisation after the consent failed');
    });
    await recordAuditBestEffort(
      {
        actor: draft.actor,
        action: 'mail.transport.set',
        details: {
          scope: pending.domain ?? 'relay',
          kind: 'gmail-api',
          account,
          sender: draft.senderAddress,
          dailyLimit: stored.daily_limit,
        },
      },
      logger,
    );
    return {
      found: true,
      primary,
      result: {
        ok: true,
        sender: { address: stored.sender_address, name: stored.sender_name },
      },
    };
  } catch (err) {
    if (err?.code === 'mail_sender_host_taken') return fail('sender');
    logger?.error({ err: err?.message }, 'Storing the Google transport failed');
    return fail('generic');
  }
}

/**
 * Change a row's sender, its name or (a row with its own transport) the
 * daily limit. 404 `mail_not_configured` without a row.
 *
 * @param {string | null} domain
 * @param {import('@lamalibre/lamaste').MailTransportPatch} patch
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function patchMailTransport(domain, patch, { actor, logger }) {
  const answer = await transportMutex.run(async () => {
    const scope = await mailScope(domain);
    const db = await getStateDb();
    const row = transportRow(db, scope);
    if (!row) {
      throw httpError(`No mail is set for ${scopeLabel(scope)}`, 404, {
        code: 'mail_not_configured',
      });
    }
    if (patch.dailyLimit !== undefined && row.kind === null) {
      throw httpError(
        'A sender-only override has no daily limit — its transport is the relay’s',
        400,
        {
          code: 'no_own_transport',
        },
      );
    }
    const write = () => patchTransportRow(db, row.id, { ...patch, now: new Date() });
    if (patch.senderAddress !== undefined) {
      await withSenderHost(patch.senderAddress, async () => write());
    } else {
      write();
    }
    await recordAuditBestEffort(
      {
        actor,
        action: 'mail.transport.set',
        details: {
          scope: scope ?? 'relay',
          kind: row.kind,
          ...(patch.senderAddress !== undefined ? { sender: patch.senderAddress } : {}),
          ...(patch.dailyLimit !== undefined ? { dailyLimit: patch.dailyLimit } : {}),
        },
      },
      logger,
    );
    return senderAnswer(scope);
  });
  return withMailSync(answer, logger);
}

/**
 * A domain's sender over the relay's transport (`PUT
 * /api/domains/:name/mail/sender`): a sender-only row, or the sender of the
 * domain's own transport.
 *
 * @param {string} domain
 * @param {import('@lamalibre/lamaste').MailSenderInput} input
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function setDomainMailSender(domain, input, { actor, logger }) {
  const answer = await transportMutex.run(async () => {
    const scope = await domainOr404(domain);
    const db = await getStateDb();
    const existing = transportRow(db, scope);
    await withSenderHost(input.senderAddress, async () => {
      if (existing) {
        patchTransportRow(db, existing.id, {
          senderAddress: input.senderAddress,
          senderName: input.senderName ?? null,
          now: new Date(),
        });
      } else {
        writeTransportRow(db, {
          domain: scope,
          kind: null,
          settings: null,
          secret: null,
          senderAddress: input.senderAddress,
          senderName: input.senderName ?? null,
          dailyLimit: null,
          now: new Date(),
        });
      }
    });
    await recordAuditBestEffort(
      {
        actor,
        action: 'mail.transport.set',
        details: { scope, kind: existing?.kind ?? null, sender: input.senderAddress },
      },
      logger,
    );
    return senderAnswer(scope);
  });
  return withMailSync(answer, logger);
}

/**
 * Remove the row of `domain` (null: the relay's). A Google grant is revoked
 * (best effort). Without a relay transport, domains whose rows set only a
 * sender send nothing — said in a warning.
 *
 * @param {string | null} domain
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function clearMailTransport(domain, { actor, logger }) {
  const answer = await transportMutex.run(async () => {
    const scope = await mailScope(domain);
    const db = await getStateDb();
    const removed = deleteTransportRow(db, scope);
    if (!removed) return { removed: false };
    const warnings = await revokeReplacedGrant(removed);
    if (scope === null) {
      const senderOnly = transportRows(db)
        .filter((r) => r.kind === null)
        .map((r) => r.domain);
      if (senderOnly.length > 0) {
        warnings.push({
          step: 'domains',
          message: `${senderOnly.join(', ')} set only a sender — they send no mail until the relay has a transport again`,
        });
      }
    }
    await recordAuditBestEffort(
      {
        actor,
        action: 'mail.transport.cleared',
        details: { scope: scope ?? 'relay', kind: removed.kind },
      },
      logger,
    );
    return { removed: true, ...(warnings.length ? { warnings } : {}) };
  });
  return answer.removed ? withMailSync(answer, logger) : answer;
}

/**
 * End a provider's limit refusal early (§3.7), once its console shows the
 * account sending again: every row on the sending account sends again.
 *
 * @param {string | null} domain
 * @param {{ actor: string, logger?: import('pino').Logger }} opts
 */
export async function resumeMailTransport(domain, { actor, logger }) {
  const scope = await mailScope(domain);
  const db = await getStateDb();
  const row = transportRow(db, scope);
  if (!row || row.kind === null) {
    throw httpError(`${scopeLabel(scope)} has no transport of its own`, 404, {
      code: 'mail_not_configured',
    });
  }
  updateAccountState(db, row.account_key, { limited_until: null, limited_reason: null });
  await recordAuditBestEffort(
    {
      actor,
      action: 'mail.transport.resumed',
      details: { scope: scope ?? 'relay', kind: row.kind },
    },
    logger,
  );
  return { transport: transportView(db, row) };
}

/**
 * Check every transport now (§5.1), sending nothing; record health, a
 * change of state notified. Sweeps old attempts and consents.
 *
 * @param {import('pino').Logger} [logger]
 */
export async function checkMailTransports(logger) {
  const db = await getStateDb();
  sweepMailRecords(db, new Date());
  for (const row of transportRows(db)) {
    if (row.kind === null) continue;
    let health = { status: 'up', reason: null };
    try {
      const { settings, secret, caCertificates } = deliveryParts(row);
      if (row.kind === 'gmail-api') {
        await checkGmailCredentials(
          { clientId: settings.clientId, ...secret },
          { account: settings.account, signal: AbortSignal.timeout(CHECK_BUDGET_MS) },
        );
      } else {
        await withDeadline(
          checkSmtpTransport(settings, secret.password, {
            ehloName: await ehloName(),
            caCertificates,
          }),
          CHECK_BUDGET_MS,
        );
      }
    } catch (err) {
      health = {
        status: 'down',
        reason: err instanceof MailDeliveryError ? err.reason : 'unexpected',
      };
    }
    // The row may have been replaced or removed while it was checked.
    const current = transportRow(db, row.domain);
    if (current?.id === row.id && current.updated_at === row.updated_at) {
      await recordHealth(db, current, health, logger);
    }
  }
}

let healthTimer = null;

/** Check the transports now and every 6 hours (§5.1). */
export function startMailHealthMonitor(logger) {
  if (healthTimer !== null) return;
  const run = () =>
    checkMailTransports(logger).catch((err) => {
      logger?.warn({ err: err?.message }, 'Mail transport check failed');
    });
  void run();
  healthTimer = setInterval(run, HEALTH_INTERVAL_MS);
  healthTimer.unref();
}

export function stopMailHealthMonitor() {
  if (healthTimer !== null) clearInterval(healthTimer);
  healthTimer = null;
}
