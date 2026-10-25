/**
 * The web surface of an agent-hosted plugin — the static shell its users
 * load, served by the relay on the plugin's own site beside the user
 * surface's `/api/<route>/app/*` (one host, one Authelia session).
 *
 * The plugin declares it in its manifest (`userSurface.web`,
 * {@link UserSurfaceBlockSchema}) and ships the shell's files in its server
 * package, under `root`. The files are a *web tree*: what the relay may
 * serve is fixed by the tree's manifest ({@link webTreeManifest}) — every
 * file's path, size and SHA-256, and the SHA-256 over all of them — which
 * enters the approval digest (`approvalDigest`'s `web`) only when the
 * plugin declares a web surface. The relay computes it from the registry
 * tarball when it stages a version (before anyone approves it), and holds
 * the copy it serves against it file by file; a tree that breaks a rule
 * ({@link webTreePathProblem}, {@link WEB_TREE_LIMITS}) fails staging, so it
 * is never approved.
 *
 * Pure; the readers (a tarball, a directory) are in
 * `@lamalibre/lamaste/server`.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import {
  AGENT_LABEL_REGEX,
  AGENT_PANEL_SUBDOMAIN_PREFIX,
  RESERVED_SUBDOMAINS,
} from './constants.js';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Who may load a web surface: any signed-in user entitled to the plugin
 * (`authenticated`), or only those also granted the site (`restricted`).
 * Never `public` — the shell is the front of an API that knows its users.
 */
export const WEB_SURFACE_ACCESS_MODES = ['authenticated', 'restricted'] as const;

export type WebSurfaceAccessMode = (typeof WEB_SURFACE_ACCESS_MODES)[number];

/** Where in the server package the shell's files are when `root` is not declared. */
export const DEFAULT_WEB_SURFACE_ROOT = 'web';

/** The longest `root` a manifest may declare. */
const WEB_SURFACE_ROOT_MAX_LENGTH = 128;

/**
 * Whether `subdomain` may be a web surface's subdomain: a DNS label, none
 * of {@link RESERVED_SUBDOMAINS}, not an agent panel's (`agent-…`).
 */
export function isWebSurfaceSubdomain(subdomain: unknown): subdomain is string {
  return (
    typeof subdomain === 'string' &&
    AGENT_LABEL_REGEX.test(subdomain) &&
    !(RESERVED_SUBDOMAINS as readonly string[]).includes(subdomain) &&
    !subdomain.startsWith(AGENT_PANEL_SUBDOMAIN_PREFIX)
  );
}

/**
 * The manifest's `userSurface.web`: the subdomain Lamaste offers for the
 * plugin's site (`defaultSubdomain` — an offer, never applied without an
 * admin), the access mode the site starts with, and the directory of the
 * server package holding the shell (`root`, a relative path of
 * {@link isWebTreeSegment} segments). Neither the subdomain nor the access
 * mode enters the approval digest: they shape an offer, never an existing
 * site.
 */
export const WebSurfaceBlockSchema = z
  .object({
    defaultSubdomain: z
      .string()
      .refine(
        isWebSurfaceSubdomain,
        'defaultSubdomain must be a DNS label that is not reserved (panel, auth, tunnel, www, mail, ftp, api, agent-*)',
      ),
    accessMode: z.enum(WEB_SURFACE_ACCESS_MODES).optional().default('authenticated'),
    root: z
      .string()
      .max(WEB_SURFACE_ROOT_MAX_LENGTH)
      .refine(
        (root) => root.split('/').every(isWebTreeSegment),
        'root must be a relative directory of the server package (letters, digits, ".", "_", "-"; no segment starting with ".")',
      )
      .optional()
      .default(DEFAULT_WEB_SURFACE_ROOT),
  })
  .strict();

export type WebSurfaceBlock = z.output<typeof WebSurfaceBlockSchema>;

