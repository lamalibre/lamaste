/**
 * Read named regular files out of an npm package tarball (`.tgz`) in
 * memory — how the panel looks at a plugin version before installing it
 * (the hook-set preview of an update) without extracting a stranger's
 * archive onto disk.
 *
 * Supports what npm writes: gzip-compressed ustar with the `prefix` field,
 * and PAX extended headers (`path`) for long names. Only regular files are
 * returned; links, devices and directories are skipped, so nothing in the
 * archive can point a read elsewhere.
 */

import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

export interface TarballLimits {
  /** Largest uncompressed archive accepted. */
  readonly maxArchiveBytes: number;
  /** Largest single file returned. */
  readonly maxFileBytes: number;
}

export const DEFAULT_TARBALL_LIMITS: TarballLimits = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
});

function cString(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf-8');
}

function octal(buf: Buffer, start: number, length: number): number {
  const text = cString(buf, start, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error('Corrupt tar header (size)');
  return parseInt(text, 8);
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = parseInt(data.subarray(at, space).toString('ascii'), 10);
    if (!Number.isInteger(length) || length <= 0 || at + length > data.length) break;
    const record = data.subarray(space + 1, at + length - 1).toString('utf-8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    at += length;
  }
  return out;
}

const TARBALL_ENTRY_PROBLEMS = {
  NOT_REGULAR_FILE: 'is not a regular file',
  TOO_LARGE: 'is too large',
  DUPLICATE: 'is in the archive twice',
} as const;

/**
 * An entry of a tarball that a tree read refuses (see
 * {@link readTarballTree}): `NOT_REGULAR_FILE`, `TOO_LARGE` or `DUPLICATE`.
 * `entry` is its archive path.
 */
export class TarballEntryError extends Error {
  constructor(
    readonly entry: string,
    readonly reason: keyof typeof TARBALL_ENTRY_PROBLEMS,
  ) {
    super(`${entry} ${TARBALL_ENTRY_PROBLEMS[reason]}`);
    this.name = 'TarballEntryError';
  }
}

/** One entry of a tarball, as {@link walkTarball} hands it out. */
interface TarballEntry {
  /** The archive path (`package/…`). */
  readonly name: string;
  /** A regular file (`0`, NUL or `7`). */
  readonly isFile: boolean;
  /** A directory (`5`). */
  readonly isDirectory: boolean;
  readonly size: number;
  /** The content (a copy); only meaningful for a regular file. */
  data(): Buffer;
}

/**
 * Visit every entry of the gzip tarball `tgz` but PAX headers, in archive
 * order. Throws on a corrupt archive or an archive over the limit.
 */
function walkTarball(
  tgz: Buffer,
  limits: TarballLimits,
  visit: (entry: TarballEntry) => void,
): void {
  const tar = gunzipSync(tgz, { maxOutputLength: limits.maxArchiveBytes });
  let at = 0;
  let paxPath: string | null = null;
  while (at + BLOCK <= tar.length) {
    const header = tar.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = at + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('Corrupt tar archive (truncated)');

    if (type === 'x') {
      paxPath = parsePax(tar.subarray(dataStart, dataEnd))['path'] ?? null;
    } else if (type === 'g') {
      // Global PAX header: nothing npm relies on.
    } else {
      const name = cString(header, 0, 100);
      const prefix = cString(header, 345, 155);
      const fullName = paxPath ?? (prefix ? `${prefix}/${name}` : name);
      paxPath = null;
      visit({
        name: fullName,
        isFile: type === '0' || type === '\0' || type === '7',
        isDirectory: type === '5',
        size,
        data: () => Buffer.from(tar.subarray(dataStart, dataEnd)),
      });
    }
    at = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
}

/**
 * Return the files of `wanted` (archive paths such as
 * `package/lamaste-plugin.json`) found in the gzip tarball `tgz`. Paths not
 * present are simply absent from the result. Throws on a corrupt archive or
 * a limit.
 */
export function readTarballFiles(
  tgz: Buffer,
  wanted: ReadonlySet<string>,
  limits: TarballLimits = DEFAULT_TARBALL_LIMITS,
): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  walkTarball(tgz, limits, (entry) => {
    if (!entry.isFile || !wanted.has(entry.name)) return;
    if (entry.size > limits.maxFileBytes) throw new Error(`${entry.name} is too large`);
    found.set(entry.name, entry.data());
  });
  return found;
}

/**
 * Return every regular file under the archive directory `dir` (such as
 * `package/web`) of the gzip tarball `tgz`, keyed by its path relative to
 * `dir`. Directories are skipped; any other entry under `dir` — a link, a
 * device — throws {@link TarballEntryError}, as does a file over the limit
 * or one the archive holds twice: a tree read this way is all regular
 * files, or not read at all.
 */
export function readTarballTree(
  tgz: Buffer,
  dir: string,
  limits: TarballLimits = DEFAULT_TARBALL_LIMITS,
): Map<string, Buffer> {
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  const found = new Map<string, Buffer>();
  walkTarball(tgz, limits, (entry) => {
    if (!entry.name.startsWith(prefix) || entry.isDirectory) return;
    const relative = entry.name.slice(prefix.length);
    if (!entry.isFile) throw new TarballEntryError(entry.name, 'NOT_REGULAR_FILE');
    if (entry.size > limits.maxFileBytes) throw new TarballEntryError(entry.name, 'TOO_LARGE');
    if (found.has(relative)) throw new TarballEntryError(entry.name, 'DUPLICATE');
    found.set(relative, entry.data());
  });
  return found;
}
