import { execa } from 'execa';
import { writeFile as fsWriteFile, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SITES_ROOT = '/var/www/portlama';

/**
 * Set of file extensions allowed for static site uploads.
 * Allowlist approach — unknown extensions are blocked by default.
 */
export const ALLOWED_EXTENSIONS = new Set([
  // HTML
  '.html', '.htm',
  // Styles
  '.css',
  // Scripts
  '.js', '.mjs',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif', '.bmp',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Media
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.flac',
  // Documents
  '.pdf', '.txt', '.md',
  // Data
  '.json', '.xml', '.csv', '.geojson', '.topojson',
  // Maps
  '.map',
  // Web config
  '.webmanifest', '.manifest',
  // WebAssembly
  '.wasm',
]);

/**
 * Validate that a filename has an allowed extension for static site uploads.
 * Throws with a descriptive message if the extension is not in the allowlist.
 *
 * @param {string} filename - The filename to validate
 */
export function validateFileExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) {
    throw new Error(`File '${filename}' has no extension and is not allowed`);
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File '${filename}' has disallowed extension '${ext}'`);
  }
}

/**
 * Validate a relative path to prevent directory traversal and injection attacks.
 * Throws on invalid paths.
 *
 * @param {string} relativePath - Path relative to the site root
 * @returns {string} The cleaned relative path
 */
export function validatePath(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('Path is required');
  }

  // Reject null bytes
  if (relativePath.includes('\0')) {
    throw new Error('Path contains null bytes');
  }

  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute paths are not allowed');
  }

  // Normalize and check for traversal
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
    throw new Error('Path traversal is not allowed');
  }

  // Reject hidden files/directories (starting with .)
  const parts = normalized.split(path.sep);
  for (const part of parts) {
    if (part.startsWith('.') && part !== '.') {
      throw new Error('Hidden files/directories are not allowed');
    }
  }

  return normalized;
}

/**
 * Get the absolute root path for a site.
 *
 * @param {string} siteId - Site UUID
 * @returns {string}
 */
export function getSiteRoot(siteId) {
  return path.join(SITES_ROOT, siteId);
}

/**
 * Create the site directory with a default index.html, owned by www-data.
 *
 * @param {string} siteId - Site UUID
 * @param {string} siteName - Human-readable site name
 */
export async function createSiteDirectory(siteId, siteName) {
  const siteRoot = getSiteRoot(siteId);

  await execa('sudo', ['mkdir', '-p', siteRoot]);

  // Write a default index.html via temp file
  const defaultHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(siteName)}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #18181b; color: #a1a1aa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; }
    h1 { color: #22d3ee; font-size: 2rem; margin-bottom: 0.5rem; }
    p { color: #71717a; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(siteName)}</h1>
    <p>Upload your files to get started.</p>
  </div>
</body>
</html>
`;

  const tmpFile = path.join(tmpdir(), `site-index-${crypto.randomBytes(4).toString('hex')}.html`);
  await fsWriteFile(tmpFile, defaultHtml, 'utf-8');
  await execa('sudo', ['mv', tmpFile, path.join(siteRoot, 'index.html')]);
  await execa('sudo', ['chown', '-R', 'www-data:www-data', siteRoot]);
  await execa('sudo', ['chmod', '-R', '755', siteRoot]);
}

/**
 * Remove the site directory.
 *
 * @param {string} siteId - Site UUID
 */
export async function removeSiteDirectory(siteId) {
  const siteRoot = getSiteRoot(siteId);

  // Safety check: ensure path is under SITES_ROOT
  if (!siteRoot.startsWith(SITES_ROOT + '/') || siteId.includes('/') || siteId.includes('..')) {
    throw new Error(`Invalid site ID: ${siteId}`);
  }

  await execa('sudo', ['rm', '-rf', siteRoot]);
}

/**
 * List files and directories at a path within a site.
 *
 * @param {string} siteId - Site UUID
 * @param {string} [relativePath='.'] - Relative path within the site
 * @returns {Promise<Array<{ name: string, type: 'file'|'directory', size: number, modifiedAt: string, relativePath: string }>>}
 */
