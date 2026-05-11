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
