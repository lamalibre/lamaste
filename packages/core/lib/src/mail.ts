/**
 * The relay's mail (packages/core/docs/mail-design.md): the transports it
 * sends through, their senders, which transport a mail takes, and which
 * addresses can receive one.
 *
 * Browser-safe (zod and the dependency-free constants only), exported as
 * `@lamalibre/lamaste/mail`: the panel's Mail settings import the rules
 * instead of copying them. What needs node — parsing a CA certificate,
 * rendering Authelia's notifier — lives in `server/mail.ts` and
 * `server/authelia.ts`.
 *
 * One **relay-wide** transport carries Authelia's mail and is every
 * domain's default; a domain may override the sender, or the sender and
 * the transport, for Lamaste's own mails to it (decision D2).
 */

import { z } from 'zod';

import { HOSTNAME_REGEX } from './constants.js';
import { hasControlCharacters } from './text-rules.js';

// ---------------------------------------------------------------------------
// Kinds and limits
// ---------------------------------------------------------------------------

/** How a transport delivers: Google's Gmail API over HTTPS, or any SMTP server. */
export const MAIL_TRANSPORT_KINDS = ['gmail-api', 'smtp'] as const;
export type MailTransportKind = (typeof MAIL_TRANSPORT_KINDS)[number];

/** `tls`: implicit TLS from the first byte (465); `starttls`: upgraded after EHLO (587). */
export const SMTP_SECURITY_MODES = ['starttls', 'tls'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY_MODES)[number];

/** At most this many bytes of PEM in a transport's own CA bundle (`caPem`). */
export const MAIL_CA_PEM_MAX_BYTES = 16 * 1024;

/** At most this many certificates in a transport's own CA bundle. */
export const MAIL_CA_PEM_MAX_CERTIFICATES = 10;

/** An e-mail address is at most this long (RFC 5321's path limit). */
export const MAIL_ADDRESS_MAX_LENGTH = 254;

/** A sender's display name is at most this long. */
export const MAIL_SENDER_NAME_MAX_LENGTH = 64;

/**
 * What a mail send ended in, as an invitation records it:
 * `deferred-budget` — not sent, the sending budget (§3.7) or the
 * provider's own limit held it back.
 */
export const MAIL_SEND_STATUSES = ['sent', 'failed', 'not-configured', 'deferred-budget'] as const;
export type MailSendStatus = (typeof MAIL_SEND_STATUSES)[number];

// ---------------------------------------------------------------------------
// Sending budget (§3.7)
// ---------------------------------------------------------------------------

/**
 * Who a mail is for, in the order the budget protects them: `essential`
 * (Authelia's mail, password-changed notices, test mails) and `admin`
 * (an administrator's invitations) may use the whole ceiling; `public`
 * (reset mails, delegated invitations — what anyone can make the relay
 * send) stops short of a reserve.
 */
export const MAIL_SEND_CLASSES = ['essential', 'admin', 'public'] as const;
export type MailSendClass = (typeof MAIL_SEND_CLASSES)[number];

