import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureAutheliaUser, ensureChiselGroup, lookupId } from './accounts.js';
import { installPinnedAuthelia, installPinnedChisel } from './binaries.js';
import { ensureOidcIssuerKey } from './oidc-issuer-key.js';
import {
  chownTree,
  ensureDirectory,
  migrateAutheliaDir,
  migrateWebRoot,
  setFileOwnership,
} from './ownership.js';
import {
  AUTHELIA_CONFIG_DIR,
  AUTHELIA_LOG_DIR,
  AUTHELIA_UNIT_PATH,
  AUTHELIA_USER,
  CHISEL_GROUP,
  CHISEL_UNIT_PATH,
  HOOKS_DIR,
  HOOKS_SERVICE_UNIT_PATH,
  HOOKS_SOCKET_UNIT_PATH,
  WEB_ROOT,
  generateAutheliaUnit,
  generateChiselUnit,
  generateHooksServiceUnit,
  generateHooksSocketUnit,
} from './service-config.js';

async function writeIfChanged(path, content) {
  let current = null;
  try {
    current = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (current === content) return false;
  await writeFile(path, content, { mode: 0o644 });
  return true;
}

/**
 * Everything the relay's services need from root, for a fresh install and
 * for every redeploy: service accounts, the pinned chisel and Authelia
 * binaries, their systemd units, and the ownership of the directories the
 * panel writes without privileges. Idempotent.
 *
 * Does not start, stop or restart anything: the caller runs
 * `systemctl daemon-reload` and restarts what changed. Onboarding enables
 * and starts chisel and Authelia on a fresh install.
 *
 * @param {{ configDir: string, pkiDir: string, installDir: string }} ctx
 * @param {(line: string) => void} report
 * @returns {Promise<{ chiselChanged: boolean, autheliaChanged: boolean }>}
 *   whether the binary or unit of each changed (a running service needs a
 *   restart to pick it up)
 */
export async function provisionRelayServices(ctx, report) {
  report(`Ensuring the ${CHISEL_GROUP} group and the ${AUTHELIA_USER} account...`);
  await ensureChiselGroup();
  await ensureAutheliaUser();

  const lamasteUid = await lookupId('user', 'lamaste');
  const lamasteGid = await lookupId('group', 'lamaste');
  const wwwDataGid = await lookupId('group', 'www-data');
  const chiselGid = await lookupId('group', CHISEL_GROUP);
  const autheliaUid = await lookupId('user', AUTHELIA_USER);
  const autheliaGid = await lookupId('group', AUTHELIA_USER);

  report('Installing the pinned chisel release...');
  const chisel = await installPinnedChisel();
  report('Installing the pinned Authelia release...');
  const authelia = await installPinnedAuthelia();
  if (authelia.keptNewer) {
    report(`Keeping the installed Authelia ${authelia.version} (newer than the pinned release)`);
  }

  report('Setting ownership of the web root, Authelia and chisel files...');
  await migrateWebRoot(WEB_ROOT, { lamasteUid, wwwDataGid });
  const autheliaDir = await migrateAutheliaDir(AUTHELIA_CONFIG_DIR, {
    lamasteUid,
    lamasteGid,
    autheliaUid,
    autheliaGid,
  });
  await ensureDirectory(AUTHELIA_LOG_DIR, { uid: autheliaUid, gid: autheliaGid, mode: 0o750 });
  await chownTree(AUTHELIA_LOG_DIR, `${autheliaUid}:${autheliaGid}`);
  // The OIDC issuer key: Authelia's alone, generated here so the panel —
  // which writes the configuration that references it — never holds it.
  await ensureOidcIssuerKey({ autheliaUid, autheliaGid, report });
  // chisel runs as nobody:lamaste-chisel; the panel creates the key (as
  // lamaste, group lamaste-chisel). Earlier versions made it nobody:nogroup 0400.
  await setFileOwnership(join(ctx.configDir, 'chisel-server.key'), {
    uid: lamasteUid,
    gid: chiselGid,
    mode: 0o640,
  });
  // The panel is the CA: the PKI directory is its own. Files earlier
  // versions created through sudo may still be root-owned.
  await chownTree(ctx.pkiDir, `${lamasteUid}:${lamasteGid}`).catch((err) => {
    if (!/No such file/.test(err.stderr ?? '')) throw err;
  });

  report('Writing the chisel and Authelia units...');
  const chiselUnitChanged = await writeIfChanged(CHISEL_UNIT_PATH, generateChiselUnit(ctx));
  const autheliaUnitChanged = await writeIfChanged(AUTHELIA_UNIT_PATH, generateAutheliaUnit());

  // Relay hook runners: template units only. lamaste-priv enables an
  // instance per plugin and places its approved module under HOOKS_DIR,
  // which stays root's; a running runner picks a new unit up when it next
  // starts (it exits when idle).
  report('Writing the relay hook runner units...');
  await ensureDirectory(HOOKS_DIR, { uid: 0, gid: 0, mode: 0o755 });
  await writeIfChanged(HOOKS_SOCKET_UNIT_PATH, generateHooksSocketUnit());
  await writeIfChanged(HOOKS_SERVICE_UNIT_PATH, generateHooksServiceUnit(ctx));

  return {
    chiselChanged: chisel.changed || chiselUnitChanged,
    autheliaChanged: authelia.changed || autheliaUnitChanged || autheliaDir.migrated,
  };
}
