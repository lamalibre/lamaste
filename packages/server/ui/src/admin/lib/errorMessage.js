/**
 * Extract an error message from any thrown value.
 * Tauri `invoke()` rejects with a plain string, while `fetch`-based clients
 * reject with an Error object.  This normalises both.
 */
export function errorMessage(err) {
  if (typeof err === 'string') return err || 'An unknown error occurred';
  if (err instanceof Error) return err.message || 'An unknown error occurred';
  return String(err ?? 'An unknown error occurred') || 'An unknown error occurred';
}

/**
 * Why the panel refused a request, beyond its message: `code` (for plugin
 * operations `agent_not_eligible`, `push_install_refused`,
 * `hooks_not_approved`) and, for an agent that cannot host a plugin,
 * `reasons`. Both admin clients reject with an Error carrying them when the
 * panel sent them; anything else has neither.
 *
 * @param {unknown} err
 * @returns {{ code: string | null, reasons: string[] }}
 */
export function refusalOf(err) {
  if (err === null || typeof err !== 'object') return { code: null, reasons: [] };
  return {
    code: typeof err.code === 'string' ? err.code : null,
    reasons: Array.isArray(err.reasons) ? err.reasons.filter((r) => typeof r === 'string') : [],
  };
}
