/**
 * Mail for `lamaste-server mail` and `domains mail <name>`
 * (packages/core/docs/mail-design.md §3.5): the paths of a scope, the
 * flags of each subcommand, the request bodies, and a transport as lines.
 * Pure — no panel calls, no stdin; a secret reaches these functions only
 * as the value read for it, and none of them prints one.
 */

import { MAIL_BUDGET, MAIL_DAILY_LIMIT, SMTP_SECURITY_MODES } from '@lamalibre/lamaste/mail';
import { terminalText } from './plugin-settings.js';

/** `/api/settings/mail<rest>` for the relay (`domain` null), else `/api/domains/<d>/mail<rest>`. */
export function mailPath(domain, rest = '') {
  return domain === null
    ? `/api/settings/mail${rest}`
    : `/api/domains/${encodeURIComponent(domain)}/mail${rest}`;
}

/** Flags that would put a secret on the command line — refused, with where it goes instead. */
const SECRET_FLAGS = Object.freeze({
  '--password': '--password-stdin (or the prompt)',
  '--client-secret': '--client-secret-stdin (or the prompt)',
});

/**
 * Parse `args` against `spec` (`values`: flags taking a value, as
 * `--flag value` or `--flag=value`; `switches`: flags taking none).
 * Throws on anything else, and on a secret given as a flag.
 *
 * @param {string[]} args
 * @param {{ values?: string[], switches?: string[] }} spec
 * @returns {Record<string, string | true>}
 */
export function parseMailFlags(args, { values = [], switches = [] } = {}) {
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    if (SECRET_FLAGS[name]) {
      throw new Error(`A secret is never accepted on the command line — use ${SECRET_FLAGS[name]}`);
    }
    const key = name.replace(/^--/, '');
    if (switches.includes(key) && name === arg) {
      flags[key] = true;
    } else if (values.includes(key)) {
      const value = name === arg ? args[++i] : arg.slice(eq + 1);
      if (value === undefined || value === '') throw new Error(`${name} needs a value`);
      flags[key] = value;
    } else {
      throw new Error(`Unknown argument: ${terminalText(arg)}`);
    }
  }
  return flags;
}

/** A daily limit flag as a number, or throw. */
export function parseDailyLimitFlag(text) {
  const value = Number(text);
  if (!Number.isInteger(value) || value < MAIL_DAILY_LIMIT.min || value > MAIL_DAILY_LIMIT.max) {
    throw new Error(
      `A daily limit is a whole number from ${MAIL_DAILY_LIMIT.min} to ${MAIL_DAILY_LIMIT.max}`,
    );
  }
  return value;
}

/** The sender fields of `flags` (`--sender`, `--sender-name`), the daily limit when given. */
function senderAndLimit(flags) {
  if (typeof flags.sender !== 'string') throw new Error('--sender <address> is required');
  return {
    senderAddress: flags.sender,
    ...(typeof flags['sender-name'] === 'string' ? { senderName: flags['sender-name'] } : {}),
    ...(typeof flags['daily-limit'] === 'string'
      ? { dailyLimit: parseDailyLimitFlag(flags['daily-limit']) }
      : {}),
  };
}

/** The flags of `mail set-smtp`. */
export const SMTP_FLAGS = Object.freeze({
  values: [
    'host',
    'port',
    'security',
    'username',
    'ca-file',
    'sender',
    'sender-name',
    'daily-limit',
  ],
  switches: ['password-stdin'],
});

/**
 * The body of `PUT …/mail` from `set-smtp`'s flags, the password read (or
 * null: keep the stored one) and the CA bundle read (or null: none).
 */
