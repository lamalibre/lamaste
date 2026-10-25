/**
 * The relay's domains as `lamaste-server domains` prints them — pure
 * helpers, exported for tests (the command is src/commands/domains.js).
 */

import { terminalText } from './plugin-settings.js';

/**
 * One row per domain: name, state, members, what uses it — as terminal text.
 *
 * @param {Array<Record<string, any>>} domains  as `GET /api/domains` lists them
 */
export function domainRows(domains) {
  return domains.map((d) => ({
    name: terminalText(d.name),
    state: d.status === 'active' ? (d.primary ? 'primary' : 'active') : 'pending',
    members: Number.isInteger(d.members) ? d.members : 0,
    usedBy: usageText(d.usedBy),
  }));
}

/** What uses a domain, in one line (empty when nothing does). */
export function usageText(usedBy) {
  if (!usedBy) return '';
  const parts = [];
  const count = (label, items) => {
    if (Array.isArray(items) && items.length > 0) parts.push(`${items.length} ${label}`);
  };
  count('tunnel(s)', usedBy.tunnels);
  count('site(s)', usedBy.sites);
  count('plugin(s)', usedBy.plugins);
  if (usedBy.registry) parts.push('the registry credential');
  return parts.join(', ');
}
