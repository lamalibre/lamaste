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
