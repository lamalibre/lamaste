/**
 * What the Dashboard says about the relay's port-443 catch-all
 * (`GET /api/system/stats` → `httpsCatchAll.status`, serverd
 * `lib/https-catch-all.js`): null when it is in place or not checked yet,
 * otherwise what is wrong with it.
 *
 * @param {string | null | undefined} status
 * @returns {string | null}
 */
export function httpsCatchAllProblem(status) {
  switch (status) {
    case 'missing':
      return 'is not enabled';
    case 'changed':
      return 'is enabled with other content than this release writes';
    case 'unreadable':
      return 'could not be read';
    default:
      return null;
  }
}
