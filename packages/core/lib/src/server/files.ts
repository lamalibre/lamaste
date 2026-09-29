/**
 * Static site filesystem helpers.
 *
 * Path validation + file operations under /var/www/lamaste/<siteId>. The web
 * root belongs to the lamaste user with group www-data (create-lamaste sets
 * it up): directories are setgid 2750 so everything created inside inherits
 * the group, files are 0640 — nginx reads through the group, nobody else
 * can. No privileges are needed.
 */

import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** Directory and file modes inside the web root (see the module comment). */
const DIR_MODE = 0o750;
const FILE_MODE = 0o640;

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

/**
 * Write `content` to `destPath` atomically (temp file in the same directory,
 * fsync, rename) with the web root's file mode.
 */
async function writeSiteFile(destPath: string, content: string): Promise<void> {
  const tmp = path.join(path.dirname(destPath), `.upload-${crypto.randomBytes(8).toString('hex')}`);
  try {
    const fh = await open(tmp, 'wx', FILE_MODE);
    try {
      await fh.writeFile(content, 'utf-8');
      await fh.chmod(FILE_MODE);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, destPath);
  } catch (err: unknown) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
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
 * Create the site directory with a default index.html.
 */
export async function createSiteDirectory(siteId: string, siteName: string): Promise<void> {
  const siteRoot = getSiteRoot(siteId);

  await mkdir(siteRoot, { recursive: true, mode: DIR_MODE });

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

  await writeSiteFile(path.join(siteRoot, 'index.html'), defaultHtml);
}

/**
 * Remove a site directory. Rejects siteIds that would escape the sites root.
 */
export async function removeSiteDirectory(siteId: string): Promise<void> {
  const siteRoot = getSiteRoot(siteId);

  if (!siteRoot.startsWith(SITES_ROOT + '/') || siteId.includes('/') || siteId.includes('..')) {
    throw new Error(`Invalid site ID: ${siteId}`);
  }

  await rm(siteRoot, { recursive: true, force: true });
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
 * List files and directories at a path within a site. Symbolic links (which
 * the panel never creates) are not listed.
 */
export async function listFiles(
  siteId: string,
  relativePath: string = '.',
): Promise<SiteListEntry[]> {
  const siteRoot = getSiteRoot(siteId);
  const cleanPath = relativePath === '.' ? '.' : validatePath(relativePath);
  const targetDir = cleanPath === '.' ? siteRoot : path.join(siteRoot, cleanPath);

  if (targetDir !== siteRoot && !targetDir.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  let names: string[];
  try {
    names = await readdir(targetDir);
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT' || errnoCode(err) === 'ENOTDIR') {
      throw new Error(`Directory not found: ${cleanPath}`);
    }
    throw new Error(`Failed to list files: ${err instanceof Error ? err.message : String(err)}`);
  }

  const entries: SiteListEntry[] = [];
  for (const name of names) {
    let st;
    try {
      st = await lstat(path.join(targetDir, name));
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') continue; // removed while listing
      throw err;
    }
    if (!st.isFile() && !st.isDirectory()) continue;
    entries.push({
      name,
      type: st.isDirectory() ? 'directory' : 'file',
      size: st.size,
      modifiedAt: st.mtime.toISOString(),
      relativePath: cleanPath === '.' ? name : path.join(cleanPath, name),
    });
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Upload / delete
// ---------------------------------------------------------------------------

/**
 * Save an uploaded file to a site directory using streaming
 * (memory-safe for small droplets). The upload lands in a temporary file
 * next to its destination and replaces it atomically.
 */
export async function saveUploadedFile(
  siteId: string,
  relativePath: string,
  fileStream: Readable,
): Promise<void> {
  const cleanPath = validatePath(relativePath);
  const siteRoot = getSiteRoot(siteId);
  const destPath = path.join(siteRoot, cleanPath);

  if (!destPath.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  const parentDir = path.dirname(destPath);
  const tmpFile = path.join(parentDir, `.upload-${crypto.randomBytes(8).toString('hex')}`);

  try {
    await mkdir(parentDir, { recursive: true, mode: DIR_MODE });
    const writeStream = createWriteStream(tmpFile, { flags: 'wx', mode: FILE_MODE });
    await pipeline(fileStream, writeStream);
    await chmod(tmpFile, FILE_MODE);
    await rename(tmpFile, destPath);
  } catch (err: unknown) {
    await unlink(tmpFile).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to save file: ${message}`);
  }
}

/**
 * Delete a file or directory within a site.
 */
export async function deleteFile(siteId: string, relativePath: string): Promise<void> {
  const cleanPath = validatePath(relativePath);
  const siteRoot = getSiteRoot(siteId);
  const targetPath = path.join(siteRoot, cleanPath);

  if (!targetPath.startsWith(siteRoot + '/')) {
    throw new Error('Path traversal detected');
  }

  await rm(targetPath, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/**
 * Get the total size of a site directory in bytes (apparent size of every
 * entry, like `du -sb`; symbolic links are not followed).
 */
export async function getSiteSize(siteId: string): Promise<number> {
  const walk = async (dir: string): Promise<number> => {
    let total = 0;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') return 0;
      throw err;
    }
    for (const name of names) {
      const p = path.join(dir, name);
      let st;
      try {
        st = await lstat(p);
      } catch (err: unknown) {
        if (errnoCode(err) === 'ENOENT') continue;
        throw err;
      }
      total += st.size;
      if (st.isDirectory()) total += await walk(p);
    }
    return total;
  };

  const siteRoot = getSiteRoot(siteId);
  try {
    const st = await lstat(siteRoot);
    return st.size + (st.isDirectory() ? await walk(siteRoot) : 0);
  } catch (err: unknown) {
    if (errnoCode(err) === 'ENOENT') return 0;
    throw new Error(`Failed to get site size: ${err instanceof Error ? err.message : String(err)}`);
  }
}
