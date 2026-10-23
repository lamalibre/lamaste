/**
 * Read a plugin's web tree (`userSurface.web`, see `web-surface.ts` in the
 * root) — from a version's registry tarball, before anyone approved it, and
 * from a directory on disk: the installed package, or a copy the relay is
 * about to serve, checked against the approved manifest.
 *
 * Both readers apply every rule of a web tree (`webTreeManifest`) and take
 * nothing but regular files: a link anywhere in the tree fails the read, so
 * nothing in a package can point the relay's copy, or nginx, elsewhere.
 */

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  WEB_TREE_LIMITS,
  WebTreeError,
  webTreeFileSha256,
  webTreeLimitError,
  webTreeManifest,
} from '../web-surface.js';
import type { WebTreeFile, WebTreeManifest } from '../web-surface.js';
import { DEFAULT_TARBALL_LIMITS, TarballEntryError, readTarballTree } from './tarball.js';

/** Where npm puts a package's files inside its tarball. */
const NPM_TARBALL_ROOT = 'package';

/**
 * The manifest of the web tree at `root` (the manifest's
 * `userSurface.web.root`) inside an npm package tarball. Throws
 * {@link WebTreeError} — `NOT_FOUND` when the package has no file under
 * `root` — or an archive error.
 */
export function webTreeManifestOfTarball(tgz: Buffer, root: string): WebTreeManifest {
  let files: Map<string, Buffer>;
  try {
    files = readTarballTree(tgz, `${NPM_TARBALL_ROOT}/${root}`, {
      maxArchiveBytes: DEFAULT_TARBALL_LIMITS.maxArchiveBytes,
      maxFileBytes: WEB_TREE_LIMITS.maxFileBytes,
    });
  } catch (err) {
    // A link, an oversized or a repeated file is the tree's fault, not the archive's.
    if (!(err instanceof TarballEntryError)) throw err;
    const relative = err.entry.slice(`${NPM_TARBALL_ROOT}/${root}/`.length);
    if (err.reason === 'NOT_REGULAR_FILE') {
      throw new WebTreeError('not a regular file', 'NOT_REGULAR_FILE', relative);
    }
    if (err.reason === 'TOO_LARGE') {
      throw webTreeLimitError('FILE_TOO_LARGE', relative);
    }
    throw new WebTreeError('listed twice', 'DUPLICATE_PATH', relative);
  }
  if (files.size === 0) {
    throw new WebTreeError(`the package has no files under ${root}/`, 'NOT_FOUND');
  }
  const entries: WebTreeFile[] = [];
  for (const [relative, bytes] of files) {
    entries.push({ path: relative, size: bytes.length, sha256: webTreeFileSha256(bytes) });
  }
  return webTreeManifest(entries);
}

/**
 * The size and SHA-256 of a regular file, read once without following a
 * link (`O_NOFOLLOW`): what is hashed is what is counted, whatever the
 * file was when it was listed. Over the file limit throws `FILE_TOO_LARGE`
 * before reading further.
 */
async function hashFile(file: string, relative: string): Promise<{ size: number; sha256: string }> {
  const hash = crypto.createHash('sha256');
  let size = 0;
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += (chunk as Buffer).length;
      if (size > WEB_TREE_LIMITS.maxFileBytes) {
        throw webTreeLimitError('FILE_TOO_LARGE', relative);
      }
      hash.update(chunk as Buffer);
    }
  } finally {
    await handle.close();
  }
  return { size, sha256: hash.digest('hex') };
}

/**
 * The manifest of the web tree in directory `dir`. Walks it without
 * following links: a link, or anything but a directory or a regular file,
 * fails the read (`NOT_REGULAR_FILE`); so does a tree over the limits,
 * before all of it is hashed. Throws {@link WebTreeError} — `NOT_FOUND`
 * when `dir` is not a directory.
 */
export async function webTreeManifestOfDirectory(dir: string): Promise<WebTreeManifest> {
  const top = await lstat(dir).catch(() => null);
  if (!top?.isDirectory()) throw new WebTreeError(`${dir} is not a directory`, 'NOT_FOUND');

  const entries: WebTreeFile[] = [];
  let totalBytes = 0;
  const walk = async (relativeDir: string, depth: number): Promise<void> => {
    const names = await readdir(path.join(dir, relativeDir));
    for (const name of names) {
      const relative = relativeDir === '' ? name : `${relativeDir}/${name}`;
      const stat = await lstat(path.join(dir, relative));
      if (stat.isDirectory()) {
        if (depth + 1 >= WEB_TREE_LIMITS.maxDepth) {
          throw new WebTreeError(
            `deeper than ${WEB_TREE_LIMITS.maxDepth} levels`,
            'INVALID_PATH',
            relative,
          );
        }
        await walk(relative, depth + 1);
        continue;
      }
      if (!stat.isFile())
        throw new WebTreeError('not a regular file', 'NOT_REGULAR_FILE', relative);
      if (entries.length === WEB_TREE_LIMITS.maxFiles) {
        throw webTreeLimitError('TOO_MANY_FILES');
      }
      const { size, sha256 } = await hashFile(path.join(dir, relative), relative);
      totalBytes += size;
      if (totalBytes > WEB_TREE_LIMITS.maxTreeBytes) {
        throw webTreeLimitError('TREE_TOO_LARGE');
      }
      entries.push({ path: relative, size, sha256 });
    }
  };
  await walk('', 0);
  return webTreeManifest(entries);
}
