import { execa } from 'execa';
import { access, constants, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CHISEL_BIN_PATH, CHISEL_BIN_DIR, detectArch } from '@lamalibre/lamaste/agent';

const GITHUB_API = 'https://api.github.com/repos/jpillora/chisel/releases/latest';

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the currently installed Chisel version, or null if not installed.
 */
export async function getInstalledVersion() {
  try {
    const { stdout } = await execa(CHISEL_BIN_PATH, ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Download and install the Chisel binary from GitHub releases.
 * Installs to ~/.lamalibre/lamaste/bin/chisel — no sudo needed.
 * @returns {Promise<{ skipped?: boolean, installed?: boolean, version: string }>}
 */
export async function installChisel() {
  const exists = await fileExists(CHISEL_BIN_PATH);
  if (exists) {
    const version = await getInstalledVersion();
    if (version) {
      return { skipped: true, version };
    }
  }

  // Fetch latest release info
  let releaseInfo;
  try {
    const { stdout } = await execa('curl', [
      '-s',
      '-L',
      '-H',
      'Accept: application/vnd.github+json',
      GITHUB_API,
    ]);
    releaseInfo = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to fetch Chisel release info from GitHub: ${err.message}. Check internet connectivity.`,
    );
  }

  if (releaseInfo.message && releaseInfo.message.includes('rate limit')) {
    throw new Error(
      'GitHub API rate limit exceeded. Please try again later or set a GITHUB_TOKEN environment variable.',
    );
  }

  // Find the correct asset for this platform
  const archSuffix = detectArch();
  const asset = releaseInfo.assets?.find(
    (a) => a.name.includes(archSuffix) && a.name.endsWith('.gz'),
  );

  if (!asset) {
    throw new Error(
      `Could not find ${archSuffix} asset in the latest Chisel release. Available assets: ` +
        (releaseInfo.assets?.map((a) => a.name).join(', ') || 'none'),
    );
  }

  const downloadUrl = asset.browser_download_url;
  // Namespaced to keep agent-side temp files distinguishable from any other
  // tool's `chisel-*` temp files. The agent installs into a user-controlled
  // directory (no sudoers involved here), so this is consistency hygiene
  // rather than a security boundary.
  const tmpGz = path.join(
    tmpdir(),
    `lamalibre-lamaste-chisel-${crypto.randomBytes(4).toString('hex')}.gz`,
  );
  const tmpBin = tmpGz.replace('.gz', '');

  try {
    await execa('curl', ['-L', '-o', tmpGz, downloadUrl]);
  } catch (err) {
    throw new Error(`Failed to download Chisel from ${downloadUrl}: ${err.stderr || err.message}`);
  }

  try {
    await mkdir(CHISEL_BIN_DIR, { recursive: true });
    await execa('gunzip', ['-f', tmpGz]);
    await execa('mv', [tmpBin, CHISEL_BIN_PATH]);
    await execa('chmod', ['+x', CHISEL_BIN_PATH]);
  } catch (err) {
    throw new Error(`Failed to install Chisel binary: ${err.stderr || err.message}`);
  } finally {
    await execa('rm', ['-f', tmpGz, tmpBin]).catch(() => {});
  }

  const version = await getInstalledVersion();
  if (!version) {
    throw new Error('Chisel was installed but version check failed. The binary may be corrupted.');
  }

  return { installed: true, version };
}
