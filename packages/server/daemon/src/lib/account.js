/**
 * A person's own account on a domain's sign-in host
 * (packages/core/docs/mail-design.md §6.2, §6.3): forgetting a password —
 * a link by mail, then a new password with a current authenticator code —
 * and changing it while signed in. Lamaste's, never Authelia's: every
 * password is written through `changeUsers` (the users lock; the panel is
 * the only writer of users.yml — decision D4, external-members S2).
 *
 * The domain is the sign-in host's, read from the raw `Host` the auth vhost
 * writes as a literal (`request.host` would follow a client's
 * `X-Forwarded-Host` behind the trusted loopback hop); a request on any
 * other host is a 404.
 *
 * Forgot password never tells anyone whether an account exists: `start`
 * answers alike after the same delay whatever it found, did or refused —
 * the work runs after the answer. A link names one user on one domain; its
 * holder learns that user's username (the page shows whose password they
 * set) and, with a code from that user's authenticator, sets the password.
 * Five failures void a link; a code is good once. What a start may mail
 * is bounded several ways, all answered alike: 5 starts in 15 minutes per
 * client (an IPv6 client by its /64), no new link while the user's last
 * one is live and under 10 minutes old, 3 links an hour and 5 a day per
 * user, 20 accounts per start — and, in the sending budget, 20 reset mails
 * an hour per domain and the `public` share (mail-design.md §3.7).
 * Members of `admins` never reset by mail (decision D-D): another
 * administrator, or `lamaste-server` on the relay, sets their password.
 *
 * Change password takes the user from Gatekeeper's relay assertion — the
 * session Authelia vouched for, two factors, for that very request
 * (`verifyAccountRelay`) — never from a header any local process could
 * send to the panel's loopback port. The current password is still
 * checked.
 *
 * After a password is set (reset or change), the sessions the relay holds
 * for the user end — desktop sessions, registry tokens, Gatekeeper's
 * cached verdicts (`endUserSessions`). Authelia's own sessions and the
 * OpenID Connect tokens it issued do not: Authelia cannot be asked to end
 * them (an administrator's disable and enable does).
 *
 * Logs and audits carry user ids and the domain — never an identifier as
 * typed, an address, a token or a password.
 */

import net from 'node:net';

import {
  KeyedPromiseChainMutex,
  PASSWORD_RESET_MAX_FAILURES,
  USERNAME_REGEX,
  authResetUrl,
  isDeliverableAddress,
} from '@lamalibre/lamaste';
import { renderPasswordChangedMail, renderPasswordResetMail } from '@lamalibre/lamaste/server';

import {
  acceptTotpStep,
  finishReset,
  hashResetToken,
  hasRecentLiveReset,
  issueReset,
  liveReset,
  passwordFailuresSince,
  recordPasswordFailure,
  recordResetFailure,
  resetsSince,
  sweepAccountRecords,
} from './account-store.js';
import { httpError } from './app-error.js';
import { recordAuditBestEffort } from './audit.js';
import {
  hashPassword,
  passwordMatches,
  readUsersRaw,
  verifyAutheliaUserTotp,
  writeUsers,
} from './authelia.js';
import {
  ADMIN_GROUP,
  changeUsers,
  directoryUsersByUsername,
  endUserSessions,
  getDirectoryUser,
} from './directory.js';
import { activeDomainNames, domainsOfUser } from './domains.js';
import { canSendMailFor, sendMail } from './mail.js';
import { getStateDb } from './state-db.js';

const MINUTE_MS = 60_000;

/**
 * Reset starts one client may make in {@link START_WINDOW_MS} — an IPv4
 * address, or an IPv6 /64 ({@link resetClientKey}); past it, the same
 * answer and nothing done.
 */
const STARTS_PER_ADDRESS = 5;
const START_WINDOW_MS = 15 * MINUTE_MS;
/** At most this many clients are remembered for that count (the oldest go first). */
const START_ADDRESSES_MAX = 10_000;
/** Reset links one user may be mailed in an hour … */
const RESETS_PER_USER_PER_HOUR = 3;
/** … and in a day. */
const RESETS_PER_USER_PER_DAY = 5;
/** While the user's last link is live and younger than this, a start mails nothing. */
const RESET_MIN_INTERVAL_MS = 10 * MINUTE_MS;
/** One start mails at most this many accounts (an address many users share). */
const RESET_ACCOUNTS_MAX = 20;
/** Wrong current passwords per user in {@link PASSWORD_FAILURE_WINDOW_MS} before a 429. */
const PASSWORD_FAILURES_MAX = 5;
const PASSWORD_FAILURE_WINDOW_MS = 15 * MINUTE_MS;

