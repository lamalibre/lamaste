/**
 * Why a mail could not be delivered, as the relay acts on it
 * (packages/core/docs/mail-design.md §3.6, §3.7, §5.1):
 *
 *   transient  try once more (a 5xx from Google, a dropped or slow
 *              connection, an SMTP 4xx); `rate_limited` — a per-second or
 *              per-minute rate limit, Google's `userRateLimitExceeded` or
 *              `rateLimitExceeded` — is tried again with backoff within the
 *              send's 30 s (`retryAfterMs` when the provider said when)
 *   limited    the provider refused for sending too much in a day (Google's
 *              `dailyLimitExceeded`, "sending limit exceeded"; an SMTP
 *              quota reply to the session, `MAIL FROM` or `DATA`): the
 *              sending account stops until `until` (at most 24 hours), no
 *              retry
 *   down       the transport cannot send until an administrator acts (the
 *              grant revoked, the password wrong, the certificate refused)
 *   refused    this message was refused (a recipient the provider rejects)
 *
 * `reason` is a short class (`invalid_grant`, `timeout`, `http_503`, …) —
 * what audits, logs and answers carry. A provider's own message never
 * leaves this module: it may quote an address or the message.
 */
export class MailDeliveryError extends Error {
  /**
   * @param {'transient' | 'limited' | 'down' | 'refused'} failure
   * @param {string} reason
   * @param {{ cause?: unknown, retryAfterMs?: number | null, until?: string | null }} [options]
   */
  constructor(failure, reason, options = {}) {
    const { retryAfterMs = null, until = null, ...rest } = options;
    super(`Mail delivery failed (${failure}: ${reason})`, rest);
    this.name = 'MailDeliveryError';
    this.failure = failure;
    this.reason = reason;
    /** When the provider said a rate-limited send may be tried again (ms from now), or null. */
    this.retryAfterMs = retryAfterMs;
    /** When the provider said a limited account sends again (ISO), or null. */
    this.until = until;
  }
}

/** Whether `err` is a {@link MailDeliveryError}. */
export function isMailDeliveryError(err) {
  return err instanceof MailDeliveryError;
}
