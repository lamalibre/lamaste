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

/**
 * Answer a refusal a route's work threw — an error with `statusCode`: its
 * message, `code` and `usedBy` when it carries them — or a 500 with
 * `fallback` for anything else. A 5xx and any other error are logged; a
 * plain error never reaches the client with its message.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {Error & { statusCode?: number, code?: string, usedBy?: object, cause?: unknown }} err
 * @param {string} fallback
 */
export function sendFailure(request, reply, err, fallback) {
  if (Number.isInteger(err.statusCode)) {
    if (err.statusCode >= 500) request.log.error(err.cause ?? err, err.message);
    return reply.code(err.statusCode).send({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.usedBy ? { usedBy: err.usedBy } : {}),
    });
  }
  request.log.error(err, fallback);
  return reply.code(500).send({ error: fallback });
}
