import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CHISEL_BIN_PATH, LOG_FILE, ERROR_LOG_FILE, PLIST_PATH } from './platform.js';

/**
 * Rewrite server-generated plist XML to use user-scoped paths.
 *
 * Replaces:
 *   /usr/local/bin/chisel → ~/.portlama/bin/chisel
 *   /usr/local/var/log/chisel.log → ~/.portlama/logs/chisel.log
 *   /usr/local/var/log/chisel.error.log → ~/.portlama/logs/chisel.error.log
 *
 * @param {string} xml - Original plist XML from the panel
 * @returns {string} Rewritten plist XML
 */
export function rewritePlist(xml) {
  let result = xml;
  result = result.replace(
    /\/usr\/local\/bin\/chisel/g,
    CHISEL_BIN_PATH,
  );
  result = result.replace(
    /\/usr\/local\/var\/log\/chisel\.log/g,
    LOG_FILE,
  );
  result = result.replace(
    /\/usr\/local\/var\/log\/chisel\.error\.log/g,
    ERROR_LOG_FILE,
  );
  return result;
}

/**
 * Write the plist file to ~/Library/LaunchAgents/ atomically.
 * @param {string} xml - Plist XML content (already rewritten)
 */
export async function writePlistFile(xml) {
  const dir = path.dirname(PLIST_PATH);
  await mkdir(dir, { recursive: true });
  const tmp = PLIST_PATH + '.tmp';
  await writeFile(tmp, xml, 'utf8');
  await rename(tmp, PLIST_PATH);
}
