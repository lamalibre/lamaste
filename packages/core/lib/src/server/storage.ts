/**
 * Storage-server registry + credential encryption.
 *
 * Registers S3-compatible storage servers, encrypts access/secret keys with
 * AES-256-GCM under a scrypt-derived subkey of a local master key, and
 * maintains plugin ↔ storage bindings.
 *
 * Pure core: paths are injected (`dataDir`), no env var reads, no Fastify.
 */

import crypto from 'node:crypto';
import { readFile, rename, writeFile, open, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageServerRegistration {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly region: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

export interface StorageServerPublic {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly region: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly registeredAt: string;
}

interface StorageServerEntry {
  id: string;
  label: string;
  provider: string;
  region: string;
  bucket: string;
  endpoint: string;
  accessKeyEncrypted: string;
  secretKeyEncrypted: string;
  registeredAt: string;
}

export interface PluginStorageBinding {
  readonly pluginName: string;
  readonly storageServerId: string;
  readonly boundAt: string;
}

export interface PluginStorageBindingWithServer extends PluginStorageBinding {
  readonly server: StorageServerPublic | null;
}

export interface PluginStorageConfig {
  readonly provider: string;
  readonly region: string;
  readonly bucket: string;
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

interface StorageConfigFile {
  servers: StorageServerEntry[];
  bindings: PluginStorageBinding[];
}

export class StorageError extends Error {
  readonly statusCode: number;
  readonly code: 'ALREADY_EXISTS' | 'NOT_FOUND' | 'BINDING_EXISTS' | 'IO_ERROR' | 'CORRUPT';
  constructor(message: string, code: StorageError['code'], statusCode: number) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Per-directory mutex cache
// ---------------------------------------------------------------------------

const mutexByDir = new Map<string, PromiseChainMutex>();

function getMutex(dataDir: string): PromiseChainMutex {
  let m = mutexByDir.get(dataDir);
  if (!m) {
    m = new PromiseChainMutex();
    mutexByDir.set(dataDir, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Master key management
// ---------------------------------------------------------------------------

const masterKeyCache = new Map<string, Buffer>();

function masterKeyPath(dataDir: string): string {
  return path.join(dataDir, 'storage-master.key');
}

async function loadOrCreateMasterKey(dataDir: string): Promise<Buffer> {
  const cached = masterKeyCache.get(dataDir);
  if (cached) return cached;

  const keyPath = masterKeyPath(dataDir);

  try {
    const buf = await readFile(keyPath);
    if (buf.length !== 32) {
      throw new StorageError(
        `Master key file has unexpected length: ${buf.length}`,
        'CORRUPT',
        500,
      );
    }
    masterKeyCache.set(dataDir, buf);
    return buf;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  const key = crypto.randomBytes(32);
  const tmpPath = `${keyPath}.tmp`;
  await writeFile(tmpPath, key, { mode: 0o600 });
  const fd = await open(tmpPath, 'r');
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
  await rename(tmpPath, keyPath);

  masterKeyCache.set(dataDir, key);
  return key;
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption
// ---------------------------------------------------------------------------

const SCRYPT_SALT_LEN = 16;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const SCRYPT_KEYLEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

function scryptDeriveKey(masterKey: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(masterKey, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

/**
 * Encrypt a plaintext string. Returns a base64-encoded packed buffer:
 * [salt (16)] [iv (12)] [authTag (16)] [ciphertext (...)]
 */
export async function encryptCredential(plaintext: string, dataDir: string): Promise<string> {
  const masterKey = await loadOrCreateMasterKey(dataDir);
  const salt = crypto.randomBytes(SCRYPT_SALT_LEN);
  const derivedKey = await scryptDeriveKey(masterKey, salt);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const packed = Buffer.concat([salt, iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64-encoded packed buffer back to plaintext string.
 */
export async function decryptCredential(packed: string, dataDir: string): Promise<string> {
  const masterKey = await loadOrCreateMasterKey(dataDir);
  const buf = Buffer.from(packed, 'base64');

  const minLen = SCRYPT_SALT_LEN + IV_LEN + AUTH_TAG_LEN + 1;
  if (buf.length < minLen) {
    throw new StorageError('Encrypted credential is corrupted or truncated', 'CORRUPT', 500);
  }

  const salt = buf.subarray(0, SCRYPT_SALT_LEN);
  const iv = buf.subarray(SCRYPT_SALT_LEN, SCRYPT_SALT_LEN + IV_LEN);
  const authTag = buf.subarray(SCRYPT_SALT_LEN + IV_LEN, SCRYPT_SALT_LEN + IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(SCRYPT_SALT_LEN + IV_LEN + AUTH_TAG_LEN);

  const derivedKey = await scryptDeriveKey(masterKey, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf-8');
}

// ---------------------------------------------------------------------------
// Storage config persistence
// ---------------------------------------------------------------------------

function storageConfigPath(dataDir: string): string {
  return path.join(dataDir, 'storage-config.json');
}

async function readStorageConfig(dataDir: string): Promise<StorageConfigFile> {
  try {
    const raw = await readFile(storageConfigPath(dataDir), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StorageConfigFile>;
    return {
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { servers: [], bindings: [] };
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new StorageError(`Failed to read storage config: ${message}`, 'IO_ERROR', 500);
  }
}

async function writeStorageConfig(dataDir: string, data: StorageConfigFile): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await atomicWriteJSON(storageConfigPath(dataDir), data, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API — all take dataDir as first param
// ---------------------------------------------------------------------------

function toPublic(entry: StorageServerEntry): StorageServerPublic {
  return {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    region: entry.region,
    bucket: entry.bucket,
    endpoint: entry.endpoint,
    registeredAt: entry.registeredAt,
  };
}

/**
 * Register a storage server. Encrypts credentials before persisting.
 */
export function registerStorageServer(
  dataDir: string,
  input: StorageServerRegistration,
): Promise<StorageServerPublic> {
  return getMutex(dataDir).run(async () => {
    const config = await readStorageConfig(dataDir);

    if (config.servers.some((s) => s.id === input.id)) {
      throw new StorageError(
        `Storage server with id "${input.id}" already registered`,
        'ALREADY_EXISTS',
        409,
      );
    }

    const entry: StorageServerEntry = {
      id: input.id,
      label: input.label,
      provider: input.provider,
      region: input.region,
      bucket: input.bucket,
      endpoint: input.endpoint,
      accessKeyEncrypted: await encryptCredential(input.accessKey, dataDir),
      secretKeyEncrypted: await encryptCredential(input.secretKey, dataDir),
      registeredAt: new Date().toISOString(),
    };

    config.servers.push(entry);
    await writeStorageConfig(dataDir, config);

    return toPublic(entry);
  });
}

/**
 * Remove a storage server and any bindings referencing it.
 */
export function removeStorageServer(dataDir: string, id: string): Promise<{ ok: true }> {
  return getMutex(dataDir).run(async () => {
    const config = await readStorageConfig(dataDir);
    const idx = config.servers.findIndex((s) => s.id === id);

    if (idx === -1) {
      throw new StorageError(`Storage server "${id}" not found`, 'NOT_FOUND', 404);
    }

    config.servers.splice(idx, 1);
    config.bindings = config.bindings.filter((b) => b.storageServerId !== id);
    await writeStorageConfig(dataDir, config);

    return { ok: true };
  });
}

/**
 * List registered storage servers with credentials redacted.
 */
export async function listStorageServers(dataDir: string): Promise<StorageServerPublic[]> {
  const config = await readStorageConfig(dataDir);
  return config.servers.map(toPublic);
}

/**
 * Bind a storage server to a plugin. One binding per plugin.
 */
export function bindPluginStorage(
  dataDir: string,
  pluginName: string,
  storageServerId: string,
): Promise<PluginStorageBinding> {
  return getMutex(dataDir).run(async () => {
    const config = await readStorageConfig(dataDir);

    if (!config.servers.some((s) => s.id === storageServerId)) {
      throw new StorageError(`Storage server "${storageServerId}" not found`, 'NOT_FOUND', 404);
    }

    if (config.bindings.some((b) => b.pluginName === pluginName)) {
      throw new StorageError(
        `Plugin "${pluginName}" already has a storage binding — unbind first`,
        'BINDING_EXISTS',
        409,
      );
    }

    const binding: PluginStorageBinding = {
      pluginName,
      storageServerId,
      boundAt: new Date().toISOString(),
    };

    config.bindings.push(binding);
    await writeStorageConfig(dataDir, config);

    return binding;
  });
}

/**
 * Remove storage binding for a plugin.
 */
export function unbindPluginStorage(dataDir: string, pluginName: string): Promise<{ ok: true }> {
  return getMutex(dataDir).run(async () => {
    const config = await readStorageConfig(dataDir);
    const idx = config.bindings.findIndex((b) => b.pluginName === pluginName);

    if (idx === -1) {
      throw new StorageError(`No storage binding for plugin "${pluginName}"`, 'NOT_FOUND', 404);
    }

    config.bindings.splice(idx, 1);
    await writeStorageConfig(dataDir, config);

    return { ok: true };
  });
}

/**
 * List all bindings.
 */
export async function listBindings(dataDir: string): Promise<PluginStorageBinding[]> {
  const config = await readStorageConfig(dataDir);
  return config.bindings;
}

/**
 * Get binding for a specific plugin, including redacted storage server info.
 */
export async function getBinding(
  dataDir: string,
  pluginName: string,
): Promise<PluginStorageBindingWithServer | null> {
  const config = await readStorageConfig(dataDir);
  const binding = config.bindings.find((b) => b.pluginName === pluginName);

  if (!binding) return null;

  const server = config.servers.find((s) => s.id === binding.storageServerId);
  return {
    ...binding,
    server: server ? toPublic(server) : null,
  };
}

/**
 * Get decrypted storage config for a bound plugin.
 * Returns null if unbound.
 */
export async function getPluginStorageConfig(
  dataDir: string,
  pluginName: string,
): Promise<PluginStorageConfig | null> {
  const config = await readStorageConfig(dataDir);
  const binding = config.bindings.find((b) => b.pluginName === pluginName);

  if (!binding) return null;

  const server = config.servers.find((s) => s.id === binding.storageServerId);
  if (!server) return null;

  return {
    provider: server.provider,
    region: server.region,
    bucket: server.bucket,
    endpoint: server.endpoint,
    accessKey: await decryptCredential(server.accessKeyEncrypted, dataDir),
    secretKey: await decryptCredential(server.secretKeyEncrypted, dataDir),
  };
}
