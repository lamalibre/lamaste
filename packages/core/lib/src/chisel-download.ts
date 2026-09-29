/**
 * Verified download of the pinned Chisel release — shared by the server
 * installer (`/usr/local/bin/chisel`) and the agent installer
 * (`~/.lamalibre/lamaste/bin/chisel`).
 *
 * The asset is fetched from its fixed release URL (no GitHub API lookup, so
 * no rate limit and no "latest" drift), its SHA-256 is compared with the
 * digest pinned in {@link CHISEL_RELEASE} before a single byte is unpacked,
 * and only then is it gunzipped into place. A mismatch aborts the install
 * and leaves any existing binary untouched.
 */

import crypto from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { CHISEL_RELEASE, chiselAssetUrl } from './constants.js';
import type { ChiselArch } from './constants.js';

const gunzipAsync = promisify(gunzip);

/** Largest asset accepted, well above the ~4 MB release files. */
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

/** Downloads `url` to `outPath`; implementations must fail on HTTP errors. */
export type FetchToFile = (url: string, outPath: string) => Promise<void>;

/**
 * The curl arguments both installers use: HTTPS only (also across redirects
 * to the GitHub CDN), TLS 1.2+, fail on HTTP errors, bounded size and time.
 */
export function curlDownloadArgs(url: string, outPath: string): string[] {
  return [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--tlsv1.2',
    '--max-filesize',
    String(MAX_ASSET_BYTES),
    '--max-time',
    '300',
    '--output',
    outPath,
    url,
  ];
}

/** Normalise `chisel --version` output (`1.12.0`, `v1.12.0`) to `1.12.0`. */
export function normaliseChiselVersion(output: string): string {
  return output.trim().replace(/^v/, '');
}

/** True when an installed binary reports the pinned version. */
export function isPinnedChiselVersion(output: string | null): boolean {
  return output !== null && normaliseChiselVersion(output) === CHISEL_RELEASE.version;
}

/**
 * Download the pinned Chisel release for `arch`, verify its digest and write
 * the executable to `binPath` (mode 0755). `gzPath` is scratch space for the
 * compressed download and is always removed.
 */
export async function downloadVerifiedChisel(
  arch: ChiselArch,
  gzPath: string,
  binPath: string,
  fetchToFile: FetchToFile,
): Promise<void> {
  const url = chiselAssetUrl(arch);
  const expected = CHISEL_RELEASE.sha256[arch];
  try {
    try {
      await fetchToFile(url, gzPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to download Chisel ${CHISEL_RELEASE.version} from ${url}: ${message}`,
      );
    }
    const gz = await readFile(gzPath);
    if (gz.length > MAX_ASSET_BYTES) {
      throw new Error(`Chisel download from ${url} is unexpectedly large (${gz.length} bytes)`);
    }
    const actual = crypto.createHash('sha256').update(gz).digest('hex');
    if (actual !== expected) {
      throw new Error(
        `Chisel download from ${url} failed verification: SHA-256 ${actual}, expected ${expected}`,
      );
    }
    const binary = await gunzipAsync(gz);
    await writeFile(binPath, binary, { mode: 0o755 });
  } finally {
    await rm(gzPath, { force: true });
  }
}
