/**
 * Shared API fetch wrapper with 2FA detection.
 *
 * Dispatches a custom event when the server returns { error: '2fa_required' },
 * which the TwoFaProvider listens for to show the verification modal.
 */

import { settingsErrorsOf } from '../admin/lib/pluginSettings.js';
import { fieldErrorsIn } from '../admin/lib/errorMessage.js';

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
 * a running operation's `operationId`, a refused settings update's
 * per-field `errors` (a map) or a refused brand's (a list of `{ field,
 * message }`), a refused image's `reason`, and the current `revision` of
 * a `revision_mismatch`.
 *
 * @param {string} url - The API URL (e.g., '/api/settings/2fa')
 * @param {RequestInit} [opts] - Fetch options
 * @returns {Promise<any>} Parsed JSON response
 */
/**
 * Refuse a request path with a `.` or `..` segment: curl and `fetch`
 * resolve them (`/api/domains/../activate` → `/api/activate`), so a value
 * put into a path — a domain, a user, a plugin — could name another route.
 * Every path the client sends passes here; values are percent-encoded as
 * usual where the path is built.
 */
export function assertApiPath(url) {
  const route = String(url).split(/[?#]/, 1)[0];
  if (route.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('A panel request path may not have a "." or ".." segment');
  }
}

export async function apiFetch(url, opts) {
  assertApiPath(url);
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
    // Per-field messages of a refused settings update (a map) or brand
    // change (a list) — they never contain a value.
    const errors = settingsErrorsOf(data) ?? fieldErrorsIn(data.errors);
    throw Object.assign(new Error(errorText(data, res.status)), {
      status: res.status,
      ...(typeof data.code === 'string' ? { code: data.code } : {}),
      ...(Array.isArray(data.reasons) ? { reasons: data.reasons } : {}),
      ...(data.usedBy && typeof data.usedBy === 'object' ? { usedBy: data.usedBy } : {}),
      ...(typeof data.operationId === 'string' ? { operationId: data.operationId } : {}),
      ...(errors ? { errors } : {}),
      ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
      ...(Number.isSafeInteger(data.revision) && data.revision >= 0
        ? { revision: data.revision }
        : {}),
    });
  }

  return res.json();
}
