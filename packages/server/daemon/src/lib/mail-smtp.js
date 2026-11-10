/**
 * The `smtp` transport (packages/core/docs/mail-design.md §3.1, §3.4):
 * nodemailer's SMTP client, implicit TLS (`tls`) or STARTTLS required
 * (`starttls`) — never plaintext — certificates always verified, against
 * the system roots plus, for this transport only, its own CA bundle
 * (`caPem`, Q4).
 *
 * nodemailer never reads a file or a URL here (`disableFileAccess`,
 * `disableUrlAccess`) and logs nothing: its debug output would carry the
 * conversation, AUTH included.
 */

import { isIP } from 'node:net';
import { rootCertificates } from 'node:tls';

import nodemailer from 'nodemailer';

import { MailDeliveryError } from './mail-errors.js';

/** Connection, greeting and socket timeouts (ms) — inside the 30 s send budget. */
const SMTP_TIMEOUTS = Object.freeze({ connection: 10_000, greeting: 10_000, socket: 20_000 });

/** Error codes of nodemailer's SMTP client that mean the connection itself failed. */
const CONNECTION_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EPROTOCOL']);

/**
 * The nodemailer transport for `settings` and its password.
 *
 * @param {import('@lamalibre/lamaste').SmtpTransportSettings} settings
 * @param {string | null} password
 * @param {{ ehloName: string, caCertificates: string[] | null }} opts
 */
function smtpTransport(settings, password, { ehloName, caCertificates }) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    ignoreTLS: false,
    name: ehloName,
    auth: settings.username ? { user: settings.username, pass: password ?? '' } : undefined,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      // SNI names a host, never an address (RFC 6066); the certificate is
      // checked against the host either way.
      ...(isIP(settings.host) ? {} : { servername: settings.host }),
      ...(caCertificates ? { ca: [...rootCertificates, ...caCertificates] } : {}),
    },
    connectionTimeout: SMTP_TIMEOUTS.connection,
    greetingTimeout: SMTP_TIMEOUTS.greeting,
    socketTimeout: SMTP_TIMEOUTS.socket,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}

/** Words with which providers say "you sent too much". */
const LIMIT_TEXT = /\b(limit|limits|quota|too many|rate)\b/i;
/** Enhanced status codes that say it whatever the words: too many recipients/messages, Gmail's daily quota. */
const LIMIT_CODES = /\b(4\.5\.3|5\.4\.5)\b/;
/** An enhanced status code of the security or policy class (5.7.x / 4.7.x). */
const POLICY_CODE = /\b[45]\.7\.\d{1,3}\b/;

/**
 * The stage of the SMTP exchange a failure came at, from nodemailer's
 * `err.command`: `session` (the connection, greeting, EHLO, STARTTLS),
 * `auth`, `mail` (`MAIL FROM`), `rcpt` (`RCPT TO`), `data`, or `api` (the
 * client refused before sending).
 */
function smtpStage(err) {
  const command = typeof err?.command === 'string' ? err.command.toUpperCase() : '';
  if (command === 'RCPT TO') return 'rcpt';
  if (command === 'MAIL FROM') return 'mail';
  if (command === 'DATA') return 'data';
  if (command.startsWith('AUTH')) return 'auth';
  if (command === 'API') return 'api';
  return 'session';
}

/**
 * What a failed SMTP exchange means (§3.6, §3.7). Only answers about the
 * account — to the session (a 421 with limit words, or a reply to
 * `MAIL FROM` or `DATA`) — stop or flag the account:
 *
 * - `limited`: `4.5.3`/`5.4.5`, or a 421, 452, 550/554 or 5.7.x/4.7.x reply
 *   saying limit, quota, too many or rate — at the session, `MAIL FROM` or
 *   `DATA`;
 * - `down` `policy`: another 5.7.x/4.7.x reply to `MAIL FROM` (the sender
 *   is not allowed) — an administrator acts, sending goes on;
 * - `down` `auth` / `tls`: AUTH or the certificate refused.
 *
 * A refusal at `RCPT TO` concerns that one recipient, whatever it says: a
 * 4xx is transient, a 5xx `refused` for that message alone. Connection
 * failures and other 4xx are transient; other 5xx refuse this message.
 */
