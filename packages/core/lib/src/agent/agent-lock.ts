/**
 * A cross-process lock per agent.
 *
 * The sync timer, `lamaste-agent setup`/`update`/`panel`, and the agent daemon
 * are separate processes that all change the same agent's chisel service and
 * `config.json`. Everything that loads/unloads that service or rewrites that
 * config runs under this lock.
 *
 * The lock is a file in the agent's data directory, created atomically *with*
 * its content: the owner record is written to a unique temp file and hard-
 * linked to the lock path (`link` fails with EEXIST if the lock exists), so a
 * reader never sees an empty or half-written lock. The record names the
 * owner's PID, the boot it ran in, and when it took the lock. A lock is stale
 * when its owner is gone, belongs to another boot, or is older than
 * {@link LOCK_MAX_AGE_MS} — no operation under it takes that long, so an
 * unrelated process that later reuses the PID cannot hold it forever.
 *
 * A stale lock is taken over by renaming it aside (only one contender can
 * rename a given file) and checking that what was renamed is the record that
 * was judged stale; if a live owner had taken the lock in between, its record
 * is linked back.
 */

import crypto from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { agentDataDir } from './platform.js';

const LOCK_WAIT_MS = 10 * 60_000;
const LOCK_POLL_MS = 250;
/** Longer than any converge (a chisel download is capped at 5 minutes). */
const LOCK_MAX_AGE_MS = 15 * 60_000;

interface LockRecord {
  readonly pid: number;
  readonly boot: string;
  readonly at: number;
  readonly nonce: string;
}

let bootIdCache: string | null = null;

/** An identifier of the current boot. */
async function bootId(): Promise<string> {
  if (bootIdCache !== null) return bootIdCache;
  let id = '';
  if (process.platform === 'linux') {
    id = (await readFile('/proc/sys/kernel/random/boot_id', 'utf-8').catch(() => '')).trim();
  } else if (process.platform === 'darwin') {
    const { execa } = await import('execa');
    id = await execa('sysctl', ['-n', 'kern.bootsessionuuid'])
      .then((r) => r.stdout.trim())
      .catch(() => '');
  }
  bootIdCache = id || 'unknown';
  return bootIdCache;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function parseRecord(raw: string): LockRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<LockRecord>;
    if (
      typeof r.pid === 'number' &&
      typeof r.boot === 'string' &&
      typeof r.at === 'number' &&
      typeof r.nonce === 'string'
    ) {
      return r as LockRecord;
    }
  } catch {
    // fall through
  }
  return null;
}

async function isStale(raw: string): Promise<boolean> {
  const record = parseRecord(raw);
  // Records are written before they become visible, so an unparsable lock
  // is a leftover from an older version or a corrupted file.
  if (!record) return true;
  if (record.boot !== (await bootId())) return true;
  if (Date.now() - record.at > LOCK_MAX_AGE_MS) return true;
  return !processAlive(record.pid);
}

/** Run `fn` holding the agent's lock. Not re-entrant. */
export async function withAgentLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const dir = agentDataDir(label);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, 'agent.lock');
  const record: LockRecord = {
    pid: process.pid,
    boot: await bootId(),
    at: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const content = JSON.stringify(record);
  const tmp = path.join(dir, `.agent.lock.${record.nonce}`);
  await writeFile(tmp, content, { mode: 0o600 });

  const deadline = Date.now() + LOCK_WAIT_MS;
  try {
    for (;;) {
      try {
        await link(tmp, lockPath);
        break;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      const current = await readFile(lockPath, 'utf-8').catch(() => null);
      if (current !== null && (await isStale(current))) {
        await takeOver(lockPath, current, dir);
        continue;
      }
      if (Date.now() > deadline) {
        const owner = current ? parseRecord(current)?.pid : undefined;
        throw new Error(
          `Another operation on agent '${label}' is still running${owner ? ` (PID ${owner})` : ''}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  } finally {
    await rm(tmp, { force: true });
  }

  try {
    return await fn();
  } finally {
    // Release only our own lock — never one a contender took over.
    const current = await readFile(lockPath, 'utf-8').catch(() => null);
    if (current === content) await rm(lockPath, { force: true });
  }
}

async function takeOver(lockPath: string, staleContent: string, dir: string): Promise<void> {
  const aside = path.join(dir, `.agent.lock.stale-${crypto.randomBytes(8).toString('hex')}`);
  try {
    await rename(lockPath, aside);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // someone else did
    throw err;
  }
  const moved = await readFile(aside, 'utf-8').catch(() => null);
  if (moved !== staleContent && moved !== null) {
    // A live owner took the lock between our read and the rename: give it back.
    await link(aside, lockPath).catch(() => undefined);
  }
  await rm(aside, { force: true });
}
