import crypto from 'node:crypto';
import { writeFile, unlink, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { LAMASTE_DIR } from '@lamalibre/lamaste/agent';

const AGENT_DIR = LAMASTE_DIR;

/**
 * Overwrite a file with random bytes, then unlink it.
 * Provides defense-in-depth against key recovery from disk.
 *
 * @param {string} filePath - Path to the file to securely delete
 */
export async function secureDelete(filePath) {
  try {
    const { size } = await stat(filePath);
    const randomData = crypto.randomBytes(Math.min(size, 16384));
    await writeFile(filePath, randomData);
    await unlink(filePath);
  } catch {
    // Best effort — if stat/write fails, still try to unlink
    await unlink(filePath).catch(() => {});
  }
}

/**
 * Generate a 4096-bit RSA keypair and CSR for agent enrollment.
 *
 * The private key is written to a temporary file in ~/.lamalibre/lamaste/ with
 * mode 0600. The CSR is generated with the agent-scoped subject
 * /CN=agent:<label>/O=Lamaste. For delegated (plugin-agent) enrollments
 * the caller passes the full label including the `plugin-agent:` prefix
 * (which is then used directly without re-prefixing with `agent:`).
 *
 * The CSR's CN must match the label embedded in the panel-side enrollment
 * token exactly — the panel verifies this before signing because the
 * signing wrapper (B9 hardening) does not override the subject.
 *
 * @param {string} label - Agent label as returned by /api/enroll/lookup
 *                         (either `<simple-label>` or `plugin-agent:<a>:<b>`)
 * @returns {Promise<{ keyPath: string, csrPem: string }>}
 */
export async function generateKeypairAndCSR(label) {
  const suffix = crypto.randomBytes(8).toString('hex');
  const keyPath = path.join(AGENT_DIR, `.tmp-key-${suffix}.pem`);
  const csrPath = path.join(AGENT_DIR, `.tmp-csr-${suffix}.pem`);

  // Plugin-agent labels already encode their own scheme; regular agent
  // labels need the `agent:` prefix to match what the panel expects.
  const cn = label.startsWith('plugin-agent:') ? label : `agent:${label}`;

  try {
    // Generate 4096-bit RSA key
    await execa('openssl', ['genrsa', '-out', keyPath, '4096']);

    // Set restrictive permissions
    await execa('chmod', ['600', keyPath]);

    // Create CSR with agent-scoped subject
    await execa('openssl', [
      'req',
      '-new',
      '-key',
      keyPath,
      '-out',
      csrPath,
      '-subj',
      `/CN=${cn}/O=Lamaste`,
    ]);

    const csrPem = await readFile(csrPath, 'utf-8');

    return { keyPath, csrPem };
  } catch (err) {
    // Clean up on failure
    await secureDelete(keyPath);
    throw new Error(`Failed to generate keypair and CSR: ${err.stderr || err.message}`);
  } finally {
    // Always clean up the CSR temp file (the key is needed by the caller)
    await unlink(csrPath).catch(() => {});
  }
}

