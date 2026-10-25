/**
 * The panel's domains projection as Gatekeeper holds it (`domains.json`,
 * indexed), for the tests of its authorization routes: every user they sign
 * in a member of example.com unless a test names others.
 */

import { indexDomainsProjection } from '@lamalibre/lamaste';

/**
 * @param {Array<{ name: string, members: string[] }>} [domains]
 */
export function domainsIndex(
  domains = [{ name: 'example.com', members: ['alice', 'bob', 'carol'] }],
) {
  return indexDomainsProjection({ v: 1, domains });
}