export function smtpFailure(err) {
  if (err instanceof MailDeliveryError) return err;
  const code = typeof err?.code === 'string' ? err.code : '';
  const responseCode = Number.isInteger(err?.responseCode) ? err.responseCode : null;
  const response = typeof err?.response === 'string' ? err.response : '';
  const stage = smtpStage(err);

  if (stage === 'rcpt' && responseCode !== null) {
    return responseCode < 500
      ? new MailDeliveryError('transient', `smtp_rcpt_${responseCode}`, { cause: err })
      : new MailDeliveryError('refused', `smtp_rcpt_${responseCode}`, { cause: err });
  }
  if (
    responseCode !== null &&
    responseCode >= 400 &&
    (stage === 'session' || stage === 'mail' || stage === 'data')
  ) {
    const limitWords =
      LIMIT_TEXT.test(response) &&
      ([421, 450, 451, 452, 550, 554].includes(responseCode) || POLICY_CODE.test(response));
    if (LIMIT_CODES.test(response) || limitWords) {
      return new MailDeliveryError('limited', 'provider_limit', { cause: err });
    }
    if (stage === 'mail' && POLICY_CODE.test(response)) {
      return new MailDeliveryError('down', 'policy', { cause: err });
    }
  }
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) {
    return new MailDeliveryError('down', 'auth', { cause: err });
  }
  if (code === 'ETLS' || /certificate|self.signed|unable to verify/i.test(String(err?.message))) {
    return new MailDeliveryError('down', 'tls', { cause: err });
  }
  if (code === 'ETIMEDOUT') return new MailDeliveryError('transient', 'timeout', { cause: err });
  if (CONNECTION_CODES.has(code) && responseCode === null) {
    return new MailDeliveryError('transient', 'connection', { cause: err });
  }
  if (responseCode !== null && responseCode >= 400 && responseCode < 500) {
    return new MailDeliveryError('transient', `smtp_${responseCode}`, { cause: err });
  }
  if (responseCode !== null && responseCode >= 500) {
    return new MailDeliveryError('refused', `smtp_${responseCode}`, { cause: err });
  }
  if (CONNECTION_CODES.has(code)) {
    return new MailDeliveryError('transient', 'connection', { cause: err });
  }
  return new MailDeliveryError('transient', 'smtp', { cause: err });
}

/**
 * Admission (§3.4), sending nothing: connect, TLS, EHLO with the panel's
 * hostname, AUTH when a username is set — nodemailer's `verify`. Whether
 * the server takes the sender shows at the test mail: nodemailer has no
 * public `MAIL FROM` without a message.
 *
 * @param {import('@lamalibre/lamaste').SmtpTransportSettings} settings
 * @param {string | null} password
 * @param {{ ehloName: string, caCertificates: string[] | null }} opts
 */
export async function checkSmtpTransport(settings, password, opts) {
  const transport = smtpTransport(settings, password, opts);
  try {
    await transport.verify();
  } catch (err) {
    throw smtpFailure(err);
  } finally {
    transport.close();
  }
}

/**
 * Deliver one composed message: envelope sender and one recipient, the
 * message as composed (`raw`).
 *
 * @param {import('@lamalibre/lamaste').SmtpTransportSettings} settings
 * @param {string | null} password
 * @param {{ from: string, to: string, raw: Buffer }} message
 * @param {{ ehloName: string, caCertificates: string[] | null }} opts
 */
export async function sendSmtpMessage(settings, password, message, opts) {
  const transport = smtpTransport(settings, password, opts);
  try {
    await transport.sendMail({
      envelope: { from: message.from, to: [message.to] },
      raw: message.raw,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch (err) {
    throw smtpFailure(err);
  } finally {
    transport.close();
  }
}
