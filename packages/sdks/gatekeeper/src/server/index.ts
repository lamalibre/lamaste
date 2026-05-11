import '../boot.js';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJSON } from '@lamalibre/lamaste';
import {
  DEFAULT_DATA_DIR,
  GROUPS_FILE,
  GRANTS_FILE,
  SETTINGS_FILE,
  GATEKEEPER_PORT,
  SESSION_CACHE_TTL_MS,
} from '../lib/constants.js';
import type { TunnelInfo, GatekeeperSettings, AutheliaSession } from '../lib/types.js';
import { registerCacheInvalidator } from '../lib/cache-bust.js';
import { authzRoutes } from './routes/authz.js';
import { groupRoutes } from './routes/groups.js';
import { grantRoutes } from './routes/grants.js';
import { diagnosticRoutes } from './routes/diagnostic.js';
import { accessRequestRoutes } from './routes/access-request.js';

const dataDir = process.env.LAMALIBRE_LAMASTE_DATA_DIR ?? DEFAULT_DATA_DIR;
const tunnelsPath = path.join(dataDir, 'tunnels.json');
const settingsPath = path.join(dataDir, SETTINGS_FILE);

// ---------------------------------------------------------------------------
// In-memory caches (refreshed by file watch + TTL)
// ---------------------------------------------------------------------------

/** Tunnel info cache (refreshed on file change) */
let tunnelsCache: TunnelInfo[] = [];

/** Gatekeeper settings cache */
let settingsCache: GatekeeperSettings = {};

/** Authelia session cache: cookie hash → session data */
const sessionCache = new Map<string, AutheliaSession>();

/** Cache version counter — incremented on cache bust */
let cacheVersion = 0;

// ---------------------------------------------------------------------------
// File loaders
// ---------------------------------------------------------------------------

async function loadTunnels(): Promise<TunnelInfo[]> {
  try {
    const raw = await readFile(tunnelsPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t: Record<string, unknown>) => ({
      id: String(t.id ?? ''),
      fqdn: String(t.fqdn ?? ''),
      accessMode: (t.accessMode as TunnelInfo['accessMode']) ?? 'restricted',
      enabled: t.enabled !== false,
    }));
  } catch {
    return [];
  }
}

async function loadSettings(): Promise<GatekeeperSettings> {
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as GatekeeperSettings;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// File watcher with debounce
// ---------------------------------------------------------------------------

/**
 * One directory watcher per parent directory, multiplexed by filename.
 *
 * We watch the parent directory rather than the file itself because all of our
 * state files (tunnels.json, grants.json, groups.json, gatekeeper.json) are
 * updated via atomic rename (temp → fsync → rename). A direct `fs.watch` on
 * the file is pinned to the original inode, and the rename swaps that inode
 * out — leaving the watcher silently attached to a file that no longer has a
 * name. Watching the directory survives renames: we receive a `rename` event
 * for the target filename each time a write lands, and re-run the reloader.
 */
const dirWatchers = new Map<string, Map<string, () => void>>();

function watchFile(
  filePath: string,
  reload: () => Promise<void>,
  logger: { info: (msg: string) => void },
): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handler = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      reload().catch(() => {
        // Reload errors are non-fatal — keep using cached data
      });
      logger.info(`Reloaded ${base}`);
    }, 200);
  };

  let handlers = dirWatchers.get(dir);
  if (!handlers) {
    handlers = new Map();
    dirWatchers.set(dir, handlers);
    try {
      watch(dir, (_eventType, filename) => {
        if (!filename) return;
        const cb = handlers!.get(filename);
        if (cb) cb();
      });
    } catch {
      // Parent directory doesn't exist yet — watcher not set up.
      dirWatchers.delete(dir);
      return;
    }
  }
  handlers.set(base, handler);
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

