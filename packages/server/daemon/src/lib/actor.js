/**
 * Derive a stable audit identifier for the calling principal.
 *
 * Returns the certificate CN form (`admin`, `agent:<label>`, `plugin-agent:...`)
 * so a reader of the journal or the audit log can correlate events with the
 * principal that initiated them. Returns `'unknown'` when middleware did not
 * populate cert metadata (e.g. dev mode shortcut on /api/health).
 */
export function actorFromRequest(request) {
  if (request.certRole === 'admin') return 'admin';
  if (request.certRole === 'agent' && request.certLabel) return `agent:${request.certLabel}`;
  if (request.certRole === 'plugin-agent' && request.certLabel) return request.certLabel;
  return 'unknown';
}

/**
 * The client certificate serial nginx reported, for audit entries: every
 * administrator shares the `admin` identity, so the serial is what tells two
 * admin certificates apart. Not secret. Null when absent (development mode).
 */
export function certSerialFromRequest(request) {
  const serial = request.headers?.['x-ssl-client-serial'];
  return typeof serial === 'string' && /^[0-9A-Fa-f]{1,64}$/.test(serial) ? serial : null;
}
