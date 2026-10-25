/**
 * Secrets of confidential OIDC clients.
 *
 * A confidential client (a plugin's service principal, or Lamaste's own
 * `lamaste-server` client) authenticates to Authelia's token endpoint with a
 * secret. Lamaste generates it — 32 random bytes — when the client first
 * appears, keeps the plaintext at `<stateDir>/oidc-clients.json` (0600,
 * atomic writes, one promise-chain mutex), hands it out exactly once (the
 * plugin install or enable response, or `rotate-secret`), and writes only a
 * pbkdf2 digest into Authelia's configuration. Secrets of clients that no
 * longer exist are deleted when the store is reconciled.
 *
 * Authelia accepts client secrets as go-crypt pbkdf2 digests:
 * `$pbkdf2-sha512$<iterations>$<salt>$<key>` with salt and key in "adapted
 * base64" — the standard alphabet with `+` replaced by `.`, no padding.
 */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';

export const OIDC_CLIENTS_FILENAME = 'oidc-clients.json';

/** Iterations Authelia's own `authelia crypto hash generate pbkdf2` uses for sha512. */
export const OIDC_SECRET_PBKDF2_ITERATIONS = 310000;
const OIDC_SECRET_PBKDF2_SALT_BYTES = 16;
const OIDC_SECRET_PBKDF2_KEY_BYTES = 64;
const OIDC_SECRET_BYTES = 32;

const OidcClientSecretRecordSchema = z.object({
  /** The plugin that declared the client; `lamaste` for the panel's own client. */
  plugin: z.string().min(1).max(100),
  secret: z.string().min(32).max(128),
  /**
   * pbkdf2 salt (adapted base64), fixed per secret so the digest written to
   * Authelia is the same on every render — the OIDC section is compared
   * textually to decide whether Authelia must be restarted.
   */
  salt: z.string().regex(/^[A-Za-z0-9./]{11,}$/),
  createdAt: z.string().datetime(),
  rotatedAt: z.string().datetime().nullable(),
});

export type OidcClientSecretRecord = z.infer<typeof OidcClientSecretRecordSchema>;

const OidcClientsFileSchema = z.object({
  version: z.literal(1),
  clients: z.record(
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'client ids are lowercase letters, numbers and hyphens'),
    OidcClientSecretRecordSchema,
  ),
});

export type OidcClientsFile = z.infer<typeof OidcClientsFileSchema>;

/** Everything an admin may see about a client's secret — never the secret. */
export interface OidcClientSecretMetadata {
  id: string;
  plugin: string;
  createdAt: string;
  rotatedAt: string | null;
}

/** A client the store should hold a secret for. */
export interface DesiredOidcClientSecret {
  id: string;
  plugin: string;
}

export interface OidcClientSecretsReconciliation {
  /** pbkdf2 digests of every desired client's secret, keyed by id — what Authelia's configuration carries. */
  digests: Record<string, string>;
  /** Clients whose secret was minted by this reconciliation. */
  created: Array<{ id: string; plugin: string; secret: string }>;
  /** Clients whose secret was deleted because they are no longer desired. */
  removed: string[];
}

// ---------------------------------------------------------------------------
// Digest encoding
// ---------------------------------------------------------------------------

/** Standard base64 without padding, `+` → `.` (go-crypt's "adapted base64"). */
export function adaptedBase64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/=+$/, '').replaceAll('+', '.');
}

export function adaptedBase64Decode(text: string): Buffer {
  if (!/^[A-Za-z0-9./]*$/.test(text)) throw new Error('not an adapted-base64 string');
  return Buffer.from(text.replaceAll('.', '+'), 'base64');
}

/**
 * `$pbkdf2-sha512$<iterations>$<salt>$<key>` for `secret`, the digest form
 * Authelia stores for a client secret. Deterministic for a given salt.
 */
