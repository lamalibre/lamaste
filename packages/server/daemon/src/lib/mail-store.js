/**
 * The relay's mail records in state.db (migration 0022;
 * packages/core/docs/mail-design.md §3.1, §3.7): the transports, the
 * sending accounts' state, every delivery attempt, Google consents under
 * way. Synchronous over `node:sqlite` — a budget check and the attempt it
 * admits are one step, so two sends never both take the last mail.
 *
 * Nothing here answers a secret: {@link transportView} is what the API
 * shows; {@link transportSecret} is for delivery only.
 */

import {
  MAIL_BUDGET,
  MAIL_SEND_CLASSES,
  authResetUrl,
  canSendMail,
  mailBudgetThresholds,
  mailSenderDomains,
} from '@lamalibre/lamaste';

const HOUR_MS = 3_600_000;

/** The sending account a transport counts against (§3.7). */
export function accountKeyOf(kind, settings) {
  if (kind === 'gmail-api') return `gmail:${settings.account}`;
  return `smtp:${settings.host}:${settings.username ?? '-'}`;
}

/** Every transport row, the relay's first. */
export function transportRows(db) {
  return db
    .prepare('SELECT * FROM mail_transports ORDER BY domain IS NOT NULL, domain')
    .all()
    .map((row) => ({ ...row }));
}

/** The row of `domain` (null: the relay's), or null. */
export function transportRow(db, domain) {
  const row =
    domain === null
      ? db.prepare('SELECT * FROM mail_transports WHERE domain IS NULL').get()
      : db.prepare('SELECT * FROM mail_transports WHERE domain = ?').get(domain);
  return row ? { ...row } : null;
}

/** A row as core's `MailTransportRecord`. */
export function rowRecord(row) {
  return {
    domain: row.domain,
    transport: row.kind === null ? null : { kind: row.kind, settings: JSON.parse(row.settings) },
    sender: { address: row.sender_address, name: row.sender_name },
  };
}

/** Every row as core's records — what `resolveMailTransport` takes. */
export function mailRecords(db) {
  return transportRows(db).map(rowRecord);
}

/**
 * The hostnames senders hold (decision D6): each sender's domain that lies
 * strictly under one of the relay's domains — there the subdomain's own
 * MX/TXT records end the wildcard's answer. A sender at a relay domain
 * itself or outside them takes no web hostname.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {readonly string[]} relayDomains every domain, pending ones too
 */
export function senderHostnames(db, relayDomains) {
  return mailSenderDomains(mailRecords(db)).filter((host) =>
    relayDomains.some((domain) => host.endsWith(`.${domain.toLowerCase()}`)),
  );
}

/**
 * Where the sign-in portals link "Reset password?" (mail-design.md §5,
 * Q1), from the records: `autheliaResetUrl` — Authelia's one
 * `password_reset.custom_url`, the primary's `https://auth.<primary>/reset`
 * while some active domain can send, else null (Authelia's reset
 * disabled) — and `domainResetUrl(domain)`, a portal's own page when its
 * domain can send, else null (the portal shows no reset link). Lamaste's
 * own reset sends through the domain's transport, never Authelia's.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ autheliaResetUrl: string | null, domainResetUrl: (domain: string) => string | null }}
 */
export function resetLinkState(db) {
  const records = mailRecords(db);
  const active = db
    .prepare("SELECT name, is_primary FROM domains WHERE status = 'active'")
    .all()
    .map((row) => ({ name: row.name, primary: row.is_primary === 1 }));
  const primary = active.find((d) => d.primary)?.name ?? null;
  const sends = (domain) => canSendMail(domain, records);
  return {
    autheliaResetUrl:
      primary !== null && active.some((d) => sends(d.name)) ? authResetUrl(primary) : null,
    domainResetUrl: (domain) =>
      active.some((d) => d.name === domain) && sends(domain) ? authResetUrl(domain) : null,
  };
}

/**
 * The secret of a row: smtp — `{ password }`; gmail-api — `{ clientSecret,
 * refreshToken }`.
 */
export function transportSecret(row) {
  if (row.kind === 'smtp') return { password: row.secret };
  if (row.kind === 'gmail-api') return JSON.parse(row.secret);
  return null;
}

/** The state of a sending account (a row when it has one). */
export function accountState(db, accountKey) {
  const row = db.prepare('SELECT * FROM mail_accounts WHERE account_key = ?').get(accountKey);
  return row
    ? { ...row }
    : {
        account_key: accountKey,
        limited_until: null,
        limited_reason: null,
        warned_at: null,
        exhausted_at: null,
      };
}

