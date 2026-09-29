import { execa } from 'execa';
import { AUTHELIA_USER, CHISEL_GROUP } from './service-config.js';

/**
 * Service accounts create-lamaste manages. All functions are idempotent and
 * run as root.
 */

async function groupExists(name) {
  try {
    await execa('getent', ['group', name]);
    return true;
  } catch {
    return false;
  }
}

async function userExists(name) {
  try {
    await execa('getent', ['passwd', name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the group the chisel server runs as and add the lamaste user to it.
 * Run after the lamaste user exists and before the panel service (re)starts —
 * the service unit names the group in SupplementaryGroups=, and the panel
 * writes the chisel authfile and key with it.
 *
 * @returns {Promise<{ created: boolean }>}
 */
export async function ensureChiselGroup() {
  let created = false;
  if (!(await groupExists(CHISEL_GROUP))) {
    await execa('groupadd', ['--system', CHISEL_GROUP]);
    created = true;
  }
  await execa('usermod', ['--append', '--groups', CHISEL_GROUP, 'lamaste']);
  return { created };
}

/**
 * Create the system account Authelia runs as. Authelia is reachable from
 * the internet (auth.<domain>), so it runs as neither root nor lamaste: it
 * can read its configuration (group lamaste-authelia) and write only its
 * database, notification file and log.
 *
 * @returns {Promise<{ created: boolean }>}
 */
export async function ensureAutheliaUser() {
  if (await userExists(AUTHELIA_USER)) return { created: false };
  if (!(await groupExists(AUTHELIA_USER))) {
    await execa('groupadd', ['--system', AUTHELIA_USER]);
  }
  await execa('useradd', [
    '--system',
    '--gid',
    AUTHELIA_USER,
    '--no-create-home',
    '--home-dir',
    '/nonexistent',
    '--shell',
    '/usr/sbin/nologin',
    '--comment',
    'Lamaste Authelia',
    AUTHELIA_USER,
  ]);
  return { created: true };
}

/**
 * Numeric uid/gid of a user (primary group) or of a group.
 *
 * @param {'user'|'group'} kind
 * @param {string} name
 * @returns {Promise<number>}
 */
export async function lookupId(kind, name) {
  const { stdout } = await execa('getent', [kind === 'user' ? 'passwd' : 'group', name]);
  const id = Number.parseInt(stdout.split(':')[2] ?? '', 10);
  if (!Number.isInteger(id)) throw new Error(`Cannot resolve ${kind} ${name}`);
  return id;
}
