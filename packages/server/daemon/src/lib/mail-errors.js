/**
 * Why a mail could not be delivered, as the relay acts on it
 * (packages/core/docs/mail-design.md §3.6, §3.7, §5.1):
 *
 *   transient  try once more (a 5xx or 429 from Google, a dropped or slow
 *              connection, an SMTP 4xx)
 *   limited    the provider refused for sending too much: the sending
 *              account stops for 24 hours, no retry
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
   * @param {{ cause?: unknown }} [options]
   */
  constructor(failure, reason, options = {}) {
    super(`Mail delivery failed (${failure}: ${reason})`, options);
    this.name = 'MailDeliveryError';
    this.failure = failure;
    this.reason = reason;
  }
}

/** Whether `err` is a {@link MailDeliveryError}. */
export function isMailDeliveryError(err) {
  return err instanceof MailDeliveryError;
}
