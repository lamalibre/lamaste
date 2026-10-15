/**
 * Uninstalling an agent while the app host helper still runs agent halves
 * for it would leave those services running with no tunnel to the relay
 * and nobody to remove them. `lamaste-agent uninstall` therefore refuses
 * until they are gone — unhosted from the panel (which removes them through
 * the agent's sync) or removed here with
 * `sudo lamaste-agent apphost disable --force` (their data is kept).
 */

import { appHostStatus, isAppHostEnabled, readAppHostState } from '@lamalibre/lamaste/agent';

/**
 * The agent halves still installed for the agents `labels`. Without the
 * helper there are none (`apphost disable` removes every one first). With
 * it, the helper's owner records decide: the agent halves owned by one of
 * `labels` — or every one when the agents being removed are all there are
 * (`everyAgent`). One without an owner record counts when the agents'
 * apphost-state.json lists it or cannot be read. When the helper does not
 * answer, the record alone decides.
 *
 * @param {string[]} labels
 * @param {{ everyAgent: boolean }} scope
 * @param {object} [overrides] - replaces the helper and the record (tests)
 * @returns {Promise<string[]>} routes, sorted
 */
export async function installedAgentHalves(labels, { everyAgent }, overrides = {}) {
  const deps = { isAppHostEnabled, appHostStatus, readAppHostState, ...overrides };
  if (!(await deps.isAppHostEnabled())) return [];

  const recorded = new Set();
  let recordReadable = true;
  for (const label of labels) {
    try {
      for (const route of Object.keys((await deps.readAppHostState(label)).apps)) {
        recorded.add(route);
      }
    } catch {
      recordReadable = false;
    }
  }

  const availability = await deps.appHostStatus();
  if (availability.state === 'ready') {
    return Object.entries(availability.status.apps)
      .filter(
        ([route, app]) =>
          everyAgent ||
          (app.owner ? labels.includes(app.owner.label) : !recordReadable || recorded.has(route)),
      )
      .map(([route]) => route)
      .sort();
  }
  if (!recordReadable) {
    throw new Error(
      'Cannot tell whether agent halves are installed for this agent: its apphost-state.json ' +
        `is unreadable and the app host helper does not answer (${
          availability.state === 'unusable' ? availability.reason : 'it is missing'
        }).`,
    );
  }
  return [...recorded].sort();
}

/**
 * Refuse to uninstall while agent halves are installed for `labels`, naming
 * them and the two ways out.
 *
 * @param {string[]} labels
 * @param {{ everyAgent: boolean }} scope
 * @param {object} [overrides] - replaces the helper and the record (tests)
 */
export async function assertNoAgentHalves(labels, scope, overrides = {}) {
  const routes = await installedAgentHalves(labels, scope, overrides);
  if (routes.length === 0) return;
  throw new Error(
    `The agent halves of ${routes.join(', ')} are installed on this machine; uninstalling the ` +
      'agent would leave them running without a tunnel. Unhost or uninstall those plugins on ' +
      'the panel (the agent removes their agent halves on its next sync), or remove them here ' +
      'with `sudo lamaste-agent apphost disable --force` (their data is kept) — then uninstall ' +
      'the agent.',
  );
}