/** How long after it arrived every reset start is answered (its work runs after). */
let startAnswerDelayMs = 1_000;

/** One change of a user's password at a time (by user id). */
const userLocks = new KeyedPromiseChainMutex();

/** Reset starts by client address: the times of the last few. */
const startsByAddress = new Map();

/** Work after an answer (a start's lookups and mails, notices) — awaited by tests. */
const pending = new Set();

/** Run `work` after the answer; its failure goes to the log. */
function afterAnswer(work, logger) {
  const run = Promise.resolve()
    .then(work)
    .catch((err) => logger?.error({ err: err?.message }, 'Account work after the answer failed'))
    .finally(() => pending.delete(run));
  pending.add(run);
}

/** Resolves once the work after earlier answers is done (tests). */
export async function accountWorkIdle() {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

/** Tests: how long a reset start's answer waits; forget the per-address counts. */
export function setAccountTimingForTests({ startAnswerDelayMs: delay } = {}) {
  startAnswerDelayMs = delay ?? 1_000;
  startsByAddress.clear();
}

// ---------------------------------------------------------------------------
// The sign-in host and the user
// ---------------------------------------------------------------------------

/**
 * The relay domain whose sign-in host `host` (the raw `Host` header) is —
 * `auth.<domain>` of an active domain — or null.
 *
 * @param {string | undefined} host
 */
export async function authHostDomain(host) {
  if (typeof host !== 'string') return null;
  const name = host.toLowerCase().replace(/:\d+$/, '');
  if (!name.startsWith('auth.')) return null;
  const domain = name.slice('auth.'.length);
  return (await activeDomainNames()).includes(domain) ? domain : null;
}

/** 404 `reset_unavailable`: not a sign-in host, or its domain sends no mail (§7). */
function resetUnavailable() {
  return httpError('Password reset is not available here', 404, { code: 'reset_unavailable' });
}

/** The domain a reset request is for, or 404 `reset_unavailable`. */
async function resetDomain(host) {
  const domain = await authHostDomain(host);
  if (domain === null || !(await canSendMailFor(domain))) throw resetUnavailable();
  return domain;
}

/**
 * The key a client's reset starts are counted under: an IPv4 address as
 * it is (an IPv4-mapped IPv6 one as its IPv4), an IPv6 address by its /64
 * — what one host is usually given, so a client cannot walk its own
 * prefix to start again.
 *
 * @param {string | undefined} address
 */
export function resetClientKey(address) {
  const raw = String(address ?? '').trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];
  if (net.isIPv4(raw)) return raw;
  if (!net.isIPv6(raw)) return raw;
  let text = raw.split('%')[0].toLowerCase();
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    text = `${text.slice(0, -v4[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const double = text.indexOf('::');
  const head = double === -1 ? text : text.slice(0, double);
  const tail = double === -1 ? '' : text.slice(double + 2);
  const h = head === '' ? [] : head.split(':');
  const t = tail === '' ? [] : tail.split(':');
  const groups = double === -1 ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

/**
 * A user who may manage their password on `domain`: in users.yml and not
 * disabled, active in the directory under that id, and a member or an
 * external member of the domain — and, `forReset`, not a member of
 * `admins` (an administrator's password is never reset by mail). Null
 * otherwise.
 *
 * @param {Record<string, any>} users users.yml's `users`
 * @param {{ userId: string, username: string, status: string } | null} known the directory's user
 * @param {string} domain
 * @param {{ forReset?: boolean }} [opts]
 * @returns {Promise<{ userId: string, username: string, entry: Record<string, any> } | null>}
 */
async function eligibleUser(users, known, domain, { forReset = false } = {}) {
  if (!known || known.status !== 'active') return null;
  const entry = users[known.username];
  if (!entry || entry.disabled === true) return null;
  if (forReset && Array.isArray(entry.groups) && entry.groups.includes(ADMIN_GROUP)) return null;
  const memberships = await domainsOfUser(known.userId);
  if (!memberships.some((m) => m.name === domain)) return null;
  return { userId: known.userId, username: known.username, entry };
}

/**
 * Write `passwordHash` as `username`'s password through `changeUsers`,
 * checked again under the users lock (the user may have gone or been
 * disabled since): 410 `reset_invalid` / 403 when not.
 */
async function writePassword(username, passwordHash, { actor, refusal, forReset = false, logger }) {
  const outcome = await changeUsers(
    async () => {
      const usersData = await readUsersRaw();
      const entry = usersData.users?.[username];
      if (!entry || entry.disabled === true) throw refusal();
      // An administrator by now (made one since the link was issued): no reset by mail.
      if (forReset && Array.isArray(entry.groups) && entry.groups.includes(ADMIN_GROUP)) {
        throw refusal();
      }
      entry.password = passwordHash;
      await writeUsers(usersData);
    },
    {
      actor,
      logger,
      expect: (users) => users[username]?.password === passwordHash,
    },
  );
  for (const warning of outcome.warnings) {
    logger?.warn({ step: warning.step }, 'A password change left a warning');
  }
}

/**
 * After a password was set: the sessions the relay holds for the user end
 * (lib/directory.js `endUserSessions`) — best effort, logged.
 */
async function endSessionsAfterPassword(userId, logger) {
  const warnings = await endUserSessions(userId, { logger });
  for (const warning of warnings) {
    logger?.warn(
      { userId, step: warning.step },
      'Ending sessions after a password change left a warning',
    );
  }
}

/**
 * Tell `entry`'s address that its password changed (§6.2, §6.3), after the
 * answer: when it is deliverable and the domain sends mail.
 */
function noticeAfterAnswer(user, domain, logger) {
  const to = user.entry.email;
  if (!isDeliverableAddress(to)) return;
  const changedAt = new Date();
  afterAnswer(
    () =>
      sendMail({
        domain,
        to,
        kind: 'password-changed',
        sendClass: 'essential',
        logger,
        render: ({ language, brand }) =>
          renderPasswordChangedMail({ language, brand, username: user.username, changedAt }),
      }),
    logger,
  );
}

// ---------------------------------------------------------------------------
// Forgot password (§6.2)
// ---------------------------------------------------------------------------

/** Whether one more start from `address` is within its count — and counted. */
function countStart(address, now) {
  const since = now - START_WINDOW_MS;
  const times = (startsByAddress.get(address) ?? []).filter((t) => t > since);
  const within = times.length < STARTS_PER_ADDRESS;
  if (within) times.push(now);
  startsByAddress.delete(address);
  startsByAddress.set(address, times);
  while (startsByAddress.size > START_ADDRESSES_MAX) {
    startsByAddress.delete(startsByAddress.keys().next().value);
  }
  return within;
}

/**
 * `POST /api/account/reset/start { identifier }`. 404 `reset_unavailable`
 * when this host cannot reset (no mail for its domain); otherwise the caller
 * answers `202 { sent: true }` once {@link resetStartAnswerAt} has passed,
 * whatever happens: the lookups and the mails run after the answer.
 *
 * @param {{ identifier: string }} body parsed `PasswordResetStartSchema`
 * @param {{ host?: string, address: string, logger?: import('pino').Logger }} opts
 */
export async function startPasswordReset(body, { host, address, logger }) {
  const domain = await resetDomain(host);
  if (!countStart(resetClientKey(address), Date.now())) {
    logger?.info({ domain }, 'Password reset start over its address count — answered alike');
    return;
  }
  afterAnswer(() => mailResetLinks(body.identifier, domain, logger), logger);
}

/** When a reset start that arrived at `arrivedAt` is answered. */
export function resetStartAnswerAt(arrivedAt) {
  return arrivedAt + startAnswerDelayMs;
}

/**
 * The work of a start: the users `identifier` names on `domain` (by
 * username or address, case-insensitive; enabled, active, members or
 * external members, a deliverable address, under the hourly count), a link
 * each, one mail per address listing every one of its accounts.
 */
async function mailResetLinks(identifier, domain, logger) {
  const db = await getStateDb();
  const now = new Date();
  sweepAccountRecords(db, now);
  const wanted = identifier.trim().toLowerCase();
  const usersData = await readUsersRaw();
  const users = usersData.users ?? {};
  const directory = await directoryUsersByUsername();

  /** @type {Map<string, { to: string, accounts: Array<{ userId: string, username: string }> }>} */
  const byAddress = new Map();
  let matched = 0;
  for (const [username, entry] of Object.entries(users)) {
    const email = typeof entry?.email === 'string' ? entry.email : '';
    if (username.toLowerCase() !== wanted && email.toLowerCase() !== wanted) continue;
    if (!isDeliverableAddress(email)) continue;
    const user = await eligibleUser(users, directory.get(username) ?? null, domain, {
      forReset: true,
    });
    if (!user) continue;
    if (++matched > RESET_ACCOUNTS_MAX) break;
    const key = email.toLowerCase();
    const group = byAddress.get(key) ?? { to: email, accounts: [] };
    group.accounts.push({ userId: user.userId, username });
    byAddress.set(key, group);
  }

  for (const group of byAddress.values()) {
    const links = [];
    for (const account of group.accounts) {
      const before = (ms) => new Date(now.getTime() - ms);
      if (hasRecentLiveReset(db, account.userId, before(RESET_MIN_INTERVAL_MS), now)) {
        logger?.info({ userId: account.userId, domain }, 'Password reset: a recent link is live');
        continue;
      }
      if (resetsSince(db, account.userId, before(60 * MINUTE_MS)) >= RESETS_PER_USER_PER_HOUR) {
        logger?.info({ userId: account.userId, domain }, 'Password reset over its hourly count');
        continue;
      }
      if (resetsSince(db, account.userId, before(24 * 60 * MINUTE_MS)) >= RESETS_PER_USER_PER_DAY) {
        logger?.info({ userId: account.userId, domain }, 'Password reset over its daily count');
        continue;
      }
      const token = issueReset(db, { ...account, domain, now });
      links.push({ ...account, link: `${authResetUrl(domain)}#${token}` });
    }
    if (links.length === 0) continue;
    const result = await sendMail({
      domain,
      to: group.to,
      kind: 'reset',
      sendClass: 'public',
      logger,
      render: ({ language, brand }) =>
        renderPasswordResetMail({
          language,
          brand,
          accounts: links.map(({ username, link }) => ({ username, link })),
        }),
    });
    for (const { userId } of links) {
      await recordAuditBestEffort(
        {
          actor: 'lamaste',
          action: 'account.password.reset-requested',
          details: { userId, domain, mail: result.status },
        },
        logger,
      );
    }
  }
}