export async function listFiles(siteId, relativePath = '.') {
  const siteRoot = getSiteRoot(siteId);
  const cleanPath = relativePath === '.' ? '.' : validatePath(relativePath);
  const targetDir = cleanPath === '.' ? siteRoot : path.join(siteRoot, cleanPath);

  // Safety: ensure resolved path is still under site root
  if (targetDir !== siteRoot && !targetDir.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  try {
    // Use sudo find with maxdepth 1 to list immediate children
    const { stdout } = await execa('sudo', [
      'find', targetDir, '-maxdepth', '1', '-mindepth', '1',
      '-printf', '%f\\t%y\\t%s\\t%T@\\n',
    ]);

    if (!stdout.trim()) {
      return [];
    }

    return stdout.trim().split('\n').map((line) => {
      const [name, type, size, mtime] = line.split('\t');
      const entryRelPath = cleanPath === '.' ? name : path.join(cleanPath, name);
      return {
        name,
        type: type === 'd' ? 'directory' : 'file',
        size: parseInt(size, 10),
        modifiedAt: new Date(parseFloat(mtime) * 1000).toISOString(),
        relativePath: entryRelPath,
      };
    }).sort((a, b) => {
      // Directories first, then alphabetical
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    if (err.stderr?.includes('No such file or directory')) {
      throw new Error(`Directory not found: ${cleanPath}`);
    }
    throw new Error(`Failed to list files: ${err.stderr || err.message}`);
  }
}

/**
 * Save an uploaded file to a site directory using streaming (memory-safe for 512MB droplets).
 *
 * @param {string} siteId - Site UUID
 * @param {string} relativePath - Destination relative path (including filename)
 * @param {import('stream').Readable} fileStream - Readable stream of file data
 */
export async function saveUploadedFile(siteId, relativePath, fileStream) {
  const cleanPath = validatePath(relativePath);
  const siteRoot = getSiteRoot(siteId);
  const destPath = path.join(siteRoot, cleanPath);

  // Safety: ensure resolved path is still under site root
  if (!destPath.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(destPath);
  await execa('sudo', ['mkdir', '-p', parentDir]);

  // Stream to a temp file first, then sudo mv to destination
  const tmpFile = path.join(tmpdir(), `site-upload-${crypto.randomBytes(8).toString('hex')}`);

  try {
    const writeStream = createWriteStream(tmpFile);
    await pipeline(fileStream, writeStream);

    await execa('sudo', ['mv', tmpFile, destPath]);
    await execa('sudo', ['chown', 'www-data:www-data', destPath]);
    await execa('sudo', ['chmod', '644', destPath]);

    // Restore parent directory ownership
    await execa('sudo', ['chown', '-R', 'www-data:www-data', siteRoot]);
  } catch (err) {
    // Clean up temp file on failure
    try { await unlink(tmpFile); } catch { /* ignore */ }
    throw new Error(`Failed to save file: ${err.message}`);
  }
}

/**
 * Delete a file or directory within a site.
 *
 * @param {string} siteId - Site UUID
 * @param {string} relativePath - Relative path to delete
 */
export async function deleteFile(siteId, relativePath) {
  const cleanPath = validatePath(relativePath);
  const siteRoot = getSiteRoot(siteId);
  const targetPath = path.join(siteRoot, cleanPath);

  // Safety: ensure still under site root after resolution
  if (!targetPath.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  await execa('sudo', ['rm', '-rf', targetPath]);
}

/**
 * Get the total size of a site directory in bytes.
 *
 * @param {string} siteId - Site UUID
 * @returns {Promise<number>} Size in bytes
 */
export async function getSiteSize(siteId) {
  const siteRoot = getSiteRoot(siteId);

  try {
    const { stdout } = await execa('sudo', ['du', '-sb', siteRoot]);
    const size = parseInt(stdout.split('\t')[0], 10);
    return isNaN(size) ? 0 : size;
  } catch (err) {
    if (err.stderr?.includes('No such file or directory')) {
      return 0;
    }
    throw new Error(`Failed to get site size: ${err.stderr || err.message}`);
  }
}

/**
 * Escape HTML entities to prevent XSS in generated HTML.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