export function encodePbkdf2Sha512Digest(
  secret: string,
  salt: Uint8Array,
  iterations: number = OIDC_SECRET_PBKDF2_ITERATIONS,
): string {
  if (salt.length < 8) throw new Error('pbkdf2 salt must be at least 8 bytes');
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('pbkdf2 iterations must be a positive integer');
  }
  const key = crypto.pbkdf2Sync(secret, salt, iterations, OIDC_SECRET_PBKDF2_KEY_BYTES, 'sha512');
  return `$pbkdf2-sha512$${iterations}$${adaptedBase64Encode(salt)}$${adaptedBase64Encode(key)}`;
}

/** A fresh pbkdf2 salt, adapted base64. */
function generateSalt(): string {
  return adaptedBase64Encode(crypto.randomBytes(OIDC_SECRET_PBKDF2_SALT_BYTES));
}

/**
 * Digests already computed, keyed by a SHA-256 of salt and secret (never the
 * secret itself): a client's digest is fixed by its salt and secret, and
 * every render — the identity tick's included, once a minute — asks for it
 * again. PBKDF2 at Authelia's cost (310 000 rounds of SHA-512) runs only for
 * a secret not seen yet, and off the event loop.
 */
const digestMemo = new Map<string, string>();
const DIGEST_MEMO_MAX = 256;
let digestsComputed = 0;

/** How many digests this process computed (tests, diagnostics). */
export function oidcSecretDigestsComputed(): number {
  return digestsComputed;
}

const pbkdf2Async = promisify(crypto.pbkdf2);

async function digestOf(record: OidcClientSecretRecord): Promise<string> {
  const key = crypto.createHash('sha256').update(`${record.salt}\n${record.secret}`).digest('hex');
  const known = digestMemo.get(key);
  if (known !== undefined) return known;
  const salt = adaptedBase64Decode(record.salt);
  const derived = await pbkdf2Async(
    record.secret,
    salt,
    OIDC_SECRET_PBKDF2_ITERATIONS,
    OIDC_SECRET_PBKDF2_KEY_BYTES,
    'sha512',
  );
  digestsComputed += 1;
  const digest = `$pbkdf2-sha512$${OIDC_SECRET_PBKDF2_ITERATIONS}$${adaptedBase64Encode(salt)}$${adaptedBase64Encode(derived)}`;
  if (digestMemo.size >= DIGEST_MEMO_MAX) digestMemo.clear();
  digestMemo.set(key, digest);
  return digest;
}