/** 410 `reset_invalid` — one answer for every link that does not open (§6.2). */
function resetInvalid() {
  return httpError('This link is not valid or has expired', 410, { code: 'reset_invalid' });
}

/**
 * The live reset a token opens on this host's domain and its user, still
 * eligible — or 410 `reset_invalid`.
 */
async function openReset(token, domain) {
  const sha = hashResetToken(token);
  if (!sha) throw resetInvalid();
  const db = await getStateDb();
  const row = liveReset(db, sha, domain, PASSWORD_RESET_MAX_FAILURES, new Date());
  if (!row) throw resetInvalid();
  const known = await getDirectoryUser(row.user_id);
  const usersData = await readUsersRaw();
  const user =
    known && known.username === row.username
      ? await eligibleUser(usersData.users ?? {}, known, domain, { forReset: true })
      : null;
  if (!user) throw resetInvalid();
  return { db, row, user };
}

/**
 * `POST /api/account/reset/lookup { token }` → `{ username, displayName }`,
 * or 410 `reset_invalid` alike for every link that does not open.
 *
 * @param {{ token: string }} body parsed `PasswordResetLookupSchema`
 * @param {{ host?: string }} opts
 */
export async function lookupPasswordReset(body, { host }) {
  const domain = await resetDomain(host);
  const { user } = await openReset(body.token, domain);
  return {
    username: user.username,
    displayName:
      typeof user.entry.displayname === 'string' ? user.entry.displayname : user.username,
  };
}

