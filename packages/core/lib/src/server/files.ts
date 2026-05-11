/**
 * Static site filesystem helpers.
 *
 * Path validation + sudo-mediated file operations under /var/www/lamaste/<siteId>.
 * Pure-ish: shells out via an injected `exec` function; no global state.
 */

import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { writeFile as fsWriteFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Exec abstraction
// ---------------------------------------------------------------------------

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecError extends Error {
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface ExecFn {
  (file: string, args: string[]): Promise<ExecResult>;
}

function isExecError(err: unknown): err is ExecError {
  return err instanceof Error;
}

function errText(err: unknown): string {
  if (!isExecError(err)) return String(err);
  return err.stderr || err.message;
}

// ---------------------------------------------------------------------------
// Site layout
// ---------------------------------------------------------------------------

export const SITES_ROOT = '/var/www/lamaste';

/**
 * Get the absolute root path for a site.
 */
export function getSiteRoot(siteId: string): string {
  return path.join(SITES_ROOT, siteId);
}

// ---------------------------------------------------------------------------
// Extension allowlist
// ---------------------------------------------------------------------------

/**
 * Set of file extensions allowed for static site uploads.
 * Allowlist approach — unknown extensions are blocked by default.
 */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
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
 * Validate that a filename has an allowed extension for static site uploads.
 * Throws with a descriptive message if the extension is not in the allowlist.
 */
export function validateFileExtension(filename: string): void {
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
 * Throws on invalid paths. Returns the normalized path on success.
 */
export function validatePath(relativePath: string): string {
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

// ---------------------------------------------------------------------------
// Site directory lifecycle
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Create the site directory with a default index.html, owned by www-data.
 */
export async function createSiteDirectory(
  siteId: string,
  siteName: string,
  exec: ExecFn,
): Promise<void> {
  const siteRoot = getSiteRoot(siteId);

  await exec('sudo', ['mkdir', '-p', siteRoot]);

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
  await exec('sudo', ['mv', tmpFile, path.join(siteRoot, 'index.html')]);
  await exec('sudo', ['chown', '-R', 'www-data:www-data', siteRoot]);
  await exec('sudo', ['chmod', '-R', '755', siteRoot]);
}

/**
 * Remove a site directory. Rejects siteIds that would escape the sites root.
 */
export async function removeSiteDirectory(siteId: string, exec: ExecFn): Promise<void> {
  const siteRoot = getSiteRoot(siteId);

  if (!siteRoot.startsWith(SITES_ROOT + '/') || siteId.includes('/') || siteId.includes('..')) {
    throw new Error(`Invalid site ID: ${siteId}`);
  }

  await exec('sudo', ['rm', '-rf', siteRoot]);
}

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

export interface SiteListEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly size: number;
  readonly modifiedAt: string;
  readonly relativePath: string;
}

/**
 * List files and directories at a path within a site.
 */
export async function listFiles(
  siteId: string,
  relativePath: string = '.',
  exec: ExecFn,
): Promise<SiteListEntry[]> {
  const siteRoot = getSiteRoot(siteId);
  const cleanPath = relativePath === '.' ? '.' : validatePath(relativePath);
  const targetDir = cleanPath === '.' ? siteRoot : path.join(siteRoot, cleanPath);

  if (targetDir !== siteRoot && !targetDir.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  try {
    const { stdout } = await exec('sudo', [
      'find',
      targetDir,
      '-maxdepth',
      '1',
      '-mindepth',
      '1',
      '-printf',
      '%f\\t%y\\t%s\\t%T@\\n',
    ]);

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .map((line): SiteListEntry => {
        const [name = '', type = '', sizeStr = '0', mtime = '0'] = line.split('\t');
        const entryRelPath = cleanPath === '.' ? name : path.join(cleanPath, name);
        return {
          name,
          type: type === 'd' ? 'directory' : 'file',
          size: parseInt(sizeStr, 10) || 0,
          modifiedAt: new Date(parseFloat(mtime) * 1000).toISOString(),
          relativePath: entryRelPath,
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch (err: unknown) {
    if (isExecError(err) && err.stderr?.includes('No such file or directory')) {
      throw new Error(`Directory not found: ${cleanPath}`);
    }
    throw new Error(`Failed to list files: ${errText(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Upload / delete
// ---------------------------------------------------------------------------

/**
 * Save an uploaded file to a site directory using streaming
 * (memory-safe for small droplets).
 */
export async function saveUploadedFile(
  siteId: string,
  relativePath: string,
  fileStream: Readable,
  exec: ExecFn,
): Promise<void> {
  const cleanPath = validatePath(relativePath);
  const siteRoot = getSiteRoot(siteId);
  const destPath = path.join(siteRoot, cleanPath);

  if (!destPath.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  const parentDir = path.dirname(destPath);
  await exec('sudo', ['mkdir', '-p', parentDir]);

  const tmpFile = path.join(tmpdir(), `site-upload-${crypto.randomBytes(8).toString('hex')}`);

  try {
    const writeStream = createWriteStream(tmpFile);
    await pipeline(fileStream, writeStream);

    await exec('sudo', ['mv', tmpFile, destPath]);
    await exec('sudo', ['chown', 'www-data:www-data', destPath]);
    await exec('sudo', ['chmod', '644', destPath]);

    // Restore parent directory ownership
    await exec('sudo', ['chown', '-R', 'www-data:www-data', siteRoot]);
  } catch (err: unknown) {
    try {
      await unlink(tmpFile);
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to save file: ${message}`);
  }
}

/**
 * Delete a file or directory within a site.
 */
export async function deleteFile(
  siteId: string,
  relativePath: string,
  exec: ExecFn,
): Promise<void> {
  const cleanPath = validatePath(relativePath);
  const siteRoot = getSiteRoot(siteId);
  const targetPath = path.join(siteRoot, cleanPath);

  if (!targetPath.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  await exec('sudo', ['rm', '-rf', targetPath]);
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/**
 * Get the total size of a site directory in bytes.
 */
export async function getSiteSize(siteId: string, exec: ExecFn): Promise<number> {
  const siteRoot = getSiteRoot(siteId);

  try {
    const { stdout } = await exec('sudo', ['du', '-sb', siteRoot]);
    const first = stdout.split('\t')[0] ?? '0';
    const size = parseInt(first, 10);
    return isNaN(size) ? 0 : size;
  } catch (err: unknown) {
    if (isExecError(err) && err.stderr?.includes('No such file or directory')) {
      return 0;
    }
    throw new Error(`Failed to get site size: ${errText(err)}`);
  }
}
