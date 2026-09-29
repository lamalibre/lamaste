import { execa } from 'execa';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTHELIA_RELEASE,
  CHISEL_RELEASE,
  curlDownloadArgs,
  downloadVerifiedAuthelia,
  downloadVerifiedChisel,
  isPinnedChiselVersion,
  normaliseAutheliaVersion,
} from '@lamalibre/lamaste';
import { AUTHELIA_BIN, CHISEL_BIN } from './service-config.js';

/**
 * Install the pinned chisel and Authelia releases under /usr/local/bin.
 *
 * Downloads are verified against the SHA-256 digests pinned in
 * @lamalibre/lamaste before anything is unpacked, staged in a root-private
 * temporary directory, and moved into place with a rename, so a running
 * service never sees a half-written binary. Runs as root; the panel never
 * installs a binary.
 */

const CHISEL_ARCH = { x64: 'linux_amd64', arm64: 'linux_arm64' };
const AUTHELIA_ARCH = { x64: 'linux-amd64', arm64: 'linux-arm64' };

function archFor(table, what) {
  const arch = table[process.arch];
  if (!arch) throw new Error(`Unsupported architecture for ${what}: ${process.arch}`);
  return arch;
}

async function fetchToFile(url, outPath) {
  await execa('curl', curlDownloadArgs(url, outPath));
}

/** Put `src` at `dest` as a root-owned 0755 executable, atomically. */
async function installExecutable(src, dest) {
  const staged = `${dest}.lamaste-new`;
  await execa('install', ['-o', 'root', '-g', 'root', '-m', '0755', src, staged]);
  await rename(staged, dest);
}

async function versionOutput(bin, args) {
  if (!existsSync(bin)) return null;
  try {
    const { stdout, stderr } = await execa(bin, args, { timeout: 15_000 });
    return (stdout || stderr || '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Install the pinned chisel release unless it is already installed.
 *
 * @returns {Promise<{ changed: boolean, version: string, previous: string | null }>}
 */
export async function installPinnedChisel() {
  const previous = await versionOutput(CHISEL_BIN, ['--version']);
  if (isPinnedChiselVersion(previous)) {
    return { changed: false, version: CHISEL_RELEASE.version, previous };
  }
  const work = await mkdtemp(join(tmpdir(), 'lamaste-chisel-'));
  try {
    const bin = join(work, 'chisel');
    await downloadVerifiedChisel(
      archFor(CHISEL_ARCH, 'chisel'),
      join(work, 'chisel.gz'),
      bin,
      fetchToFile,
    );
    await installExecutable(bin, CHISEL_BIN);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const installed = await versionOutput(CHISEL_BIN, ['--version']);
  if (!isPinnedChiselVersion(installed)) {
    throw new Error(
      `chisel was installed but reports ${installed ?? 'nothing'}, expected ${CHISEL_RELEASE.version}`,
    );
  }
  return { changed: true, version: CHISEL_RELEASE.version, previous };
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Install the pinned Authelia release unless it (or a newer release) is
 * already installed. A newer Authelia is kept: its database may already use
 * a schema the pinned release cannot read, and Authelia refuses to start on
 * a database newer than itself.
 *
 * @returns {Promise<{ changed: boolean, version: string, previous: string | null, keptNewer: boolean }>}
 */
export async function installPinnedAuthelia() {
  const previousOutput = await versionOutput(AUTHELIA_BIN, ['--version']);
  const previous = previousOutput ? normaliseAutheliaVersion(previousOutput) : null;
  if (previous !== null && compareVersions(previous, AUTHELIA_RELEASE.version) >= 0) {
    return {
      changed: false,
      version: previous,
      previous,
      keptNewer: previous !== AUTHELIA_RELEASE.version,
    };
  }
  const work = await mkdtemp(join(tmpdir(), 'lamaste-authelia-'));
  try {
    const tgz = join(work, 'authelia.tar.gz');
    await downloadVerifiedAuthelia(archFor(AUTHELIA_ARCH, 'Authelia'), tgz, fetchToFile);
    // The tarball holds the binary at its top level, named `authelia`, next
    // to upstream packaging files (units, sysusers, a config template).
    await execa('tar', ['-xzf', tgz, '-C', work, '--no-same-owner', 'authelia']);
    await installExecutable(join(work, 'authelia'), AUTHELIA_BIN);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const installedOutput = await versionOutput(AUTHELIA_BIN, ['--version']);
  const installed = installedOutput ? normaliseAutheliaVersion(installedOutput) : null;
  if (installed !== AUTHELIA_RELEASE.version) {
    throw new Error(
      `Authelia was installed but reports ${installed ?? 'nothing'}, expected ${AUTHELIA_RELEASE.version}`,
    );
  }
  return { changed: true, version: AUTHELIA_RELEASE.version, previous, keptNewer: false };
}
