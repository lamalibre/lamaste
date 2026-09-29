/**
 * Agent certificate signing with the panel CA.
 *
 * The panel is the CA: the lamaste user owns the PKI directory and the CA key
 * (plugins that issue their own certificates get the key's path too — see
 * plugin-router.js). Signing therefore needs no privileges and runs as the
 * panel itself.
 *
 * The certificate's subject is taken from the CSR as is, and no CSR
 * extension is copied. Callers verify the exact CN they expect before
 * signing; `signAgentCsr` re-checks its shape as a last line — only agent and
 * plugin-agent labels, never `admin` (admin certificates come from
 * `lamaste-server reset-admin` alone).
 */

import crypto from 'node:crypto';
import { execa } from 'execa';

const PKI_DIR = process.env.LAMALIBRE_LAMASTE_PKI_DIR || '/etc/lamalibre/lamaste/pki';

const LABEL = '[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?';
const AGENT_CN_RE = new RegExp(`^(?:agent|plugin-agent):${LABEL}(?::${LABEL})?$`);

/**
 * A 16-byte (128-bit) random serial as lower-case hex with no leading zero,
 * so it stays a positive integer when openssl reads it as `0x<serial>`.
 *
 * @returns {string}
 */
export function randomCertSerial() {
  let hex = crypto.randomBytes(16).toString('hex').replace(/^0+/, '');
  if (hex.length === 0) hex = '1';
  return hex;
}

/**
 * Extract the CN from a CSR's subject. Returns the CN string or null.
 *
 * @param {string} csrPath
 * @returns {Promise<string | null>}
 */
export async function readCsrCN(csrPath) {
  try {
    const { stdout } = await execa('openssl', [
      'req',
      '-in',
      csrPath,
      '-noout',
      '-subject',
      '-nameopt',
      'RFC2253',
    ]);
    // Output: "subject=CN=agent:foo,O=Lamaste". RFC2253 form is
    // comma-separated; the agent label charset has no commas to escape.
    const subject = stdout.trim().replace(/^subject=\s*/, '');
    for (const part of subject.split(',')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('CN=')) {
        return trimmed.slice(3);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sign the CSR at `csrPath` with the panel CA, writing the certificate to
 * `certPath`.
 *
 * @param {string} csrPath
 * @param {string} certPath
 * @param {string} serial - lower-case hex, see randomCertSerial()
 * @param {number} days
 */
export async function signAgentCsr(csrPath, certPath, serial, days) {
  const cn = await readCsrCN(csrPath);
  if (!cn || !AGENT_CN_RE.test(cn)) {
    throw Object.assign(new Error(`Refusing to sign a CSR with CN ${cn ?? '(none)'}`), {
      statusCode: 400,
    });
  }
  if (!/^[0-9a-f]{1,32}$/.test(serial)) throw new Error('Invalid certificate serial');
  if (!Number.isInteger(days) || days < 1 || days > 7300) throw new Error('Invalid validity');
  await execa('openssl', [
    'x509',
    '-req',
    '-in',
    csrPath,
    '-CA',
    `${PKI_DIR}/ca.crt`,
    '-CAkey',
    `${PKI_DIR}/ca.key`,
    '-days',
    String(days),
    '-set_serial',
    `0x${serial}`,
    '-sha256',
    '-out',
    certPath,
  ]);
}
