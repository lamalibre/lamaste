/**
 * Where the relay keeps the web trees it serves: one directory per plugin,
 * `<WEB_TREES_ROOT>/<route>/`, holding each tree under its digest
 * (`<sha256>/`) and two links, `current` (what the plugin's site serves)
 * and `previous` (the tree before it — a page still running the old shell
 * loads its lazy files from there, and a revert switches back to it).
 *
 * A tree enters the store only as a verified copy: it is copied file by
 * file (regular files only, read without following links) into a staging
 * directory, its manifest is computed again from the copy, and it is
 * renamed to its digest only when that manifest's digest is the approved
 * one. The links are replaced with a rename, so nginx sees the old tree or
 * the new one, never a mix. Nothing else is kept: once `current` moves, any
 * tree that is neither `current` nor `previous` goes.
 *
 * The web root belongs to the lamaste user with group www-data (see
 * `files.ts`): directories 0750 (setgid inherited), files 0640 — nginx
 * reads through the group, nobody else can.
 */

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';

import { WebTreeError } from '../web-surface.js';
import { SITES_ROOT } from './files.js';
import { webTreeManifestOfDirectory } from './web-tree.js';

/** Where plugins' web trees live: beside the sites, never one of them (site ids are UUIDs). */
export const WEB_TREES_ROOT = path.join(SITES_ROOT, 'apps');

const DIR_MODE = 0o750;
const FILE_MODE = 0o640;
const CURRENT = 'current';
const PREVIOUS = 'previous';
const STAGING_PREFIX = '.staging-';
const SHA256_RE = /^[a-f0-9]{64}$/;
const ROUTE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The store directory of plugin `route` under `root`. Throws on an invalid route. */
export function webTreeStoreDir(route: string, root: string = WEB_TREES_ROOT): string {
  if (!ROUTE_RE.test(route)) throw new Error(`Invalid plugin route: "${route}"`);
  return path.join(root, route);
}

/** What a store holds: the digests its links name (null when absent), and every tree in it. */
export interface WebTreeStoreState {
  readonly current: string | null;
  readonly previous: string | null;
  readonly trees: readonly string[];
}

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/** The digest link `name` names, or null when it is absent or names no digest. */
async function linkTarget(dir: string, name: string): Promise<string | null> {
  try {
    const target = await readlink(path.join(dir, name));
    return SHA256_RE.test(target) ? target : null;
  } catch (err) {
    if (errnoCode(err) === 'ENOENT' || errnoCode(err) === 'EINVAL') return null;
    throw err;
  }
}

/** The state of the store at `dir` — empty when there is none. */
export async function readWebTreeStore(dir: string): Promise<WebTreeStoreState> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return { current: null, previous: null, trees: [] };
    throw err;
  }
  return {
    current: await linkTarget(dir, CURRENT),
    previous: await linkTarget(dir, PREVIOUS),
    trees: names.filter((name) => SHA256_RE.test(name)).sort(),
  };
}

/** Copy one regular file, never following a link, into a new 0640 file. */
async function copyRegularFile(from: string, to: string): Promise<void> {
  const source = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await source.stat()).isFile()) {
      throw new WebTreeError('not a regular file', 'NOT_REGULAR_FILE', from);
    }
    const target = await open(to, 'wx', FILE_MODE);
    try {
      for await (const chunk of source.createReadStream({ autoClose: false })) {
        await target.write(chunk as Buffer);
      }
      await target.chmod(FILE_MODE);
      await target.sync();
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}

/**
 * Make sure the store at `dir` holds the tree `treeSha256`, copied from
 * `sourceDir` (an installed package's tree) when it does not: the source
 * must be that tree, and so must the copy, or nothing is kept. Returns
 * whether it copied. Throws {@link WebTreeError} (`DIGEST_MISMATCH` when a
 * tree is not the approved one).
 */
