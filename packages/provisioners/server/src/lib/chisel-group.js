import { execa } from 'execa';
import { CHISEL_GROUP } from './service-config.js';

/**
 * Create the group the chisel server runs as and add the lamaste user to it.
 * Idempotent. Run as root, after the lamaste user exists and before the
 * panel service (re)starts — the service unit names the group in
 * SupplementaryGroups=, and the panel writes the chisel authfile with it.
 *
 * @returns {Promise<{ created: boolean }>}
 */
export async function ensureChiselGroup() {
  let created = false;
  try {
    await execa('getent', ['group', CHISEL_GROUP]);
  } catch {
    await execa('groupadd', ['--system', CHISEL_GROUP]);
    created = true;
  }
  await execa('usermod', ['--append', '--groups', CHISEL_GROUP, 'lamaste']);
  return { created };
}
