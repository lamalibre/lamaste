/**
 * How the panel's pages poll and what they show when a refresh fails.
 *
 * The panel limits requests per client (100 a minute by default) and the
 * pages share that budget: a query that fails with 429 is not retried at
 * once — that only spends more of it — and a refresh that fails keeps
 * showing what the panel said last, with a note, instead of replacing the
 * section with the error. Pure: nothing here calls the panel.
 */

import { errorMessage } from './errorMessage.js';

/**
 * Whether the panel refused `err`'s request for its rate limit. The web
 * client's errors carry the status; the desktop's plain rejections carry
 * the message `@fastify/rate-limit` answers with.
 *
 * @param {unknown} err
 */
export function isRateLimited(err) {
  if (err !== null && typeof err === 'object' && err.status === 429) return true;
  const message = errorMessage(err);
  return message === 'Too Many Requests' || /^Rate limit exceeded/.test(message);
}

/**
 * The queries' retry rule: once for anything that may pass on a second
 * try, never for a refusal (a 4xx — the rate limit included).
 *
 * @param {number} failureCount
 * @param {unknown} err
 */
export function retryQuery(failureCount, err) {
  if (isRateLimited(err)) return false;
  if (err !== null && typeof err === 'object' && err.status >= 400 && err.status < 500) {
    return false;
  }
  return failureCount < 1;
}

/**
 * The note shown beside data a refresh could not replace, or null when the
 * last refresh did not fail (or nothing was ever shown — then the error
 * is the section's to show).
 *
 * @param {{ isError: boolean, data: unknown, error: unknown, dataUpdatedAt: number }} query
 * @returns {string | null}
 */
export function refreshProblemText(query) {
  if (!query?.isError || query.data === undefined) return null;
  const at = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toLocaleTimeString() : null;
  const since = at ? ` — showing what it said at ${at}` : '';
  return isRateLimited(query.error)
    ? `The panel is limiting requests; this refreshes again shortly${since}`
    : `Could not refresh: ${errorMessage(query.error)}${since}`;
}

/** Whether a query failed with nothing to show: the section shows the error itself. */
export function failedWithoutData(query) {
  return Boolean(query?.isError) && query.data === undefined;
}
