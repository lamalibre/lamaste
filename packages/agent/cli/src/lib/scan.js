import path from 'node:path';
import { execa } from 'execa';

/**
 * Set of file extensions allowed for static site deployment.
 * Allowlist approach — unknown extensions are blocked by default.
 */
export const ALLOWED_EXTENSIONS = new Set([
  // HTML
  '.html',
  '.htm',
  // Styles
  '.css',
  // Scripts
  '.js',
  '.mjs',
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.bmp',
  // Fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  // Media
  '.mp4',
  '.webm',
  '.ogg',
  '.mp3',
  '.wav',
  '.flac',
  // Documents
  '.pdf',
  '.txt',
  '.md',
  // Data
  '.json',
  '.xml',
  '.csv',
  '.geojson',
  '.topojson',
  // Maps
  '.map',
  // Web config
  '.webmanifest',
  '.manifest',
  // WebAssembly
  '.wasm',
]);

/**
 * Check each file's extension against the allowlist.
 * Files with no extension are blocked.
 *
 * @param {Array<{ relativePath: string }>} files
 * @returns {{ allowed: Array<{ relativePath: string }>, blocked: Array<{ relativePath: string }> }}
 */
export function filterBlockedFiles(files) {
  const allowed = [];
  const blocked = [];

  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase();
    if (ext && ALLOWED_EXTENSIONS.has(ext)) {
      allowed.push(file);
    } else {
      blocked.push(file);
    }
  }

  return { allowed, blocked };
}

/**
 * Run ClamAV malware scan via Docker.
 *
 * @param {string} directoryPath - Absolute path to the directory to scan
 * @returns {Promise<{ available: boolean, infected: Array<{ file: string, virus: string }> | null }>}
 */
export async function runClamAvScan(directoryPath) {
  // Check if Docker is available
  try {
    await execa('docker', ['info']);
  } catch {
    return { available: false, infected: null };
  }

  // Run ClamAV scan
  const result = await execa(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${directoryPath}:/scan:ro`,
      'clamav/clamav',
      'clamscan',
      '-r',
      '--infected',
      '--no-summary',
      '/scan',
    ],
    { reject: false },
  );

  if (result.exitCode === 0) {
    // Clean — no infections found
    return { available: true, infected: [] };
  }

  if (result.exitCode === 1) {
    // Infections found — parse output
    const infected = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
      const match = line.match(/^(.+):\s+(.+)\s+FOUND$/);
      if (match) {
        const filePath = match[1].replace(/^\/scan\//, '');
        infected.push({ file: filePath, virus: match[2] });
      }
    }
    return { available: true, infected };
  }

  // Exit code 2 — error in scanning
  throw new Error(`ClamAV scan failed: ${result.stderr || result.stdout}`);
}