export async function stageWebTree(
  dir: string,
  sourceDir: string,
  treeSha256: string,
): Promise<boolean> {
  if (!SHA256_RE.test(treeSha256)) throw new Error('treeSha256 must be a SHA-256 hex digest');
  const target = path.join(dir, treeSha256);
  if (await lstat(target).catch(() => null)) return false;

  const source = await webTreeManifestOfDirectory(sourceDir);
  if (source.sha256 !== treeSha256) {
    throw new WebTreeError(
      'the installed package holds another web tree than the approved one',
      'DIGEST_MISMATCH',
    );
  }

  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const staging = path.join(dir, `${STAGING_PREFIX}${crypto.randomBytes(8).toString('hex')}`);
  await mkdir(staging, { mode: DIR_MODE });
  try {
    for (const file of source.files) {
      const to = path.join(staging, ...file.path.split('/'));
      await mkdir(path.dirname(to), { recursive: true, mode: DIR_MODE });
      await copyRegularFile(path.join(sourceDir, ...file.path.split('/')), to);
    }
    const copy = await webTreeManifestOfDirectory(staging);
    if (copy.sha256 !== treeSha256) {
      throw new WebTreeError('the copy of the web tree is not the approved one', 'DIGEST_MISMATCH');
    }
    try {
      await rename(staging, target);
    } catch (err) {
      // Another copy of the same tree got there first: keep it.
      if (errnoCode(err) !== 'ENOTEMPTY' && errnoCode(err) !== 'EEXIST') throw err;
      await rm(staging, { recursive: true, force: true });
      return false;
    }
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  return true;
}

/** Point link `name` at `treeSha256`, replacing it with a rename. */
async function pointLink(dir: string, name: string, treeSha256: string): Promise<void> {
  const temp = path.join(dir, `${STAGING_PREFIX}${name}-${crypto.randomBytes(8).toString('hex')}`);
  await symlink(treeSha256, temp);
  try {
    await rename(temp, path.join(dir, name));
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Serve tree `treeSha256` (already staged — {@link stageWebTree}) from the
 * store at `dir`: `previous` takes what `current` named, `current` the new
 * tree, each replaced with a rename; then every other tree and any staging
 * left behind goes. The tree is checked against its digest before it is
 * served. Returns whether `current` moved.
 *
 * Going back to the tree `previous` names — a reverted update, a rollback
 * release — abandons the outgoing tree: `previous` goes rather than keep
 * serving the files of a version that was backed out of, and the prune
 * removes that tree.
 */
export async function switchWebTree(dir: string, treeSha256: string): Promise<boolean> {
  if (!SHA256_RE.test(treeSha256)) throw new Error('treeSha256 must be a SHA-256 hex digest');
  const state = await readWebTreeStore(dir);
  if (state.current === treeSha256) return false;
  const tree = await webTreeManifestOfDirectory(path.join(dir, treeSha256));
  if (tree.sha256 !== treeSha256) {
    throw new WebTreeError('a stored web tree is not the one its name says', 'DIGEST_MISMATCH');
  }
  if (state.previous === treeSha256) {
    await pointLink(dir, CURRENT, treeSha256);
    await rm(path.join(dir, PREVIOUS), { force: true });
  } else {
    if (state.current !== null) await pointLink(dir, PREVIOUS, state.current);
    await pointLink(dir, CURRENT, treeSha256);
  }
  await pruneWebTreeStore(dir);
  return true;
}

/** Remove every tree but `current` and `previous`, and any staging left behind. */
async function pruneWebTreeStore(dir: string): Promise<void> {
  const { current, previous } = await readWebTreeStore(dir);
  for (const name of await readdir(dir)) {
    const keep = name === CURRENT || name === PREVIOUS || name === current || name === previous;
    if (keep) continue;
    if (SHA256_RE.test(name) || name.startsWith(STAGING_PREFIX)) {
      await rm(path.join(dir, name), { recursive: true, force: true });
    }
  }
}

/** Remove the store at `dir` altogether (its plugin's site and trees are gone). */
export async function removeWebTreeStore(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