/** Change fields of a sending account's state. */
export function updateAccountState(db, accountKey, fields) {
  const current = accountState(db, accountKey);
  const next = { ...current, ...fields };
  db.prepare(
    `INSERT INTO mail_accounts (account_key, limited_until, limited_reason, warned_at, exhausted_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (account_key) DO UPDATE SET
       limited_until = excluded.limited_until, limited_reason = excluded.limited_reason,
       warned_at = excluded.warned_at, exhausted_at = excluded.exhausted_at`,
  ).run(accountKey, next.limited_until, next.limited_reason, next.warned_at, next.exhausted_at);
  return next;
}

/**
 * What a sending account sent: attempts in the last 24 h (all, and by
 * class), reset mails in the last hour, and the oldest attempt still in
 * the window.
 */
export function accountUsage(db, accountKey, now) {
  const since = new Date(now.getTime() - MAIL_BUDGET.windowHours * HOUR_MS).toISOString();
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
  const byClass = Object.fromEntries(MAIL_SEND_CLASSES.map((c) => [c, 0]));
  for (const row of db
    .prepare(
      'SELECT class, COUNT(*) AS n FROM mail_sends WHERE account_key = ? AND sent_at > ? GROUP BY class',
    )
    .all(accountKey, since)) {
    byClass[row.class] = row.n;
  }
  const resets = db
    .prepare(
      "SELECT COUNT(*) AS n FROM mail_sends WHERE account_key = ? AND kind = 'reset' AND sent_at > ?",
    )
    .get(accountKey, hourAgo).n;
  const oldest = db
    .prepare('SELECT MIN(sent_at) AS at FROM mail_sends WHERE account_key = ? AND sent_at > ?')
    .get(accountKey, since).at;
  return {
    sent24h: Object.values(byClass).reduce((a, b) => a + b, 0),
    byClass,
    resetsLastHour: resets,
    oldestAt: oldest ?? null,
  };
}

/** Record one delivery attempt (counted as `failed` until it is known sent). */
export function recordAttempt(db, { accountKey, sendClass, kind, at }) {
  const result = db
    .prepare(
      "INSERT INTO mail_sends (account_key, class, kind, sent_at, outcome) VALUES (?, ?, ?, ?, 'failed')",
    )
    .run(accountKey, sendClass, kind, at.toISOString());
  return Number(result.lastInsertRowid);
}

/** Mark an attempt delivered. */
export function markAttemptSent(db, id) {
  db.prepare("UPDATE mail_sends SET outcome = 'sent' WHERE id = ?").run(id);
}

/** Forget attempts older than 48 h and consents past their expiry. */
export function sweepMailRecords(db, now) {
  const cutoff = new Date(now.getTime() - 2 * MAIL_BUDGET.windowHours * HOUR_MS).toISOString();
  db.prepare('DELETE FROM mail_sends WHERE sent_at < ?').run(cutoff);
  db.prepare('DELETE FROM mail_oauth_pending WHERE expires_at < ?').run(now.toISOString());
}

/**
 * The budget of the sending account a row sends through, as the API shows
 * it (core `MailBudgetView`); null for a row without a transport.
 */
export function budgetView(db, row, now) {
  if (row.kind === null) return null;
  const usage = accountUsage(db, row.account_key, now);
  const state = accountState(db, row.account_key);
  const { ceiling, publicCap } = mailBudgetThresholds(row.daily_limit);
  const limitedUntil =
    state.limited_until !== null && Date.parse(state.limited_until) > now.getTime()
      ? state.limited_until
      : null;
  let resumesAt = limitedUntil;
  if (resumesAt === null && usage.sent24h >= publicCap && usage.oldestAt !== null) {
    resumesAt = new Date(
      Date.parse(usage.oldestAt) + MAIL_BUDGET.windowHours * HOUR_MS,
    ).toISOString();
  }
  return {
    dailyLimit: row.daily_limit,
    ceiling,
    publicCap,
    sent24h: usage.sent24h,
    byClass: usage.byClass,
    resetsLastHour: usage.resetsLastHour,
    limitedUntil,
    resumesAt,
  };
}

