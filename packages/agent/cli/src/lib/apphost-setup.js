/**
 * What `sudo lamaste-agent apphost enable|disable` relies on before it acts
 * as root: that this lamaste-agent is a root-owned install (what root runs
 * and installs cannot have been changed by another user), and the sudoers
 * rule it writes for the agent's user.
 */

import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPHOST_PATHS } from '@lamalibre/lamaste';

/** The helper as this version of the agent CLI ships it. */
export const HELPER_SOURCE = fileURLToPath(
  new URL('../../scripts/lamaste-apphost', import.meta.url),
);

/** This CLI package's directory. */
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Environment variables Node.js acts on — options, module paths, files it
 * writes — that must never reach the root helper. sudo's env_reset drops
 * them already; the rule also takes them out of env_keep and puts them in
 * env_delete, so no other sudoers setting can let one through.
 */
export const HELPER_DENIED_ENV = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_ICU_DATA',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_REDIRECT_WARNINGS',
  'NODE_V8_COVERAGE',
  'NODE_COMPILE_CACHE',
  'NODE_PRESERVE_SYMLINKS',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
]);

/**
 * The sudoers file: the agent's user may run the helper as root — any
 * arguments, which the helper validates itself — with a reset environment.
 *
 * @param {string} user
 */
export function sudoersRule(user) {
  const helper = APPHOST_PATHS.helper;
  const denied = HELPER_DENIED_ENV.join(' ');
  return (
    '# Managed by lamaste-agent apphost: lets the agent run the app host helper as root.\n' +
    '# The helper validates every argument and derives every path itself; it runs with\n' +
    '# a reset environment and never with the Node.js variables below.\n' +
    `Defaults!${helper} env_reset\n` +
    `Defaults!${helper} !setenv\n` +
    `Defaults!${helper} env_keep -= "${denied}"\n` +
    `Defaults!${helper} env_delete += "${denied}"\n` +
    `${user} ALL=(root) NOPASSWD: ${helper}\n`
  );
}

/**
 * The files root runs or installs from this lamaste-agent: its package,
 * the helper source, and the core library it loads.
 */
export function trustedSourcePaths() {
  const paths = [PACKAGE_DIR, HELPER_SOURCE];
  if (typeof import.meta.resolve === 'function') {
    paths.push(fileURLToPath(import.meta.resolve('@lamalibre/lamaste')));
  }
  return paths;
}

/**
 * Why root must not trust `paths`: each, resolved, and every directory
 * above it up to / must be root-owned and writable by no group or other
 * user — otherwise another user could change what root runs or installs.
 * Empty when they can be trusted.
 *
 * @param {string[]} paths
 * @param {{ lstat?: typeof lstat, realpath?: typeof realpath }} [fsOverrides] - tests
 * @returns {Promise<string[]>}
 */
export async function untrustedPaths(paths, fsOverrides = {}) {
  const lstatOf = fsOverrides.lstat ?? lstat;
  const resolve = fsOverrides.realpath ?? realpath;
  const problems = [];
  const seen = new Set();
  for (const p of paths) {
    let current = await resolve(p);
    for (;;) {
      if (!seen.has(current)) {
        seen.add(current);
        const st = await lstatOf(current);
        if (st.uid !== 0) {
          problems.push(`${current} is owned by uid ${st.uid}, not root`);
        } else if ((st.mode & 0o022) !== 0) {
          problems.push(`${current} is writable by its group or by others`);
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return problems;
}

/** How to get a lamaste-agent root can trust. */
export const ROOT_OWNED_INSTALL = 'sudo npm install -g @lamalibre/lamaste-agent';
