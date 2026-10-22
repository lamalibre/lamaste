import crypto from 'node:crypto';
import { readFile, writeFile, rename, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { isIdentityUuid } from '@lamalibre/lamaste';
import { SESSION_MAX_AGE } from './user-access-session.js';

const ConfigSchema = z.object({
  ip: z.string().min(1),
  domain: z.string().nullable(),
  email: z.string().email().nullable(),
  dataDir: z.string().min(1),
  serverId: z.string().uuid().optional(),
  staticDir: z.string().optional(),
  maxSiteSize: z
    .number()
    .optional()
    .default(500 * 1024 * 1024),
  adminAuthMode: z.enum(['p12', 'hardware-bound']).optional().default('p12'),
  panel2fa: z
    .object({
      enabled: z.boolean(),
      secret: z.string().nullable(),
      setupComplete: z.boolean(),
    })
    .optional()
    .default({ enabled: false, secret: null, setupComplete: false }),
  sessionSecret: z.string().nullable().optional().default(null),
  // Per-user invalidation epochs (Unix seconds), keyed by the directory's
  // user id — never by username, so panel.json names nobody. Offboarding a
  // user (disable, delete) bumps theirs, and the session middleware rejects
  // every user-access session issued before it. Sessions are bound to the
  // user id too, so a username given to someone else later never revives
  // one. An epoch older than a session's longest life can reject nothing and
  // is dropped (`pruneUserEpochs`).
  userEpochs: z.record(z.string(), z.number().int().nonnegative()).optional().default({}),
  onboarding: z.object({
    status: z.enum(['FRESH', 'DOMAIN_SET', 'DNS_READY', 'PROVISIONING', 'COMPLETED']),
  }),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..', '..');

let config = null;
let configPath = null;

/**
 * Promise-chain mutex serializing all panel.json writes so concurrent
 * updateConfig() / bumpUserEpoch() calls cannot race (e.g. two simultaneous
 * user deletes both bumping userEpochs).
 */
let configWriteLock = Promise.resolve();
function withConfigLock(fn) {
  const prev = configWriteLock;
  let resolve;
  configWriteLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(resolve);
}

/**
 * The epochs worth keeping: keyed by a user id (keys of earlier versions
 * were usernames — dropped, as the sessions they guarded no longer
 * validate: a session now names its user id) and younger than a session's
 * longest life.
 *
 * @param {Record<string, number>} epochs
 * @param {number} nowSeconds
 */
export function pruneUserEpochs(epochs, nowSeconds) {
  const out = {};
  for (const [userId, epoch] of Object.entries(epochs ?? {})) {
    if (isIdentityUuid(userId) && epoch > nowSeconds - SESSION_MAX_AGE) out[userId] = epoch;
  }
  return out;
}

/** Write `validated` to panel.json atomically (temp → fsync → rename), 0600. */
async function persistConfig(validated) {
  const tmpPath = `${configPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmpPath, configPath);
}

function resolveConfigPath() {
  if (process.env.LAMALIBRE_LAMASTE_CONFIG) {
    return process.env.LAMALIBRE_LAMASTE_CONFIG;
  }

  const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

  if (isDev) {
    return path.resolve(packageRoot, 'dev', 'panel.json');
  }

  return '/etc/lamalibre/lamaste/panel.json';
}

export async function loadConfig() {
  configPath = resolveConfigPath();

  let raw;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found at ${configPath}. Run create-lamaste to initialize.`);
    }
    throw new Error(`Failed to read config file at ${configPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file at ${configPath} contains invalid JSON.`);
  }

  const validated = ConfigSchema.parse(parsed);

  // Auto-generate serverId if missing — used as bucket prefix for multi-server isolation
  let rewrite = false;
  if (!validated.serverId) {
    validated.serverId = crypto.randomUUID();
    rewrite = true;
  }
  // Epochs keyed by username (before 4.5) or too old to reject anything go.
  const epochs = pruneUserEpochs(validated.userEpochs, Math.floor(Date.now() / 1000));
  if (Object.keys(epochs).length !== Object.keys(validated.userEpochs).length) {
    validated.userEpochs = epochs;
    rewrite = true;
  }
  if (rewrite) await persistConfig(validated);

  config = validated;
  return structuredClone(config);
}

export function getConfig() {
  if (config === null) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return structuredClone(config);
}

export function updateConfig(patch) {
  if (config === null) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }

  return withConfigLock(async () => {
    const merged = structuredClone(config);

    for (const key of Object.keys(patch)) {
      if (
        key === 'onboarding' &&
        typeof patch.onboarding === 'object' &&
        patch.onboarding !== null
      ) {
        merged.onboarding = { ...merged.onboarding, ...patch.onboarding };
      } else if (
        key === 'panel2fa' &&
        typeof patch.panel2fa === 'object' &&
        patch.panel2fa !== null
      ) {
        merged.panel2fa = { ...merged.panel2fa, ...patch.panel2fa };
      } else {
        merged[key] = patch[key];
      }
    }

    const validated = ConfigSchema.parse(merged);
    await persistConfig(validated);

    config = validated;
    return structuredClone(config);
  });
}

/**
 * Bump a user's session-invalidation epoch to "now" (Unix seconds): every
 * user-access session of `userId` issued before it is revoked (the session
 * middleware). Epochs that can no longer reject anything are dropped in
 * the same write ({@link pruneUserEpochs}). Idempotent.
 *
 * @param {string} userId the directory's id of the user
 * @returns {Promise<number>} The new epoch (Unix seconds)
 */
export function bumpUserEpoch(userId) {
  if (!isIdentityUuid(userId)) throw new Error('A session epoch is keyed by a directory user id');
  if (config === null) throw new Error('Config not loaded. Call loadConfig() first.');
  return withConfigLock(async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const next = structuredClone(config);
    next.userEpochs = { ...pruneUserEpochs(next.userEpochs, nowSeconds), [userId]: nowSeconds };
    const validated = ConfigSchema.parse(next);
    await persistConfig(validated);
    config = validated;
    return nowSeconds;
  });
}

export function getConfigPath() {
  return configPath ?? resolveConfigPath();
}
