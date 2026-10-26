/**
 * The users lock — the one lock around every read-modify-write of users.yml
 * and every change of the user directory in this process (core's users
 * functions take none), and around the changes that must agree with
 * users.yml's groups: a membership's kind (an external member holds no
 * Authelia group — lib/domains.js). Taken before the domains lock, never
 * after it.
 */

import { PromiseChainMutex } from '@lamalibre/lamaste';

const usersMutex = new PromiseChainMutex();

/**
 * Run `fn` holding the users lock.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withUsersLock(fn) {
  return usersMutex.run(fn);
}