export function smtpRequest(flags, { password = null, caPem = null } = {}) {
  if (typeof flags.host !== 'string') throw new Error('--host <host> is required');
  const port = flags.port === undefined ? 587 : Number(flags.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port is 1 to 65535');
  const security = flags.security ?? (port === 465 ? 'tls' : 'starttls');
  if (!SMTP_SECURITY_MODES.includes(security)) {
    throw new Error(`--security is ${SMTP_SECURITY_MODES.join(' or ')}`);
  }
  if (password !== null && typeof flags.username !== 'string') {
    throw new Error('A password needs --username');
  }
  return {
    host: flags.host,
    port,
    security,
    ...(typeof flags.username === 'string' ? { username: flags.username } : {}),
    ...(password !== null ? { password } : {}),
    ...(caPem !== null ? { caPem } : {}),
    ...senderAndLimit(flags),
  };
}

/** The flags of `mail google`. */
export const GOOGLE_FLAGS = Object.freeze({
  values: ['client-id', 'sender', 'sender-name', 'daily-limit'],
  switches: ['client-secret-stdin', 'no-wait'],
});

/** The body of `POST …/mail/google/start` without its secret, from `google`'s flags (checked before the secret is read). */
export function googleFields(flags) {
  if (typeof flags['client-id'] !== 'string') throw new Error('--client-id <id> is required');
  return { clientId: flags['client-id'], ...senderAndLimit(flags) };
}

/** The body of `POST …/mail/google/start`: {@link googleFields} and the client secret read. */
export function googleRequest(flags, clientSecret) {
  if (!clientSecret) throw new Error('The OAuth client secret is required');
  return { ...googleFields(flags), clientSecret };
}

/** The flags of `mail sender`. */
export const SENDER_FLAGS = Object.freeze({ values: ['address', 'name'], switches: ['no-name'] });

/**
 * The body of a sender change: the relay's `PATCH` (`senderOnly` false —
 * what is given changes) or a domain's `PUT …/mail/sender` (the address
 * required, no name = the brand's).
 */
export function senderRequest(flags, { senderOnly }) {
  if (flags.name !== undefined && flags['no-name'])
    throw new Error('--name or --no-name, not both');
  const name = flags['no-name'] ? null : flags.name;
  if (senderOnly && typeof flags.address !== 'string')
    throw new Error('--address <address> is required');
  const body = {
    ...(typeof flags.address === 'string' ? { senderAddress: flags.address } : {}),
    ...(name !== undefined ? { senderName: name } : {}),
  };
  if (Object.keys(body).length === 0)
    throw new Error('Nothing to change: give --address, --name or --no-name');
  return body;
}

/** `Name <address>`, or the address alone. */
function senderText(sender) {
  return sender?.name ? `${sender.name} <${sender.address}>` : (sender?.address ?? '—');
}

/** What sends, in a line. */
function kindLine(transport) {
  if (transport.kind === null) return 'the relay’s transport, with this domain’s sender';
  if (transport.kind === 'gmail-api') return `Gmail API as ${transport.settings?.account ?? '?'}`;
  const s = transport.settings ?? {};
  return (
    `SMTP ${s.host}:${s.port} (${s.security === 'tls' ? 'TLS' : 'STARTTLS'}` +
    `${s.username ? `, as ${s.username}` : ', no sign-in'}${s.hasCaPem ? ', private CA' : ''})`
  );
}

/**
 * A transport as `[label, value]` lines (`show`), values terminal-safe:
 * what sends, the sender, the last check, the budget.
 *
 * @param {import('@lamalibre/lamaste').MailTransportView} transport
 * @param {number} now epoch ms
 * @returns {Array<[string, string]>}
 */
export function transportLines(transport, now) {
  /** @type {Array<[string, string]>} */
  const lines = [
    ['Transport', kindLine(transport)],
    ['Sender', senderText(transport.sender)],
  ];
  const health = transport.health;
  if (health) {
    const why =
      health.reason === 'invalid_grant'
        ? 'Google refused the grant — run `google` again'
        : health.reason;
    lines.push([
      'Check',
      `${health.status}${why ? ` (${why})` : ''}${health.checkedAt ? ` at ${health.checkedAt}` : ''}`,
    ]);
  }
  const budget = transport.budget;
  if (budget) {
    lines.push([
      'Budget',
      `${budget.sent24h} of ${budget.ceiling} in 24 h (daily limit ${budget.dailyLimit}, public up to ${budget.publicCap}; ` +
        `${budget.byClass.essential} essential, ${budget.byClass.admin} admin, ${budget.byClass.public} public)`,
    ]);
    lines.push([
      'Resets',
      `${budget.resetsLastHour} of ${MAIL_BUDGET.resetsPerHour} in the last hour`,
    ]);
    if (budget.limitedUntil && Date.parse(budget.limitedUntil) > now) {
      lines.push([
        'Limited',
        `the provider refused — nothing is sent until ${budget.limitedUntil} (or \`resume\`)`,
      ]);
    } else if (budget.resumesAt) {
      lines.push(['Ceiling', `reached — sending resumes at ${budget.resumesAt}`]);
    }
  }
  lines.push(['Updated', transport.updatedAt]);
  return lines.map(([label, value]) => [label, terminalText(value)]);
}

/**
 * Whether Google's consent stored the transport: a Google grant newer than
 * the one before (`before`: the transport's `updatedAt` when it started).
 */
export function consentStored(transport, before) {
  return transport?.kind === 'gmail-api' && transport.updatedAt !== before;
}