export async function createServer(): Promise<ReturnType<typeof Fastify>> {
  const server = Fastify({
    logger: true,
    trustProxy: 1,
  });

  // Load initial state
  tunnelsCache = await loadTunnels();
  settingsCache = await loadSettings();

  // Decorate server with shared state accessors
  server.decorate('getTunnels', () => tunnelsCache);
  server.decorate('getSettings', () => settingsCache);
  server.decorate('getSessionCache', () => sessionCache);
  server.decorate('getCacheVersion', () => cacheVersion);
  const bustCache = (): void => {
    cacheVersion++;
    sessionCache.clear();
  };
  server.decorate('bustCache', bustCache);
  registerCacheInvalidator(bustCache);
  server.decorate('updateSettings', (s: GatekeeperSettings) => {
    settingsCache = s;
  });

  // Watch state files for changes
  watchFile(
    tunnelsPath,
    async () => {
      tunnelsCache = await loadTunnels();
    },
    server.log,
  );

  // TODO(sqlite-step-4): groups.json and access-grants.json are now
  // .migrated stubs after first SQLite open. These watch registrations stay
  // attached to the old paths so they never fire — every authz read goes
  // through the DB and is always current, but admin grant/group changes do
  // not invalidate the in-memory session cache without a daemon restart.
  // Replace with a DB-modtime sentinel that the writer touches on commit
  // (or polled `PRAGMA data_version`) once Step 4 (rodeo) is green.
  watchFile(
    path.join(dataDir, GROUPS_FILE),
    async () => {
      // Groups are read from SQLite on each call,
      // but clearing session cache ensures authz re-evaluates group membership
      sessionCache.clear();
    },
    server.log,
  );

  watchFile(
    path.join(dataDir, GRANTS_FILE),
    async () => {
      // Same — clear session cache so authz picks up grant changes
      sessionCache.clear();
    },
    server.log,
  );

  watchFile(
    settingsPath,
    async () => {
      settingsCache = await loadSettings();
    },
    server.log,
  );

  // Load or generate API secret for localhost management auth.
  // The secret is wrapped in a JSON envelope and written atomically so a
  // crash during initial generation never leaves a half-written file
  // (which the next start would treat as "no secret yet" and rotate, breaking
  // any external client holding the previous value).
  const secretPath = path.join(dataDir, 'gatekeeper-secret.json');
  const legacySecretPath = path.join(dataDir, 'gatekeeper-secret');
  let apiSecret: string;
  try {
    const raw = await readFile(secretPath, 'utf-8');
    const parsed = JSON.parse(raw) as { secret?: unknown };
    if (typeof parsed.secret !== 'string' || parsed.secret.length === 0) {
      throw new Error('gatekeeper-secret.json is missing the "secret" field');
    }
    apiSecret = parsed.secret;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Existing file is corrupt — refuse to rotate silently. An operator must
      // resolve this so external callers do not lose their pinned secret.
      throw err;
    }
    // First-run path: try migrating the legacy plaintext file before generating.
    try {
      const legacy = (await readFile(legacySecretPath, 'utf-8')).trim();
      if (legacy.length > 0) {
        apiSecret = legacy;
        await atomicWriteJSON(secretPath, { secret: apiSecret }, { mkdirp: true });
        server.log.info('Migrated legacy gatekeeper-secret file to JSON envelope');
      } else {
        throw new Error('legacy gatekeeper-secret was empty');
      }
    } catch {
      apiSecret = crypto.randomBytes(32).toString('hex');
      await atomicWriteJSON(secretPath, { secret: apiSecret }, { mkdirp: true });
      server.log.info('Generated new gatekeeper API secret');
    }
  }

  // Register routes — authz, access-request, and health are public (nginx subrequests)
  await server.register(authzRoutes);
  await server.register(accessRequestRoutes);

  // Management /api/* routes require the shared secret
  await server.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      const auth = request.headers['x-gatekeeper-secret'];
      if (auth !== apiSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    await scope.register(groupRoutes, { prefix: '/api' });
    await scope.register(grantRoutes, { prefix: '/api' });
    await scope.register(diagnosticRoutes, { prefix: '/api' });
  });

  // Health endpoint
  server.get('/health', async () => ({ status: 'ok' }));

  return server;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  const server = await createServer();

  await server.listen({
    host: '127.0.0.1',
    port: GATEKEEPER_PORT,
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    server.log.info({ signal }, 'Received signal, shutting down gracefully');
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start gatekeeper:', err);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Fastify type augmentation
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    getTunnels(): TunnelInfo[];
    getSettings(): GatekeeperSettings;
    getSessionCache(): Map<string, AutheliaSession>;
    getCacheVersion(): number;
    bustCache(): void;
    updateSettings(s: GatekeeperSettings): void;
  }
}
