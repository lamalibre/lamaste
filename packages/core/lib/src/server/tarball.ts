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
  const tar = gunzipSync(tgz, { maxOutputLength: limits.maxArchiveBytes });
  const found = new Map<string, Buffer>();
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
      const isFile = type === '0' || type === '\0' || type === '7';
      if (isFile && wanted.has(fullName)) {
        if (size > limits.maxFileBytes) throw new Error(`${fullName} is too large`);
        found.set(fullName, Buffer.from(tar.subarray(dataStart, dataEnd)));
      }
    }
    at = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  return found;
}