/**
 * The manifest's `userSurface` block: how end users reach the plugin. Only
 * `web` exists today; only an agent-hosted plugin with an agent half that
 * declares `identity` may declare it (`ManifestSchema` checks that) — the
 * shell is the front of the agent half's `/app/*`, which knows its users
 * only through identity.
 */
export const UserSurfaceBlockSchema = z
  .object({
    web: WebSurfaceBlockSchema.optional(),
  })
  .strict();

export type UserSurfaceBlock = z.output<typeof UserSurfaceBlockSchema>;

// ---------------------------------------------------------------------------
// Web trees
// ---------------------------------------------------------------------------

/**
 * Bounds of one web tree. The relay reads a staged version's tree from its
 * registry tarball in memory, so the bounds are an app shell's, not a media
 * library's.
 */
export const WEB_TREE_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 8 * 1024 * 1024,
  maxTreeBytes: 32 * 1024 * 1024,
  maxPathLength: 256,
  maxDepth: 16,
});

/** The file a web tree must have at its top: the shell, and every unknown path's answer. */
export const WEB_TREE_INDEX = 'index.html';

/**
 * What a web tree may hold, by extension, and the content type the relay
 * serves each with — an app shell's parts. The vhost names these types
 * itself (its `types` block) rather than trust the host's `mime.types`,
 * which differs between nginx versions (`.mjs`, `.webmanifest`, `.avif`);
 * with `nosniff` a module script served under another type does not run.
 * No `.wasm`: the shell's Content-Security-Policy does not let it compile.
 */
export const WEB_TREE_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
});

/** The extensions a web tree may hold (the keys of {@link WEB_TREE_CONTENT_TYPES}). */
export const WEB_TREE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.keys(WEB_TREE_CONTENT_TYPES),
);

/**
 * A path segment of a web tree: letters, digits, `.`, `_` and `-`, not
 * starting with `.` (no hidden file, no `.` or `..`) — nothing a URL must
 * encode, so the path nginx is asked for is the path on disk.
 */
const WEB_TREE_SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Whether `segment` is a valid segment of a web tree path or of `root`. */
export function isWebTreeSegment(segment: string): boolean {
  return WEB_TREE_SEGMENT_RE.test(segment);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Why `path` (relative to the tree's top, `/`-separated) cannot be in a web
 * tree, or null when it can: at most {@link WEB_TREE_LIMITS}' length and
 * depth, every segment {@link isWebTreeSegment}, an extension of
 * {@link WEB_TREE_EXTENSIONS}.
 */
export function webTreePathProblem(path: string): string | null {
  if (path.length === 0 || path.length > WEB_TREE_LIMITS.maxPathLength) {
    return `path must be 1 to ${WEB_TREE_LIMITS.maxPathLength} characters`;
  }
  const segments = path.split('/');
  if (segments.length > WEB_TREE_LIMITS.maxDepth) {
    return `path is deeper than ${WEB_TREE_LIMITS.maxDepth} levels`;
  }
  if (!segments.every(isWebTreeSegment)) {
    return 'path segments may hold only letters, digits, ".", "_" and "-", and may not start with "."';
  }
  const ext = extensionOf(path);
  if (!WEB_TREE_EXTENSIONS.has(ext)) {
    return ext === '' ? 'file has no extension' : `extension "${ext}" is not allowed`;
  }
  return null;
}

/** One file of a web tree. */
export interface WebTreeFile {
  /** Relative to the tree's top, `/`-separated. */
  readonly path: string;
  readonly size: number;
  /** SHA-256 of the content, lower-case hex. */
  readonly sha256: string;
}

/** What the relay may serve of a web tree, and the digest the approval names. */
export interface WebTreeManifest {
  /** Every file, sorted by path (code units). */
  readonly files: readonly WebTreeFile[];
  readonly totalBytes: number;
  /** {@link webTreeDigest} of `files`. */
  readonly sha256: string;
}

export type WebTreeErrorCode =
  | 'INVALID_PATH'
  | 'DUPLICATE_PATH'
  | 'INVALID_FILE'
  | 'NOT_REGULAR_FILE'
  | 'TOO_MANY_FILES'
  | 'FILE_TOO_LARGE'
  | 'TREE_TOO_LARGE'
  | 'NO_INDEX'
  | 'NOT_FOUND'
  | 'DIGEST_MISMATCH';

/** A web tree that breaks a rule; `path` names the file when one is at fault. */
export class WebTreeError extends Error {
  constructor(
    message: string,
    readonly code: WebTreeErrorCode,
    readonly path?: string | undefined,
  ) {
    super(path === undefined ? message : `${path}: ${message}`);
    this.name = 'WebTreeError';
  }
}

/**
 * The error of a tree over one of {@link WEB_TREE_LIMITS} — one wording
 * wherever a tree is checked (a manifest, a tarball, a directory).
 */
export function webTreeLimitError(
  code: 'FILE_TOO_LARGE' | 'TREE_TOO_LARGE' | 'TOO_MANY_FILES',
  path?: string,
): WebTreeError {
  const message = {
    FILE_TOO_LARGE: `larger than ${WEB_TREE_LIMITS.maxFileBytes} bytes`,
    TREE_TOO_LARGE: `the tree is larger than ${WEB_TREE_LIMITS.maxTreeBytes} bytes`,
    TOO_MANY_FILES: `the tree has more than ${WEB_TREE_LIMITS.maxFiles} files`,
  }[code];
  return new WebTreeError(message, code, path);
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/** The version of {@link webTreeDigest}'s canonical form. */
export const WEB_TREE_DIGEST_VERSION = 1;

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SHA-256 (hex) of the JSON `{ "v": 1, "files": [[path, size, sha256], …] }`
 * with the files sorted by path (code units) — the digest of what a web
 * tree serves. Assumes valid files ({@link webTreeManifest} checks them).
 */
export function webTreeDigest(files: Iterable<WebTreeFile>): string {
  const rows = [...files]
    .sort((a, b) => codeUnitOrder(a.path, b.path))
    .map((f) => [f.path, f.size, f.sha256]);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ v: WEB_TREE_DIGEST_VERSION, files: rows }))
    .digest('hex');
}

