// The npm scope syntax of core `trusted-scopes.ts` (NPM_SCOPE_RE). The panel
// checks every scope itself; this only spares the administrator a round trip.
const NPM_SCOPE_RE = /^@[a-z0-9][a-z0-9-]{0,49}$/;

/** What the administrator typed, as a scope: trimmed, a trailing `/` dropped (never case-folded). */
export function normaliseScopeInput(text) {
  const trimmed = String(text ?? '').trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/** Why `scope` is not one the panel takes, or null. The panel decides the rest. */
export function scopeInputError(scope) {
  if (!scope) return null;
  if (!NPM_SCOPE_RE.test(scope)) {
    return 'An npm scope is @ followed by lowercase letters, digits and hyphens, e.g. @example';
  }
  if (scope === '@lamalibre') return '@lamalibre is always trusted';
  return null;
}
