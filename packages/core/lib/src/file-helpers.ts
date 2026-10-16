/**
 * Shared file operation helpers — atomic JSON writes and promise-chain mutex.
 *
 * Extracted from the duplicate patterns in:
 * - serverd/src/lib/plugins.js
 * - serverd/src/lib/mtls.js
 * - lamaste-agent/src/lib/agent-plugins.js
 * - lamaste-agent/src/lib/local-plugins.js
 */

import crypto from 'node:crypto';
import { readFile, rename, open, mkdir, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Promise-chain mutex
// ---------------------------------------------------------------------------

/**
 * A promise-chain mutex that serializes async operations.
 *
 * Used across all registry files to prevent concurrent modifications.
 * Each call to `run(fn)` waits for the previous operation to complete
 * before executing `fn`.
 *
 * @example
 * ```ts
 * const mutex = new PromiseChainMutex();
 * await mutex.run(async () => {
 *   const data = await readRegistry();
 *   data.items.push(newItem);
 *   await writeRegistry(data);
 * });
 * ```
 */
export class PromiseChainMutex {
  #tail: Promise<void> = Promise.resolve();

  /**
   * Execute an async function under the mutex.
   *
   * Rejections propagate to the immediate caller's awaited promise. They are
   * NOT propagated to subsequent `run()` calls — the next queued operation
   * waits for the previous one to settle (fulfilled or rejected) and then
   * runs independently. Callers must always `await` (or otherwise observe)
   * the returned promise, otherwise errors are silently dropped by design.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(fn, fn) as Promise<T>;
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/**
 * A keyed promise-chain mutex — one independent serialization queue per key.
 *
 * Useful when a registry is partitioned by an external identifier (e.g. one
 * mutex per agent label, or per registry file path) and operations on different
 * keys should not block each other.
 *
 * Internally this is just a Map of {@link PromiseChainMutex} created lazily on
 * first use. Stale instances are not garbage collected — callers are expected
 * to keep the set of keys bounded.
 */
export class KeyedPromiseChainMutex {
  #mutexes = new Map<string, PromiseChainMutex>();

  /**
   * Execute an async function under the mutex bound to `key`.
   * Operations sharing a key are serialized; operations on different keys run
   * concurrently.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let mutex = this.#mutexes.get(key);
    if (!mutex) {
      mutex = new PromiseChainMutex();
      this.#mutexes.set(key, mutex);
    }
    return mutex.run(fn);
  }
}

// ---------------------------------------------------------------------------
// Atomic JSON file operations
// ---------------------------------------------------------------------------

export interface AtomicWriteOptions {
  /** File permissions (default: 0o600). */
  mode?: number;
  /** Directory permissions if parent directory needs to be created (default: 0o700). */
  dirMode?: number;
  /** Whether to create parent directories if they do not exist (default: false). */
  mkdirp?: boolean;
  /**
   * Refuse to replace a target that is a symbolic link or anything but a
   * regular file (default: false). For files holding secrets: a link
   * planted where the file belongs is an error to report, not something to
   * write past.
   */
  refuseSymlink?: boolean;
}

/**
 * Atomically write a JSON object to disk.
 *
 * Writes to a unique temporary file (`.tmp-<random>`) created exclusively
 * (`wx`: never through an existing file or link), fsyncs it, renames it into
 * place, then fsyncs the parent directory so the rename itself survives a
 * crash. If any step fails the temp file is best-effort unlinked.
 *
 * The random suffix avoids collisions when two processes (e.g. CLI + daemon)
 * happen to write the same target without sharing a single in-process mutex.
 *
 * @param filePath - Absolute path to the target JSON file
 * @param data - The data to serialize (must be JSON-serializable)
 * @param options - Write options
 */
export async function atomicWriteJSON(
  filePath: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { mode = 0o600, dirMode = 0o700, mkdirp = false, refuseSymlink = false } = options;
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp-${crypto.randomBytes(6).toString('hex')}`;

  if (mkdirp) {
    await mkdir(dir, { recursive: true, mode: dirMode });
  }

  if (refuseSymlink) {
    await assertReplaceableFile(filePath);
  }

  const content = JSON.stringify(data, null, 2) + '\n';

  let created = false;
  try {
    const fd = await open(tmpPath, 'wx', mode);
    created = true;
    try {
      await fd.writeFile(content, 'utf-8');
      await fd.sync();
    } finally {
      await fd.close();
    }

    await rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file this call created (never one it
    // found in place). Swallow ENOENT — the rename may already have succeeded.
    if (created) await unlink(tmpPath).catch(() => {});
    throw err;
  }

  // fsync the parent directory so the rename is durable across crashes.
  // POSIX semantics; on Windows opening a directory fails with EISDIR/EPERM,
  // so we swallow those — the platform does not need it.
  try {
    const dirFd = await open(dir, 'r');
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EISDIR' && code !== 'EPERM' && code !== 'EINVAL' && code !== 'ENOTSUP') {
      // On POSIX a missing parent dir would be a real bug; surface it.
      // EBADF/EACCES are also unexpected.
      throw err;
    }
  }
}

/**
 * Read and parse a JSON file. Returns `defaultValue` if the file does not exist.
 *
 * @param filePath - Absolute path to the JSON file
 * @param defaultValue - Value to return when the file is missing (ENOENT)
 * @throws Re-throws non-ENOENT errors
 */
export async function readJSONFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Throws unless `filePath` is missing or a regular file (not a link, not a directory). */
async function assertReplaceableFile(filePath: string): Promise<void> {
  let info;
  try {
    info = await lstat(filePath);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') return;
    throw err;
  }
  if (info.isSymbolicLink()) {
    throw new Error(`Refusing to write ${filePath}: it is a symbolic link`);
  }
  if (!info.isFile()) {
    throw new Error(`Refusing to write ${filePath}: it is not a regular file`);
  }
}

interface NodeError extends Error {
  code?: string;
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error && 'code' in err;
}
