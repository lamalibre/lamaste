/**
 * The agent's chisel client binary at `~/.lamalibre/lamaste/bin/chisel`.
 *
 * Always the pinned release ({@link CHISEL_RELEASE}): the download is verified
 * against the pinned SHA-256 before it is unpacked, and a binary reporting any
 * other version is replaced. The new binary is written next to the old one and
 * renamed over it, so a running client keeps its (unlinked) image until the
 * service restarts.
 */

import crypto from 'node:crypto';
import { access, constants, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { CHISEL_RELEASE } from '../constants.js';
import {
  curlDownloadArgs,
  downloadVerifiedChisel,
  isPinnedChiselVersion,
  normaliseChiselVersion,
} from '../chisel-download.js';
import { CHISEL_BIN_DIR, CHISEL_BIN_PATH, detectArch } from './platform.js';

export interface AgentChiselBinaryResult {
  /** True when a binary was (re)installed by this call. */
  readonly installed: boolean;
  readonly version: string;
  /** What the replaced binary reported, if one existed. */
  readonly previousVersion: string | null;
}

/** The version the installed agent chisel reports, or null if it does not run. */
export async function installedAgentChiselVersion(): Promise<string | null> {
  try {
    await access(CHISEL_BIN_PATH, constants.X_OK);
  } catch {
    return null;
  }
  const { execa } = await import('execa');
  try {
    const { stdout } = await execa(CHISEL_BIN_PATH, ['--version'], { timeout: 10_000 });
    return normaliseChiselVersion(stdout);
  } catch {
    return null;
  }
}

/**
 * Install the pinned chisel release unless it is already installed.
 * No privileges needed: the binary lives in the user's data directory.
 */
export async function ensureAgentChiselBinary(): Promise<AgentChiselBinaryResult> {
  const previousVersion = await installedAgentChiselVersion();
  if (isPinnedChiselVersion(previousVersion)) {
    return { installed: false, version: CHISEL_RELEASE.version, previousVersion };
  }

  await mkdir(CHISEL_BIN_DIR, { recursive: true, mode: 0o700 });
  const suffix = crypto.randomBytes(6).toString('hex');
  const gzPath = path.join(CHISEL_BIN_DIR, `.chisel-download-${suffix}.gz`);
  const tmpBin = path.join(CHISEL_BIN_DIR, `.chisel-${suffix}`);
  const { execa } = await import('execa');
  try {
    await downloadVerifiedChisel(detectArch(), gzPath, tmpBin, async (url, out) => {
      await execa('curl', curlDownloadArgs(url, out));
    });
    await rename(tmpBin, CHISEL_BIN_PATH);
  } finally {
    await rm(tmpBin, { force: true });
  }

  const version = await installedAgentChiselVersion();
  if (!isPinnedChiselVersion(version)) {
    throw new Error(
      `Chisel was installed but reports version ${String(version)}, expected ${CHISEL_RELEASE.version}.`,
    );
  }
  return { installed: true, version: CHISEL_RELEASE.version, previousVersion };
}
