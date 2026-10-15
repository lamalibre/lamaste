import { execa } from 'execa';
import { unlink } from 'node:fs/promises';

/** The Node.js line the relay runs, from NodeSource. */
export const NODE_MAJOR = 22;

/**
 * The oldest Node.js the relay accepts: 22.5 brought `node:sqlite`
 * (lamaste-serverd's state database) and 22.13 the stable permission model
 * (`--permission`), which sandboxes the relay hook runner. NodeSource's 22.x
 * line moves on its own, so the minor is checked, not only the major.
 */
export const MIN_NODE_VERSION = '22.13.0';

/**
 * lamaste-serverd's `engines` stops below 25: Node 25 adds network
 * permissions to `--permission`, which the hook runner's unit does not grant.
 */
export const MAX_NODE_MAJOR_EXCLUSIVE = 25;

/** The binary every Lamaste unit runs (`ExecStart=/usr/bin/node …`). */
export const NODE_BIN = '/usr/bin/node';

/** `v22.13.1` → [22, 13, 1]; null when it is not a version. */
function parseNodeVersion(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `version` is at least {@link MIN_NODE_VERSION} and below {@link MAX_NODE_MAJOR_EXCLUSIVE}. */
export function nodeVersionSupported(version) {
  const v = parseNodeVersion(version);
  const min = parseNodeVersion(MIN_NODE_VERSION);
  if (!v || !min) return false;
  if (v[0] >= MAX_NODE_MAJOR_EXCLUSIVE) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

/** Whether `version` is too new to be installed over (only an operator should downgrade). */
export function nodeVersionTooNew(version) {
  const v = parseNodeVersion(version);
  return v !== null && v[0] >= MAX_NODE_MAJOR_EXCLUSIVE;
}

/** The refusal of a {@link nodeVersionTooNew} Node.js. */
export function nodeTooNewError(version) {
  return new Error(
    `Node.js ${version} at ${NODE_BIN} is not supported: Lamaste needs ${MIN_NODE_VERSION} or later, below ${MAX_NODE_MAJOR_EXCLUSIVE}.`,
  );
}

/** The version of {@link NODE_BIN}, or null when it is missing. */
export async function installedNodeVersion() {
  try {
    const { stdout } = await execa(NODE_BIN, ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Install or upgrade Node.js from NodeSource's {@link NODE_MAJOR}.x line.
 *
 * @param {(line: string) => void} report
 */
export async function installNodeFromNodeSource(report) {
  const setupScript = '/tmp/nodesource_setup.sh';
  report('Downloading the NodeSource setup script...');
  try {
    await execa('curl', [
      '-fsSL',
      `https://deb.nodesource.com/setup_${NODE_MAJOR}.x`,
      '-o',
      setupScript,
    ]);
  } catch (error) {
    throw new Error(
      `Failed to download the NodeSource setup script. Check your internet connection.\n${error.stderr || error.message}`,
    );
  }
  report('Running the NodeSource setup...');
  try {
    await execa('bash', [setupScript]);
  } catch (error) {
    throw new Error(`NodeSource setup script failed.\n${error.stderr || error.message}`);
  } finally {
    await unlink(setupScript).catch(() => {});
  }
  report('Running apt-get install nodejs...');
  try {
    await execa('apt-get', ['install', '-y', 'nodejs']);
  } catch (error) {
    throw new Error(
      `Failed to install Node.js. Try running 'apt-get update' manually and retrying.\n${error.stderr || error.message}`,
    );
  }
}
