/**
 * Shared API fetch wrapper with 2FA detection.
 *
 * Dispatches a custom event when the server returns { error: '2fa_required' },
 * which the TwoFaProvider listens for to show the verification modal.
 */

export const TWO_FA_REQUIRED_EVENT = 'lamaste:2fa-required';

/**
 * Fetch a JSON API endpoint. Throws on non-OK responses (after 2FA detection).
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
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}
