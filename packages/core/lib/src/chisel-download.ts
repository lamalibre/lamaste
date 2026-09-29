/**
 * Verified downloads of the pinned Chisel and Authelia releases — shared by
 * the server installer (`create-lamaste`, which installs both under
 * /usr/local/bin as root) and the agent installer
 * (`~/.lamalibre/lamaste/bin/chisel`).
 *
 * An asset is fetched from its fixed release URL (no GitHub API lookup, so
 * no rate limit and no "latest" drift), and its SHA-256 is compared with the
 * digest pinned in {@link CHISEL_RELEASE} / {@link AUTHELIA_RELEASE} before a
 * single byte is unpacked. A mismatch aborts the install and leaves any
 * existing binary untouched.
 */

import crypto from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { AUTHELIA_RELEASE, CHISEL_RELEASE, autheliaAssetUrl, chiselAssetUrl } from './constants.js';
import type { AutheliaArch, ChiselArch } from './constants.js';

const gunzipAsync = promisify(gunzip);

/** Largest asset accepted, well above the ~4 MB chisel and ~21 MB Authelia assets. */
const MAX_ASSET_BYTES = 128 * 1024 * 1024;

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
 * Fetch `url` to `outPath` and check its SHA-256 against `expected`. Throws
 * (leaving `outPath` for the caller to remove) on a failed download, an
 * oversized asset or a digest mismatch; returns the verified bytes.
 */
async function fetchVerified(
  label: string,
  url: string,
  expected: string,
  outPath: string,
  fetchToFile: FetchToFile,
): Promise<Buffer> {
  try {
    await fetchToFile(url, outPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to download ${label} from ${url}: ${message}`);
  }
  const data = await readFile(outPath);
  if (data.length > MAX_ASSET_BYTES) {
    throw new Error(`${label} download from ${url} is unexpectedly large (${data.length} bytes)`);
  }
  const actual = crypto.createHash('sha256').update(data).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `${label} download from ${url} failed verification: SHA-256 ${actual}, expected ${expected}`,
    );
  }
  return data;
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
  try {
    const gz = await fetchVerified(
      `Chisel ${CHISEL_RELEASE.version}`,
      chiselAssetUrl(arch),
      CHISEL_RELEASE.sha256[arch],
      gzPath,
      fetchToFile,
    );
    const binary = await gunzipAsync(gz);
    await writeFile(binPath, binary, { mode: 0o755 });
  } finally {
    await rm(gzPath, { force: true });
  }
}

/**
 * Download the pinned Authelia release tarball for `arch` to `tgzPath` and
 * verify its digest. The caller unpacks it (the tarball holds the `authelia`
 * binary next to upstream packaging files) and removes it. On failure the
 * download is removed.
 */
export async function downloadVerifiedAuthelia(
  arch: AutheliaArch,
  tgzPath: string,
  fetchToFile: FetchToFile,
): Promise<void> {
  try {
    await fetchVerified(
      `Authelia ${AUTHELIA_RELEASE.version}`,
      autheliaAssetUrl(arch),
      AUTHELIA_RELEASE.sha256[arch],
      tgzPath,
      fetchToFile,
    );
  } catch (err: unknown) {
    await rm(tgzPath, { force: true });
    throw err;
  }
}

/** Normalise `authelia --version` output (`authelia version v4.39.28`) to `4.39.28`. */
export function normaliseAutheliaVersion(output: string): string | null {
  const match = /v?(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1] ?? null;
}