/** A row as the API shows it (core `MailTransportView`) — never its secret. */
export function transportView(db, row, now = new Date()) {
  const settings = row.kind === null ? null : JSON.parse(row.settings);
  let view = null;
  if (row.kind === 'smtp') {
    view = {
      host: settings.host,
      port: settings.port,
      security: settings.security,
      username: settings.username ?? null,
      hasCaPem: typeof settings.caPem === 'string',
    };
  } else if (row.kind === 'gmail-api') {
    view = { clientId: settings.clientId, account: settings.account };
  }
  return {
    scope: row.domain === null ? 'relay' : 'domain',
    domain: row.domain,
    kind: row.kind,
    settings: view,
    sender: { address: row.sender_address, name: row.sender_name },
    hasSecret: row.secret !== null,
    verifiedAt: row.verified_at,
    updatedAt: row.updated_at,
    health:
      row.kind === null
        ? null
        : {
            status: row.health_status,
            checkedAt: row.health_checked_at,
            reason: row.health_reason,
          },
    budget: budgetView(db, row, now),
  };
}

/**
 * Store a row for `domain` (null: the relay's) — a whole transport, or a
 * sender only — keeping its health when the credential is the same one.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ domain: string | null, kind: string | null, settings: object | null, secret: string | null,
 *   senderAddress: string, senderName: string | null, dailyLimit: number | null, now: Date,
 *   health?: { status: string, reason: string | null } }} row
 */
export function writeTransportRow(db, row) {
  const at = row.now.toISOString();
  const accountKey = row.kind === null ? null : accountKeyOf(row.kind, row.settings);
  const health = row.health ?? { status: row.kind === null ? 'unknown' : 'up', reason: null };
  const values = [
    row.kind,
    row.kind === null ? null : JSON.stringify(row.settings),
    row.secret,
    accountKey,
    row.senderAddress,
    row.senderName,
    row.dailyLimit,
    health.status,
    row.kind === null ? null : at,
    health.reason,
    at,
    at,
  ];
  const existing = transportRow(db, row.domain);
  if (existing) {
    db.prepare(
      `UPDATE mail_transports SET kind = ?, settings = ?, secret = ?, account_key = ?,
         sender_address = ?, sender_name = ?, daily_limit = ?, health_status = ?,
         health_checked_at = ?, health_reason = ?, verified_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(...values, existing.id);
  } else {
    db.prepare(
      `INSERT INTO mail_transports (kind, settings, secret, account_key, sender_address, sender_name,
         daily_limit, health_status, health_checked_at, health_reason, verified_at, updated_at, domain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values, row.domain);
  }
  return transportRow(db, row.domain);
}

/** Change a row's sender, name or daily limit — nothing else. */
export function patchTransportRow(db, id, { senderAddress, senderName, dailyLimit, now }) {
  const fields = [
    ['sender_address', senderAddress],
    ['sender_name', senderName],
    ['daily_limit', dailyLimit],
  ].filter(([, value]) => value !== undefined);
  const sets = ['updated_at = ?', ...fields.map(([column]) => `${column} = ?`)];
  db.prepare(`UPDATE mail_transports SET ${sets.join(', ')} WHERE id = ?`).run(
    now.toISOString(),
    ...fields.map(([, value]) => value),
    id,
  );
}

/** Record a row's last check. */
export function setTransportHealth(db, id, { status, reason, at }) {
  db.prepare(
    'UPDATE mail_transports SET health_status = ?, health_reason = ?, health_checked_at = ? WHERE id = ?',
  ).run(status, reason, at.toISOString(), id);
}

/** Remove the row of `domain` (null: the relay's); the removed row, or null. */
export function deleteTransportRow(db, domain) {
  const row = transportRow(db, domain);
  if (row) db.prepare('DELETE FROM mail_transports WHERE id = ?').run(row.id);
  return row;
}

/** Record a consent under way. */
export function insertPendingConsent(db, { stateSha256, domain, verifier, draft, now, expiresAt }) {
  db.prepare(
    `INSERT INTO mail_oauth_pending (state_sha256, domain, code_verifier, draft, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(stateSha256, domain, verifier, JSON.stringify(draft), now.toISOString(), expiresAt);
}

/** Take (and so end) the consent of a state's hash: the row, or null. */
export function takePendingConsent(db, stateSha256) {
  const row = db
    .prepare('SELECT * FROM mail_oauth_pending WHERE state_sha256 = ?')
    .get(stateSha256);
  if (!row) return null;
  db.prepare('DELETE FROM mail_oauth_pending WHERE state_sha256 = ?').run(stateSha256);
  return { ...row, draft: JSON.parse(row.draft) };
}
