// The packages a Lamaste release consists of, shared by pack-release.mjs and
// publish-to-feria.mjs: every package.json tracked in this repository that
// is named @lamalibre/*, not private, and not pinned to another registry by
// publishConfig.registry. Zero dependencies (Node 22).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/** `MAJOR.MINOR.PATCH[-prerelease]` — what a release tag `v<version>` carries. */
export const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The file name of the release manifest attached to the GitHub Release. */
export const MANIFEST = 'release-manifest.json';

/** @returns {{ name: string, version: string, dir: string }[]} sorted by name */
export function releasePackages() {
  const files = execFileSync('git', ['ls-files', '*package.json', 'package.json'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f && !f.includes('node_modules/'));
  const found = [];
  for (const file of files) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@lamalibre/')) continue;
    if (pkg.private === true || pkg.publishConfig?.registry) continue;
    found.push({ name: pkg.name, version: pkg.version, dir: path.dirname(file) });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** npm's `dist.integrity` of a tarball's bytes. */
export function integrityOf(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/** The SHA-1 hex npm reports as `dist.shasum`. */
export function shasumOf(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

/**
 * The `package/package.json` an npm tarball carries, parsed — read from the
 * gzipped tar in memory (ustar headers; npm writes no long names for it).
 * @param {Buffer} tgz
 */
export function tarballManifest(tgz) {
  const tar = gunzipSync(tgz);
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => {
      const raw = header.subarray(start, start + len);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? len : end).toString('utf8');
    };
    const name = field(0, 100);
    const prefix = field(345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const body = off + 512;
    if ((type === '0' || type === '') && full === 'package/package.json') {
      return JSON.parse(tar.subarray(body, body + size).toString('utf8'));
    }
    off = body + Math.ceil(size / 512) * 512;
  }
  throw new Error('the tarball has no package/package.json');
}
