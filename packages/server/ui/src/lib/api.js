/**
 * Shared API fetch wrapper with 2FA detection.
 *
 * Dispatches a custom event when the server returns { error: '2fa_required' },
 * which the TwoFaProvider listens for to show the verification modal.
 */

import { settingsErrorsOf } from '../admin/lib/pluginSettings.js';

export const TWO_FA_REQUIRED_EVENT = 'lamaste:2fa-required';

/**
 * The panel's error message, followed by what a failed validation found
 * (`details.issues`: `field: message`) — "Validation failed" alone tells an
 * administrator nothing about what to correct.
 */
function errorText(data, status) {
  const message = data.error || `Request failed with status ${status}`;
  const issues = Array.isArray(data.details?.issues) ? data.details.issues : [];
  const found = issues
    .filter((issue) => typeof issue?.message === 'string')
    .map((issue) =>
      Array.isArray(issue.path) && issue.path.length > 0
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    );
  return found.length > 0 ? `${message}: ${[...new Set(found)].join('; ')}` : message;
}

/**
 * Fetch a JSON API endpoint. Throws on non-OK responses (after 2FA detection).
 *
 * The Error thrown for a refused request carries the panel's `error` (and
 * what a failed validation found) as its message, the HTTP `status`, and
 * what a client acts on beyond the message
 * when the panel sent it: `code` (e.g. `agent_not_eligible`), `reasons`,
 * a running operation's `operationId` and a refused settings update's
 * per-field `errors`.
 *
 * @param {string} url - The API URL (e.g., '/api/settings/2fa')
 * @param {RequestInit} [opts] - Fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
export async function apiFetch(url, opts) {
  const res = await fetch(url, opts);

  if (res.status === 401) {
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      if (body.error === '2fa_required') {
        window.dispatchEvent(new CustomEvent(TWO_FA_REQUIRED_EVENT));
        throw new Error('2fa_required');
      }
    } catch (err) {
      if (err.message === '2fa_required') throw err;
      // Not JSON — fall through to normal error handling
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const data = body !== null && typeof body === 'object' ? body : {};
    // A refused settings update's per-field messages (they never contain a value).
    const errors = settingsErrorsOf(data);
    throw Object.assign(new Error(errorText(data, res.status)), {
      status: res.status,
      ...(typeof data.code === 'string' ? { code: data.code } : {}),
      ...(Array.isArray(data.reasons) ? { reasons: data.reasons } : {}),
      ...(data.usedBy && typeof data.usedBy === 'object' ? { usedBy: data.usedBy } : {}),
      ...(typeof data.operationId === 'string' ? { operationId: data.operationId } : {}),
      ...(errors ? { errors } : {}),
    });
  }

  return res.json();
}
