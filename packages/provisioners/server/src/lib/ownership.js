import { execa } from 'execa';
import { constants } from 'node:fs';
import { chmod, chown, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import crypto from 'node:crypto';
import { basename, dirname, join } from 'node:path';

/**
 * Filesystem operations create-lamaste performs as root on paths the lamaste
 * user can write to (its config directory, the web root, /etc/authelia).
 *
 * The panel may be compromised, and it can trigger create-lamaste itself
 * (self-update), so anything it controls may be a trap: a symlink where a
 * file is expected, planted between a check and a use. These helpers never
 * follow a symlink the lamaste user could have placed:
 * - new files are created with O_EXCL | O_NOFOLLOW under a random name and
 *   renamed into place (rename replaces a symlink, it does not follow it);
 * - ownership and mode are changed through the open file descriptor
 *   (fchown/fchmod), never by path;
 * - recursive changes use coreutils (chown -R, rm -rf), which do not follow
 *   symlinks and are safe against a tree changing underneath them.
 */

const NOFOLLOW_READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * Atomically write `content` to `path`, owned by uid:gid with `mode`.
 *
 * @param {string} path
 * @param {string | Uint8Array} content
 * @param {{ mode: number, uid: number, gid: number }} options
 */
export async function writeFileNoFollow(path, content, { mode, uid, gid }) {
  const tmp = join(dirname(path), `.${basename(path)}.${crypto.randomBytes(8).toString('hex')}`);
  const fh = await open(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await fh.writeFile(content);
    await fh.chown(uid, gid);
    await fh.chmod(mode);
    await fh.sync();
  } catch (err) {
    await fh.close();
    await rm(tmp, { force: true });
    throw err;
  }
  await fh.close();
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Set owner and mode of the regular file at `path` through a descriptor.
 * A symlink, a missing file or anything but a regular file is left alone.
 *
 * @returns {Promise<boolean>} whether the file exists and was checked
 */
export async function setFileOwnership(path, { uid, gid, mode }) {
  let fh;
  try {
    fh = await open(path, NOFOLLOW_READ);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ELOOP') return false;
    throw err;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return false;
    if (st.uid !== uid || st.gid !== gid) await fh.chown(uid, gid);
    if ((st.mode & 0o7777) !== mode) await fh.chmod(mode);
    return true;
  } finally {
    await fh.close();
  }
}

/**
 * Set owner and mode of the directory at `path` through a descriptor,
 * creating it (root-owned parent assumed) if it does not exist.
 */
export async function ensureDirectory(path, { uid, gid, mode }) {
  await mkdir(path, { recursive: true, mode });
  const fh = await open(path, NOFOLLOW_READ | constants.O_DIRECTORY);
  try {
    const st = await fh.stat();
    if (st.uid !== uid || st.gid !== gid) await fh.chown(uid, gid);
    if ((st.mode & 0o7777) !== mode) await fh.chmod(mode);
  } finally {
    await fh.close();
  }
}

/** `rm -rf` without following symlinks or crossing filesystems. */
export async function removeTree(path) {
  await execa('rm', ['-rf', '--one-file-system', '--', path]);
}

/** `chown -R` without following symlinks (coreutils' default for -R). */
export async function chownTree(path, owner) {
  await execa('chown', ['-R', '-P', '--', owner, path]);
}

/**
 * Make the install directory (code the panel runs, and the lamaste-server
 * CLI that administrators run as root) writable by root only. Earlier
 * versions handed it to the lamaste user: a compromised panel could then
 * rewrite code that root executes. Its contents are not reused — the tree
 * may hold symlinks that would redirect the redeploy's writes — so a tree
 * not already owned by root is moved aside, a fresh root-owned directory
 * takes its place, and the caller redeploys every component into it and
 * then removes the old tree.
 *
 * @param {string} installDir
 * @returns {Promise<{ previous: string | null }>} the moved-aside tree, if any
 */
export async function ensureRootOwnedInstallDir(installDir) {
  let needsReset = false;
  try {
    const st = await lstat(installDir);
    if (!st.isDirectory() || st.uid !== 0) {
      needsReset = true;
    } else {
      for (const entry of await readdir(installDir)) {
        if ((await lstat(join(installDir, entry))).uid !== 0) {
          needsReset = true;
          break;
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let previous = null;
  if (needsReset) {
    previous = `${installDir}.lamaste-owned-${Date.now()}`;
    await rename(installDir, previous);
  }
  await ensureDirectory(installDir, { uid: 0, gid: 0, mode: 0o755 });
  return { previous };
}

/**
 * Hand the web root to the lamaste user, readable by nginx through the
 * www-data group: directories 2750 (new files inherit the group), files
 * 0640. Earlier versions kept it www-data-owned and let the panel write it
 * through wildcard sudo rules. Modes are fixed while the tree is still
 * owned by www-data, before the lamaste user can touch it.
 *
 * @param {string} webRoot
 * @param {{ lamasteUid: number, wwwDataGid: number }} ids
 * @returns {Promise<{ migrated: boolean }>}
 */
export async function migrateWebRoot(webRoot, { lamasteUid, wwwDataGid }) {
  let st = null;
  try {
    st = await lstat(webRoot);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (st && st.isDirectory() && st.uid === lamasteUid) {
    await ensureDirectory(webRoot, { uid: lamasteUid, gid: wwwDataGid, mode: 0o2750 });
    return { migrated: false };
  }
  if (st && !st.isDirectory()) throw new Error(`${webRoot} is not a directory`);
  if (st) {
    await execa('find', [webRoot, '-xdev', '-type', 'd', '-exec', 'chmod', '2750', '{}', '+']);
    await execa('find', [webRoot, '-xdev', '-type', 'f', '-exec', 'chmod', '0640', '{}', '+']);
    await chownTree(webRoot, `${lamasteUid}:${wwwDataGid}`);
  }
  await ensureDirectory(webRoot, { uid: lamasteUid, gid: wwwDataGid, mode: 0o2750 });
  return { migrated: st !== null };
}

/**
 * Give /etc/authelia to the lamaste user (the panel writes Authelia's
 * configuration) and its group to the Authelia account (which reads the
 * configuration and keeps its database and notification file there).
 * Earlier versions ran Authelia as root with every file root-owned. Files
 * are re-owned while the directory still belongs to root, so the lamaste
 * user cannot interfere; the directory itself is handed over last.
 *
 * @param {string} dir
 * @param {{ lamasteUid: number, lamasteGid: number, autheliaUid: number, autheliaGid: number }} ids
 * @returns {Promise<{ migrated: boolean }>}
 */
export async function migrateAutheliaDir(dir, ids) {
  const { lamasteUid, lamasteGid, autheliaUid, autheliaGid } = ids;
  let st = null;
  try {
    st = await lstat(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (st && st.isDirectory() && st.uid === lamasteUid) {
    await ensureDirectory(dir, { uid: lamasteUid, gid: autheliaGid, mode: 0o2770 });
    return { migrated: false };
  }
  if (st && !st.isDirectory()) throw new Error(`${dir} is not a directory`);

  if (st) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(dir, entry.name);
      const name = entry.name;
      if (name === '.secrets.json') {
        // The panel's own record of the secrets; Authelia reads them from its config.
        await chown(path, lamasteUid, lamasteGid);
        await chmod(path, 0o600);
      } else if (name.startsWith('db.sqlite3') || name === 'notifications.txt') {
        await chown(path, autheliaUid, autheliaGid);
        await chmod(path, 0o600);
      } else if (name === 'users.yml') {
        // Authelia rewrites it in place when a user changes their password.
        await chown(path, lamasteUid, autheliaGid);
        await chmod(path, 0o660);
      } else {
        await chown(path, lamasteUid, autheliaGid);
        await chmod(path, 0o640);
      }
    }
  }
  await ensureDirectory(dir, { uid: lamasteUid, gid: autheliaGid, mode: 0o2770 });
  return { migrated: st !== null };
}
