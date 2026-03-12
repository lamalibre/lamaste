import { readFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';

const PKI_DIR = process.env.PORTLAMA_PKI_DIR || '/etc/portlama/pki';

function revocationPath() {
  return path.join(PKI_DIR, 'revoked.json');
}

/**
 * Load the full revocation list from revoked.json.
 * Returns the array of revocation entries.
 * Returns an empty array if the file does not exist.
 */
async function loadRevocationEntries() {
  try {
    const raw = await readFile(revocationPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.revoked)) {
      return [];
    }
    return parsed.revoked;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read revocation list: ${err.message}`);
  }
}

/**
 * Load the revocation list and return a Set of revoked serial numbers.
 *
 * @returns {Promise<Set<string>>} Set of revoked certificate serial numbers.
 */
export async function loadRevocationList() {
  const entries = await loadRevocationEntries();
  return new Set(entries.map((e) => e.serial));
}

/**
 * Write the revocation entries to revoked.json atomically.
 *
 * 1. Write to a temp file in the same directory.
 * 2. fsync the temp file.
 * 3. Rename temp -> revoked.json (atomic on POSIX).
 */
async function writeRevocationEntries(entries) {
  const filePath = revocationPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify({ revoked: entries }, null, 2) + '\n';
  await writeFile(tmpPath, content, 'utf-8');

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}

/**
 * Add a certificate serial to the revocation list.
 * Atomic read -> add -> write tmp -> rename.
 *
 * @param {string} serial - The certificate serial number to revoke.
 * @param {string} label - A human-readable label for the revoked certificate.
 */
export async function addToRevocationList(serial, label) {
  const entries = await loadRevocationEntries();

  // Avoid duplicate entries
  if (entries.some((e) => e.serial === serial)) {
    return;
  }

  entries.push({
    serial,
    label,
    revokedAt: new Date().toISOString(),
  });

  await writeRevocationEntries(entries);
}

/**
 * Remove a certificate serial from the revocation list.
 *
 * @param {string} serial - The certificate serial number to un-revoke.
 */
export async function removeFromRevocationList(serial) {
  const entries = await loadRevocationEntries();
  const filtered = entries.filter((e) => e.serial !== serial);

  if (filtered.length === entries.length) {
    // Serial was not in the list — nothing to do
    return;
  }

  await writeRevocationEntries(filtered);
}

/**
 * Check if a certificate serial is in the revocation list.
 *
 * @param {string} serial - The certificate serial number to check.
 * @returns {Promise<boolean>} True if the serial is revoked.
 */
export async function isRevoked(serial) {
  const revokedSet = await loadRevocationList();
  return revokedSet.has(serial);
}