/** Check a secret against a digest produced by {@link encodePbkdf2Sha512Digest}. */
export function verifyPbkdf2Sha512Digest(secret: string, digest: string): boolean {
  const m = /^\$pbkdf2-sha512\$(\d+)\$([A-Za-z0-9./]+)\$([A-Za-z0-9./]+)$/.exec(digest);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return false;
  const iterations = Number.parseInt(m[1], 10);
  const salt = adaptedBase64Decode(m[2]);
  const expected = adaptedBase64Decode(m[3]);
  const actual = crypto.pbkdf2Sync(secret, salt, iterations, expected.length, 'sha512');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** A fresh client secret: 32 random bytes, base64url (43 characters, no padding). */
export function generateClientSecret(): string {
  return crypto.randomBytes(OIDC_SECRET_BYTES).toString('base64url');
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function oidcClientsPath(stateDir: string): string {
  return path.join(stateDir, OIDC_CLIENTS_FILENAME);
}

const mutex = new PromiseChainMutex();

async function readStore(stateDir: string): Promise<OidcClientsFile> {
  let raw: string;
  try {
    raw = await readFile(oidcClientsPath(stateDir), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, clients: {} };
    throw err;
  }
  const parsed = OidcClientsFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `${oidcClientsPath(stateDir)} is invalid — ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data;
}

async function writeStore(stateDir: string, store: OidcClientsFile): Promise<void> {
  await atomicWriteJSON(oidcClientsPath(stateDir), OidcClientsFileSchema.parse(store), {
    mode: 0o600,
  });
}

function metadataOf(id: string, record: OidcClientSecretRecord): OidcClientSecretMetadata {
  return { id, plugin: record.plugin, createdAt: record.createdAt, rotatedAt: record.rotatedAt };
}

/** Metadata of every stored client secret, never the secret itself. */
export async function listOidcClientSecrets(stateDir: string): Promise<OidcClientSecretMetadata[]> {
  const store = await readStore(stateDir);
  return Object.entries(store.clients)
    .map(([id, record]) => metadataOf(id, record))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The plaintext secret of one client, or `null` when the store has none. */
export async function readOidcClientSecret(stateDir: string, id: string): Promise<string | null> {
  const store = await readStore(stateDir);
  return store.clients[id]?.secret ?? null;
}

/**
 * Bring the store in line with `desired`: mint a secret for every client
 * that has none, delete the secrets of clients no longer listed, and return
 * the plaintext of each desired client so the caller can digest it for
 * Authelia. A client id is owned by one plugin: a different plugin claiming
 * an existing id gets a fresh secret and the old one is gone.
 */
export function reconcileOidcClientSecrets(
  stateDir: string,
  desired: readonly DesiredOidcClientSecret[],
  now: () => Date = () => new Date(),
): Promise<OidcClientSecretsReconciliation> {
  return mutex.run(async () => {
    const store = await readStore(stateDir);
    const wanted = new Map(desired.map((d) => [d.id, d] as const));
    if (wanted.size !== desired.length) {
      throw new Error('OIDC client ids must be unique across plugins');
    }

    const next: OidcClientsFile = { version: 1, clients: {} };
    const result: OidcClientSecretsReconciliation = { digests: {}, created: [], removed: [] };

    for (const [id, want] of wanted) {
      const existing = store.clients[id];
      if (existing && existing.plugin === want.plugin) {
        next.clients[id] = existing;
        result.digests[id] = await digestOf(existing);
        continue;
      }
      const secret = generateClientSecret();
      const record: OidcClientSecretRecord = {
        plugin: want.plugin,
        secret,
        salt: generateSalt(),
        createdAt: now().toISOString(),
        rotatedAt: null,
      };
      next.clients[id] = record;
      result.digests[id] = await digestOf(record);
      result.created.push({ id, plugin: want.plugin, secret });
    }
    for (const id of Object.keys(store.clients)) {
      if (!next.clients[id]) result.removed.push(id);
    }

    const changed =
      result.created.length > 0 ||
      result.removed.length > 0 ||
      Object.keys(store.clients).length !== Object.keys(next.clients).length;
    if (changed) await writeStore(stateDir, next);
    return result;
  });
}

/**
 * Replace a client's secret. Returns the new plaintext — the only time it
 * is shown. The caller must rewrite Authelia's configuration with the new
 * digest, otherwise the old secret stays valid there.
 */
export function rotateOidcClientSecret(
  stateDir: string,
  id: string,
  now: () => Date = () => new Date(),
): Promise<{ id: string; plugin: string; secret: string; rotatedAt: string }> {
  return mutex.run(async () => {
    const store = await readStore(stateDir);
    const existing = store.clients[id];
    if (!existing) throw new Error(`OIDC client "${id}" has no stored secret`);
    const secret = generateClientSecret();
    const rotatedAt = now().toISOString();
    store.clients[id] = { ...existing, secret, salt: generateSalt(), rotatedAt };
    await writeStore(stateDir, store);
    return { id, plugin: existing.plugin, secret, rotatedAt };
  });
}

/** Delete every stored secret (uninstall). Returns how many were removed. */
export function clearOidcClientSecrets(stateDir: string): Promise<number> {
  return mutex.run(async () => {
    const store = await readStore(stateDir);
    const count = Object.keys(store.clients).length;
    if (count > 0) await writeStore(stateDir, { version: 1, clients: {} });
    return count;
  });
}

/** Digests of every stored secret, keyed by client id (what Authelia's configuration carries). */
export async function readOidcClientSecretDigests(
  stateDir: string,
): Promise<Record<string, string>> {
  const store = await readStore(stateDir);
  const digests: Record<string, string> = {};
  for (const [id, record] of Object.entries(store.clients)) digests[id] = await digestOf(record);
  return digests;
}
