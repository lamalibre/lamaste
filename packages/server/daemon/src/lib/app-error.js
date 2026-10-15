export class AppError extends Error {
  /**
   * @param {string} message — human-readable error message
   * @param {number} statusCode — HTTP status code (e.g. 400, 404, 409, 422)
   * @param {object|null} details — optional object with additional error context
   */
  constructor(message, statusCode, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

/**
 * A plain Error carrying the HTTP `statusCode` a route answers with, and
 * whatever `extra` names beyond the message (a refusal's `code`,
 * `reasons`, …). Not an {@link AppError}: the error middleware treats those
 * as operational.
 */
export function httpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}
