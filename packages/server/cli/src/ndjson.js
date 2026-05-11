/**
 * NDJSON output helper for --json mode.
 *
 * When --json is enabled, all output goes through this module as
 * newline-delimited JSON on stdout. This is consumed by the desktop
 * app (Tauri) and automation scripts.
 */

/**
 * Write a single NDJSON event line to stdout.
 * @param {Record<string, unknown>} event
 */
export function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

/**
 * Emit a step progress event.
 * @param {string} step
 * @param {'running' | 'complete' | 'skipped' | 'failed'} status
 * @param {string} [detail]
 */
export function emitStep(step, status, detail) {
  /** @type {Record<string, unknown>} */
  const event = { event: 'step', step, status };
  if (detail) event.detail = detail;
  emit(event);
}

/**
 * Emit an error event.
 * @param {string} message
 * @param {boolean} [recoverable]
 */
export function emitError(message, recoverable = false) {
  emit({ event: 'error', message, recoverable });
}

/**
 * Emit a completion event with result data.
 * @param {Record<string, unknown>} data
 */
export function emitComplete(data) {
  emit({ event: 'complete', ...data });
}

/**
 * Emit a log event — non-step progress messages that consumers (desktop app,
 * automation) can surface alongside step progress.
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export function emitLog(level, message, data) {
  emit({ event: 'log', level, message, ...(data ? { data } : {}) });
}
