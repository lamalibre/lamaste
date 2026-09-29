/**
 * Per-agent chisel credential storage.
 *
 * The chisel tunnel server authenticates each agent with its own credential,
 * issued by the panel at enrollment (and on demand via
 * `lamaste-agent chisel refresh-credential`). It is stored at:
 *
 *     ~/.lamalibre/lamaste/agents/<label>/chisel.json   (mode 0600)
 *
 * This file is the source of truth; the service definition written by
 * `writeChiselService` is derived from it on every (re)generation, so any
 * path that rewrites the service — CLI or daemon — re-applies the credential.
 */

import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { agentDataDir } from './platform.js';
import type { ChiselCredential } from './chisel-service.js';

export interface StoredChiselCredential extends ChiselCredential {
  readonly fetchedAt?: string | undefined;
  /** When the panel issued this password (from the panel; not secret). */
  readonly issuedAt?: string | undefined;
}

/** Path to the per-agent chisel credential file. */
export function chiselCredentialPath(label: string): string {
  return path.join(agentDataDir(label), 'chisel.json');
}

/** Load the persisted chisel credential, or `null` if none is stored yet. */
export async function loadChiselCredential(label: string): Promise<StoredChiselCredential | null> {
  let raw: string;
  try {
    raw = await readFile(chiselCredentialPath(label), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const { user, password, fetchedAt, issuedAt } = parsed as Record<string, unknown>;
  if (typeof user !== 'string' || typeof password !== 'string') return null;
  return {
    user,
    password,
    ...(typeof fetchedAt === 'string' ? { fetchedAt } : {}),
    ...(typeof issuedAt === 'string' ? { issuedAt } : {}),
  };
}

/**
 * Atomically save a chisel credential (temp → fsync → rename, mode 0600).
 * `issuedAt` is the panel's issue time of this password, when known.
 */
export async function saveChiselCredential(
  label: string,
  credential: ChiselCredential & { readonly issuedAt?: string | null | undefined },
): Promise<void> {
  if (
    !credential ||
    typeof credential.user !== 'string' ||
    typeof credential.password !== 'string'
  ) {
    throw new Error('saveChiselCredential: credential must have string user and password');
  }
  const filePath = chiselCredentialPath(label);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  const payload = {
    user: credential.user,
    password: credential.password,
    fetchedAt: new Date().toISOString(),
    ...(typeof credential.issuedAt === 'string' ? { issuedAt: credential.issuedAt } : {}),
  };
  await writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  const fd = await open(tmp, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmp, filePath);
}