/** What a mail is — recorded with each send (no address, no subject); the reset cap counts `reset`. */
export const MAIL_KINDS = ['authelia', 'invitation', 'reset', 'password-changed', 'test'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** A transport's daily limit: the provider's per-account limit the administrator enters. */
export const MAIL_DAILY_LIMIT = Object.freeze({
  min: 1,
  max: 100_000,
  /** Google Workspace's trial limit — the safe default for every kind. */
  default: 500,
});

/** The budget's fixed ratios and caps (§3.7). */
export const MAIL_BUDGET = Object.freeze({
  /** Lamaste sends at most this share of the daily limit in 24 h. */
  ceilingRatio: 0.9,
  /** The share of the ceiling `public` mails never use. */
  publicReserveRatio: 0.2,
  /** Usage at this share of the ceiling warns the administrators. */
  warningRatio: 0.7,
  /** Reset mails per sending account per hour. */
  resetsPerHour: 30,
  /** How long a provider's limit refusal stops a sending account. */
  limitedHours: 24,
  /** The window usage is counted over (rolling, as Google's). */
  windowHours: 24,
});

/** The thresholds of a daily limit: what may be sent, what `public` may, where the warning is. */
export function mailBudgetThresholds(dailyLimit: number): {
  ceiling: number;
  publicCap: number;
  warningAt: number;
} {
  if (!Number.isInteger(dailyLimit) || dailyLimit < MAIL_DAILY_LIMIT.min) {
    throw new Error('A daily limit is a positive integer');
  }
  const ceiling = Math.max(1, Math.floor(dailyLimit * MAIL_BUDGET.ceilingRatio));
  const reserve = Math.ceil(ceiling * MAIL_BUDGET.publicReserveRatio);
  return {
    ceiling,
    publicCap: Math.max(0, ceiling - reserve),
    warningAt: Math.ceil(ceiling * MAIL_BUDGET.warningRatio),
  };
}

/** Why the budget holds a mail back. */
export type MailBudgetRefusal = 'limited' | 'ceiling' | 'public-cap' | 'reset-cap';

/**
 * Whether one more mail of `sendClass`/`kind` may go through a sending
 * account that sent `sent24h` mails in the last 24 h and `resetsLastHour`
 * reset mails in the last hour, `limitedUntil` the end of a provider's
 * refusal (ISO, or null). Pure.
 */
export function mailBudgetDecision(input: {
  readonly dailyLimit: number;
  readonly sent24h: number;
  readonly resetsLastHour: number;
  readonly sendClass: MailSendClass;
  readonly kind: MailKind;
  readonly limitedUntil: string | null;
  readonly now: Date;
}): { ok: true } | { ok: false; reason: MailBudgetRefusal } {
  if (input.limitedUntil !== null && Date.parse(input.limitedUntil) > input.now.getTime()) {
    return { ok: false, reason: 'limited' };
  }
  const { ceiling, publicCap } = mailBudgetThresholds(input.dailyLimit);
  if (input.sent24h >= ceiling) return { ok: false, reason: 'ceiling' };
  if (input.sendClass === 'public' && input.sent24h >= publicCap) {
    return { ok: false, reason: 'public-cap' };
  }
  if (input.kind === 'reset' && input.resetsLastHour >= MAIL_BUDGET.resetsPerHour) {
    return { ok: false, reason: 'reset-cap' };
  }
  return { ok: true };
}

/** What `GET /api/settings/mail` shows of a sending account's budget. */
export interface MailBudgetView {
  readonly dailyLimit: number;
  readonly ceiling: number;
  readonly publicCap: number;
  /** Delivery attempts through the sending account in the last 24 h (every row on it). */
  readonly sent24h: number;
  readonly byClass: Readonly<Record<MailSendClass, number>>;
  readonly resetsLastHour: number;
  /** A provider's limit refusal stops the account until then (ISO), or null. */
  readonly limitedUntil: string | null;
  /** When the oldest counted mail leaves the window while at the ceiling (ISO), or null. */
  readonly resumesAt: string | null;
}

/**
 * Top-level names no mail is delivered to (RFC 2606, RFC 6761, and
 * `.local`, which the onboarding administrator's placeholder address
 * uses): an address under one is never offered a reset (§4).
 */
export const UNDELIVERABLE_MAIL_TLDS: readonly string[] = Object.freeze([
  'example',
  'invalid',
  'local',
  'localhost',
  'test',
]);

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** A dot-atom local part: RFC 5322 atext, dots only between atoms, ≤ 64 characters. */
const LOCAL_PART_RE =
  /^(?=.{1,64}$)[A-Za-z0-9!#%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#%&'*+/=?^_`{|}~-]+)*$/;

/**
 * `value` as `{ local, domain }` (the domain lower-cased) when it is an
 * address Lamaste sends to or from: a dot-atom local part (no quoted
 * strings, no `$`, which a configuration template could read) and a
 * hostname of at least two labels. Null for anything else.
 */
export function parseMailAddress(value: unknown): { local: string; domain: string } | null {
  if (typeof value !== 'string' || value.length > MAIL_ADDRESS_MAX_LENGTH) return null;
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (!LOCAL_PART_RE.test(local) || !HOSTNAME_REGEX.test(domain)) return null;
  return { local, domain };
}

/** The address's domain, lower-cased, or null when it is no address. */
export function mailAddressDomain(value: unknown): string | null {
  return parseMailAddress(value)?.domain ?? null;
}

/**
 * Whether mail to `value` can arrive: an address ({@link parseMailAddress})
 * whose domain is under none of {@link UNDELIVERABLE_MAIL_TLDS}. Users
 * without one cannot reset their own password.
 */
export function isDeliverableAddress(value: unknown): boolean {
  const parsed = parseMailAddress(value);
  if (parsed === null) return false;
  const tld = parsed.domain.slice(parsed.domain.lastIndexOf('.') + 1);
  return !UNDELIVERABLE_MAIL_TLDS.includes(tld);
}

/** An address as a schema field: trimmed, {@link parseMailAddress}, the domain lower-cased. */
export const MailAddressSchema = z
  .string()
  .trim()
  .refine((value) => parseMailAddress(value) !== null, 'Not a valid e-mail address')
  .transform((value) => {
    const parsed = parseMailAddress(value);
    return parsed === null ? value : `${parsed.local}@${parsed.domain}`;
  });

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

/** Who a mail is from: the address, and the name a mail program shows. */
export interface MailSender {
  readonly address: string;
  /** Null: the domain's brand name, else "Lamaste". */
  readonly name: string | null;
}

/**
 * Whether `name` may be a sender's display name: 1–64 characters, no
 * control or bidirectional characters, none of `"`, `\`, `<`, `>` (it is
 * written as a quoted string in a header) and no `{{`/`}}` (Authelia's
 * configuration is a Go template).
 */
export function isMailSenderName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim() === name &&
    name.length >= 1 &&
    name.length <= MAIL_SENDER_NAME_MAX_LENGTH &&
    !hasControlCharacters(name) &&
    !/["\\<>]/.test(name) &&
    !name.includes('{{') &&
    !name.includes('}}')
  );
}

export const MailSenderNameSchema = z
  .string()
  .trim()
  .refine(
    isMailSenderName,
    'A sender name is 1–64 characters without control characters, quotes, backslashes or angle brackets',
  );

/**
 * The sender as a `From` mailbox: `"Name" <address>`, or the address alone
 * for no name. The name holds no `"` or `\` ({@link isMailSenderName}), so
 * the quoted string needs no escape.
 */
export function formatMailbox(sender: MailSender): string {
  if (parseMailAddress(sender.address) === null) throw new Error('A sender is an e-mail address');
  if (sender.name === null) return sender.address;
  if (!isMailSenderName(sender.name)) throw new Error('Not a sender name');
  return `"${sender.name}" <${sender.address}>`;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** A PEM certificate block, as the bundle must consist of. */
const PEM_CERTIFICATE_RE =
  /-----BEGIN CERTIFICATE-----\r?\n((?:[A-Za-z0-9+/=]{1,76}\r?\n)+)-----END CERTIFICATE-----/g;

/**
 * The certificate blocks of a CA bundle, each normalised to `\n` line ends
 * — or null when the text is anything else: more than
 * {@link MAIL_CA_PEM_MAX_BYTES}, no block, more than
 * {@link MAIL_CA_PEM_MAX_CERTIFICATES}, or anything outside the blocks but
 * white space. Structure only: `server/mail.ts` `parseMailCaPem` checks
 * each is a CA certificate.
 */
export function splitPemCertificates(pem: unknown): string[] | null {
  if (typeof pem !== 'string' || new TextEncoder().encode(pem).length > MAIL_CA_PEM_MAX_BYTES) {
    return null;
  }
  const blocks: string[] = [];
  const rest = pem.replace(PEM_CERTIFICATE_RE, (block) => {
    blocks.push(`${block.replace(/\r\n/g, '\n')}\n`);
    return '';
  });
  if (rest.trim() !== '' || blocks.length === 0 || blocks.length > MAIL_CA_PEM_MAX_CERTIFICATES) {
    return null;
  }
  return blocks;
}

/** What an `smtp` transport stores beside its secret (the password). */
export const SmtpTransportSettingsSchema = z
  .object({
    host: z
      .string()
      .trim()
      .toLowerCase()
      .refine((h) => HOSTNAME_REGEX.test(h) || IPV4_RE.test(h), 'Not a hostname or IPv4 address'),
    port: z.number().int().min(1).max(65535),
    security: z.enum(SMTP_SECURITY_MODES),
    /** SMTP AUTH user; omitted: no AUTH. */
    username: z
      .string()
      .min(1)
      .max(256)
      .refine((u) => !hasControlCharacters(u) && !/\s/.test(u), 'Invalid username')
      .optional(),
    /** CA certificates trusted beside the system's, for this transport only. */
    caPem: z
      .string()
      .refine((pem) => splitPemCertificates(pem) !== null, 'Not a bundle of PEM certificates')
      .optional(),
  })
  .strict();
export type SmtpTransportSettings = z.output<typeof SmtpTransportSettingsSchema>;

/** A Google OAuth client id: `<project number>-<id>.apps.googleusercontent.com`. */
export const GOOGLE_CLIENT_ID_RE = /^[0-9]{1,32}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/;

/** What a `gmail-api` transport stores beside its secret (client secret + refresh token). */
export const GmailApiTransportSettingsSchema = z
  .object({
    clientId: z.string().regex(GOOGLE_CLIENT_ID_RE),
    /** The Workspace user the refresh token belongs to (read at consent). */
    account: MailAddressSchema,
  })
  .strict();
export type GmailApiTransportSettings = z.output<typeof GmailApiTransportSettingsSchema>;

/** A transport: its kind and what it stores beside its secret. */
export type MailTransportSettings =
  | { readonly kind: 'smtp'; readonly settings: SmtpTransportSettings }
  | { readonly kind: 'gmail-api'; readonly settings: GmailApiTransportSettings };

/**
 * One row of the relay's mail configuration: the relay's (`domain` null,
 * always a transport) or a domain's override (a sender, and maybe its own
 * transport).
 */
export interface MailTransportRecord {
  readonly domain: string | null;
  /** Null on a domain row: the relay's transport with this row's sender. */
  readonly transport: MailTransportSettings | null;
  readonly sender: MailSender;
}

/** The transport a mail takes, and from whom it is. */
export interface ResolvedMailTransport {
  /** Whose row holds the transport and its secret: a domain's, or the relay's (null). */
  readonly transportOf: string | null;
  readonly transport: MailTransportSettings;
  readonly sender: MailSender;
}

/**
 * Which transport a mail for `domain` takes (§3.1), `domain` null for the
 * relay's own mail (Authelia's): the domain's row if it names a transport;
 * else the relay's transport with the domain row's sender, if there is
 * one; else the relay's row as it is. Null when nothing can send — no
 * relay transport and no own one. Pure.
 */
export function resolveMailTransport(
  domain: string | null,
  records: readonly MailTransportRecord[],
): ResolvedMailTransport | null {
  const relay = records.find((r) => r.domain === null && r.transport !== null) ?? null;
  const own =
    domain === null ? null : (records.find((r) => r.domain === domain.toLowerCase()) ?? null);
  if (own?.transport) {
    return { transportOf: own.domain, transport: own.transport, sender: own.sender };
  }
  if (relay?.transport == null) return null;
  return { transportOf: null, transport: relay.transport, sender: own?.sender ?? relay.sender };
}

/** Whether mail for `domain` (null: the relay's own) can be sent at all. */
export function canSendMail(
  domain: string | null,
  records: readonly MailTransportRecord[],
): boolean {
  return resolveMailTransport(domain, records) !== null;
}

/**
 * The domains of every configured sender, lower-cased, each once: hostnames
 * that are not web hostnames (decision D6) — a sending subdomain carries MX
 * and TXT records, so the relay's wildcard no longer answers for it.
 */
export function mailSenderDomains(records: readonly MailTransportRecord[]): string[] {
  const domains = new Set<string>();
  for (const record of records) {
    const domain = mailAddressDomain(record.sender.address);
    if (domain !== null) domains.add(domain);
  }
  return [...domains].sort();
}

// ---------------------------------------------------------------------------
// API bodies and views
// ---------------------------------------------------------------------------

/** A daily limit as a body field. */
const DailyLimitSchema = z.number().int().min(MAIL_DAILY_LIMIT.min).max(MAIL_DAILY_LIMIT.max);

/** A secret as typed: 1–1024 characters, no control characters. */
const SecretInputSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((s) => !hasControlCharacters(s), 'Contains control characters');

/** The sender fields of every body that sets one. */
const SenderFields = {
  senderAddress: MailAddressSchema,
  /** Null or omitted: the domain's brand name, else "Lamaste". */
  senderName: MailSenderNameSchema.nullable().optional(),
};

/**
 * `PUT /api/settings/mail` (and a domain's): an `smtp` transport — checked
 * before it is stored. `password` omitted keeps the stored one.
 */
export const SmtpTransportInputSchema = SmtpTransportSettingsSchema.extend({
  password: SecretInputSchema.optional(),
  /** Omitted: the stored one, else {@link MAIL_DAILY_LIMIT}'s default. */
  dailyLimit: DailyLimitSchema.optional(),
  ...SenderFields,
}).strict();
export type SmtpTransportInput = z.output<typeof SmtpTransportInputSchema>;
/** What a client sends ({@link SmtpTransportInputSchema} before parsing). */
export type SmtpTransportRequest = z.input<typeof SmtpTransportInputSchema>;

/** `POST /api/settings/mail/google/start` (and a domain's): what the consent will store. */
export const MailGoogleStartInputSchema = z
  .object({
    clientId: z.string().trim().regex(GOOGLE_CLIENT_ID_RE),
    clientSecret: z
      .string()
      .trim()
      .min(8)
      .max(256)
      .regex(/^[\x21-\x7e]+$/),
    /** Omitted: the stored one, else {@link MAIL_DAILY_LIMIT}'s default. */
    dailyLimit: DailyLimitSchema.optional(),
    ...SenderFields,
  })
  .strict();
export type MailGoogleStartInput = z.output<typeof MailGoogleStartInputSchema>;
export type MailGoogleStartRequest = z.input<typeof MailGoogleStartInputSchema>;

/** A domain's sender-only override (`PUT /api/domains/:name/mail/sender`). */
export const MailSenderInputSchema = z.object(SenderFields).strict();
export type MailSenderInput = z.output<typeof MailSenderInputSchema>;
export type MailSenderRequest = z.input<typeof MailSenderInputSchema>;

/**
 * `PATCH /api/settings/mail` (and a domain's): the sender, its name or the
 * daily limit — at least one; a sender's address only with its field.
 */
export const MailTransportPatchSchema = z
  .object({
    senderAddress: MailAddressSchema.optional(),
    senderName: MailSenderNameSchema.nullable().optional(),
    dailyLimit: DailyLimitSchema.optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.senderAddress !== undefined ||
      body.senderName !== undefined ||
      body.dailyLimit !== undefined,
    'Nothing to change',
  );
export type MailTransportPatch = z.output<typeof MailTransportPatchSchema>;
export type MailTransportPatchRequest = z.input<typeof MailTransportPatchSchema>;

/** `POST /api/settings/mail/test`. */
export const MailTestInputSchema = z.object({ to: MailAddressSchema }).strict();
export type MailTestInput = z.output<typeof MailTestInputSchema>;

/** What the API shows of an `smtp` transport: never the password, the CA bundle only as present. */
export interface SmtpTransportView {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly username: string | null;
  readonly hasCaPem: boolean;
}

/** The last check of a transport (§5.1). */
export interface MailTransportHealth {
  readonly status: 'up' | 'down' | 'unknown';
  readonly checkedAt: string | null;
  /** Why it is down — `invalid_grant` means "consent again". */
  readonly reason: string | null;
}

/** A row as `GET /api/settings/mail` and `GET /api/domains/:name/mail` answer it. */
export interface MailTransportView {
  readonly scope: 'relay' | 'domain';
  readonly domain: string | null;
  /** Null on a domain row that sets a sender only. */
  readonly kind: MailTransportKind | null;
  readonly settings: SmtpTransportView | GmailApiTransportSettings | null;
  readonly sender: MailSender;
  readonly hasSecret: boolean;
  readonly verifiedAt: string;
  readonly updatedAt: string;
  readonly health: MailTransportHealth | null;
  /** The sending account's budget; null on a domain row that sets a sender only. */
  readonly budget: MailBudgetView | null;
}

/** What a send did, as invitation answers carry it. */
export interface MailSendResult {
  readonly status: MailSendStatus;
  /** A class of failure, never a provider's message. */
  readonly error?: string;
}

/**
 * What became of the mail of an invitation's current link (§6.1): its
 * status (null before 4.13, or while it is being sent) and when it was
 * sent.
 */
export interface InvitationMailState {
  readonly status: MailSendStatus | null;
  readonly sentAt: string | null;
}