/**
 * Check every rule of a web tree against `files` and return its manifest:
 * each path valid ({@link webTreePathProblem}) and present once, sizes and
 * digests well-formed, at most {@link WEB_TREE_LIMITS}' files and bytes,
 * and {@link WEB_TREE_INDEX} at the top. Throws {@link WebTreeError}.
 */
export function webTreeManifest(files: Iterable<WebTreeFile>): WebTreeManifest {
  const seen = new Set<string>();
  const out: WebTreeFile[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const problem = webTreePathProblem(file.path);
    if (problem) throw new WebTreeError(problem, 'INVALID_PATH', file.path);
    if (seen.has(file.path)) throw new WebTreeError('listed twice', 'DUPLICATE_PATH', file.path);
    seen.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA256_HEX_RE.test(file.sha256)) {
      throw new WebTreeError('invalid size or digest', 'INVALID_FILE', file.path);
    }
    if (file.size > WEB_TREE_LIMITS.maxFileBytes) {
      throw webTreeLimitError('FILE_TOO_LARGE', file.path);
    }
    totalBytes += file.size;
    if (totalBytes > WEB_TREE_LIMITS.maxTreeBytes) {
      throw webTreeLimitError('TREE_TOO_LARGE');
    }
    if (out.length === WEB_TREE_LIMITS.maxFiles) {
      throw webTreeLimitError('TOO_MANY_FILES');
    }
    out.push({ path: file.path, size: file.size, sha256: file.sha256 });
  }
  if (!seen.has(WEB_TREE_INDEX)) {
    throw new WebTreeError(`the tree has no ${WEB_TREE_INDEX} at its top`, 'NO_INDEX');
  }
  out.sort((a, b) => codeUnitOrder(a.path, b.path));
  return { files: out, totalBytes, sha256: webTreeDigest(out) };
}

/** SHA-256 (hex) of `bytes` — a web tree file's digest. */
export function webTreeFileSha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
