import { execa } from 'execa';
import crypto from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { AUTHELIA_CONFIG_DIR, AUTHELIA_OIDC_KEY_PATH } from './service-config.js';
import { setFileOwnership } from './ownership.js';

/**
 * The RSA key Authelia signs OpenID Connect tokens with.
 *
 * Generated here — by create-lamaste, on a fresh install and on every
 * redeploy that finds it missing — rather than by the panel, so the panel
 * never holds the key that mints identities: the file is 0600 and owned by
 * the Authelia account, which is the only process that reads it. Authelia's
 * configuration references it with a `{{ secret "…" }}` template expression
 * (its unit sets `X_AUTHELIA_CONFIG_FILTERS=template`).
 *
 * `/etc/authelia` belongs to the lamaste user (the panel writes Authelia's
 * configuration there), so root never writes through that path: the key is
 * generated in this process and handed to a child running as the Authelia
 * account, which creates the file (`wx`, 0600) and renames it into place.
 * A symlink the panel could plant at the key's name is replaced by the
 * rename, never followed.
 */

const RSA_MODULUS_BITS = 4096;

/**
 * Child-side writer: content on stdin, destination as the last argument.
 * Runs as the Authelia user with its own umask; the file is created with
 * `wx` so an existing file is never truncated or followed.
 */
export const PRIVATE_FILE_WRITER = `
const fs = require('node:fs');
const dest = process.argv[process.argv.length - 1];
const content = fs.readFileSync(0, 'utf8');
if (!content.includes('PRIVATE KEY')) { process.stderr.write('not a private key\\n'); process.exit(3); }
const tmp = dest + '.' + process.pid + '.tmp';
const fd = fs.openSync(tmp, 'wx', 0o600);
try {
  fs.writeFileSync(fd, content);
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
fs.renameSync(tmp, dest);
`;

/** A fresh RSA-4096 private key as PKCS#8 PEM. */
export function generateIssuerKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: RSA_MODULUS_BITS });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/**
 * Write `pem` to `dest` as `uid:gid` 0600 through a child process running
 * as that account. Root touches nothing under the destination's directory.
 *
 * @param {string} dest
 * @param {string} pem
 * @param {{ uid: number, gid: number }} ids
 */
export async function writePrivateKeyAs(dest, pem, { uid, gid }) {
  await execa(process.execPath, ['-e', PRIVATE_FILE_WRITER, dest], {
    uid,
    gid,
    input: pem,
    cwd: '/',
    env: { PATH: '/usr/bin:/bin' },
    extendEnv: false,
    timeout: 30_000,
  });
}

/**
 * Make sure the issuer key exists as `autheliaUid:autheliaGid` 0600.
 *
 * - Missing: generate and write it.
 * - A regular file owned by the Authelia account: fix the mode through a
 *   descriptor if it drifted; keep the key (tokens stay valid).
 * - Anything else (another owner, a symlink): replace it — a key the panel
 *   wrote is a key the panel knows.
 *
 * @param {{ autheliaUid: number, autheliaGid: number, dir?: string, report?: (line: string) => void }} options
 * @returns {Promise<{ generated: boolean, path: string }>}
 */
export async function ensureOidcIssuerKey({
  autheliaUid,
  autheliaGid,
  dir = AUTHELIA_CONFIG_DIR,
  report = () => {},
}) {
  const keyPath =
    dir === AUTHELIA_CONFIG_DIR ? AUTHELIA_OIDC_KEY_PATH : join(dir, 'oidc-issuer.pem');

  let st = null;
  try {
    st = await lstat(keyPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (st && st.isFile() && st.uid === autheliaUid) {
    if (st.gid !== autheliaGid || (st.mode & 0o7777) !== 0o600) {
      report('Fixing the ownership of the OIDC issuer key...');
      await setFileOwnership(keyPath, { uid: autheliaUid, gid: autheliaGid, mode: 0o600 });
    }
    return { generated: false, path: keyPath };
  }

  report(
    st
      ? 'Replacing the OIDC issuer key (not owned by the Authelia account)...'
      : 'Generating the OIDC issuer key (RSA 4096)...',
  );
  const pem = generateIssuerKeyPem();
  await writePrivateKeyAs(keyPath, pem, { uid: autheliaUid, gid: autheliaGid });

  const after = await lstat(keyPath);
  if (!after.isFile() || after.uid !== autheliaUid || (after.mode & 0o7777) !== 0o600) {
    throw new Error(`${keyPath} was not written as the Authelia account with mode 0600`);
  }
  return { generated: true, path: keyPath };
}