/**
 * `POST /api/account/reset/finish { token, password, totp }`: the code must
 * be a current one of the user's authenticator, not used before — a wrong
 * one counts toward the link's five (400 `totp_invalid`; 410 once void); a
 * user with none cannot finish (409 `no_totp`: an administrator sets the
 * password). Then the password is written, the link and the user's others
 * voided, and the user told by mail.
 *
 * @param {{ token: string, password: string, totp: string }} body parsed `PasswordResetFinishSchema`
 * @param {{ host?: string, logger?: import('pino').Logger }} opts
 */
export async function finishPasswordReset(body, { host, logger }) {
  const domain = await resetDomain(host);
  const first = await openReset(body.token, domain);
  return userLocks.run(first.user.userId, async () => {
    // Again under the user's lock: another request may have used it since.
    const { db, row, user } = await openReset(body.token, domain);
    const failed = () => {
      const failures = recordResetFailure(db, row.id);
      return failures >= PASSWORD_RESET_MAX_FAILURES
        ? resetInvalid()
        : httpError('The code is not correct', 400, { code: 'totp_invalid' });
    };

    let verdict;
    try {
      verdict = await verifyAutheliaUserTotp(user.username, body.totp);
    } catch (err) {
      // Never the error's message: the helper's argv names the user.
      logger?.error(
        { userId: user.userId, exitCode: Number.isInteger(err?.exitCode) ? err.exitCode : null },
        'The TOTP check failed',
      );
      throw httpError('The service is not answering — try again shortly', 503, {
        code: 'authelia_storage_unavailable',
      });
    }
    if (!verdict.ok && verdict.reason === 'none') {
      throw httpError('This account has no authenticator set up', 409, { code: 'no_totp' });
    }
    if (!verdict.ok || !acceptTotpStep(db, user.userId, verdict.step, new Date())) throw failed();

    const passwordHash = await hashPassword(body.password);
    await writePassword(user.username, passwordHash, {
      actor: `user:${user.userId}`,
      refusal: resetInvalid,
      forReset: true,
      logger,
    });
    finishReset(db, row.id, user.userId, new Date());
    await endSessionsAfterPassword(user.userId, logger);
    await recordAuditBestEffort(
      {
        actor: `user:${user.userId}`,
        action: 'account.password.reset',
        details: { userId: user.userId, domain },
      },
      logger,
    );
    noticeAfterAnswer(user, domain, logger);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Change password (§6.3)
// ---------------------------------------------------------------------------

/**
 * `POST /api/account/password { currentPassword, newPassword }` from
 * `caller` — the user Gatekeeper's relay assertion vouched for, on the
 * sign-in host of the assertion's domain (lib/user-surface.js
 * `verifyAccountRelay`): 404 when this is no sign-in host; 401 without a
 * caller, or one vouched for on another domain; 403 when the user may not
 * manage their password here (disabled, not a member); 429 after five
 * wrong current passwords in 15 minutes; 400 `current_password_invalid` /
 * `password_unchanged`. The relay's sessions of the user end; the notice
 * is mailed when the domain sends mail.
 *
 * @param {{ currentPassword: string, newPassword: string }} body parsed `PasswordChangeSchema`
 * @param {{ host?: string, caller: { username: string, domain: string } | null,
 *   logger?: import('pino').Logger }} opts
 */
export async function changeOwnPassword(body, { host, caller, logger }) {
  const domain = await authHostDomain(host);
  if (domain === null) throw httpError('Not found', 404, { code: 'not_found' });
  if (
    caller === null ||
    typeof caller?.username !== 'string' ||
    !USERNAME_REGEX.test(caller.username) ||
    caller.domain !== domain
  ) {
    throw httpError('unauthenticated', 401);
  }
  const forbidden = () => httpError('Not allowed', 403, { code: 'forbidden' });
  const directory = await directoryUsersByUsername();
  const known = directory.get(caller.username) ?? null;
  if (!known) throw forbidden();

  return userLocks.run(known.userId, async () => {
    const db = await getStateDb();
    const now = new Date();
    sweepAccountRecords(db, now);
    const usersData = await readUsersRaw();
    const user = await eligibleUser(usersData.users ?? {}, known, domain);
    if (!user) throw forbidden();
    const since = new Date(now.getTime() - PASSWORD_FAILURE_WINDOW_MS);
    if (passwordFailuresSince(db, user.userId, since) >= PASSWORD_FAILURES_MAX) {
      throw httpError('Too many attempts — try again later', 429, { code: 'too_many_attempts' });
    }
    if (!(await passwordMatches(user.entry.password, body.currentPassword))) {
      recordPasswordFailure(db, user.userId, now);
      throw httpError('The current password is not correct', 400, {
        code: 'current_password_invalid',
      });
    }
    if (body.newPassword === body.currentPassword) {
      throw httpError('The new password is the same as the current one', 400, {
        code: 'password_unchanged',
      });
    }
    const passwordHash = await hashPassword(body.newPassword);
    await writePassword(user.username, passwordHash, {
      actor: `user:${user.userId}`,
      refusal: forbidden,
      logger,
    });
    await recordAuditBestEffort(
      {
        actor: `user:${user.userId}`,
        action: 'account.password.changed',
        details: { userId: user.userId, domain },
      },
      logger,
    );
    await endSessionsAfterPassword(user.userId, logger);
    // Mailed when the domain sends mail; nothing otherwise (§7).
    noticeAfterAnswer(user, domain, logger);
    return { ok: true };
  });
}
