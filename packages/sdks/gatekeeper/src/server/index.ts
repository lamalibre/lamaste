import '../boot.js';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  atomicWriteJSON,
  createRelaySigner,
  DOMAINS_PROJECTION_FILE,
  indexDomainsProjection,
  logRequestMetadata,
  parseDomainsProjection,
  RELAY_SIGNING_KEY_FILE,
  userSurfaceHosts,
} from '@lamalibre/lamaste';
import type { DomainsIndex, RelaySigner, UserSurfaceHost } from '@lamalibre/lamaste';
import {
  DEFAULT_DATA_DIR,
  GROUPS_FILE,
  GRANTS_FILE,
  SETTINGS_FILE,
  SITES_FILE,
  TUNNELS_FILE,
  GATEKEEPER_PORT,
  SESSION_CACHE_TTL_MS,
} from '../lib/constants.js';
import type { TunnelInfo, GatekeeperSettings, AutheliaSession } from '../lib/types.js';
import { registerCacheInvalidator } from '../lib/cache-bust.js';
import { tunnelInfoFromState } from '../lib/tunnels.js';
import { authzRoutes } from './routes/authz.js';
import { groupRoutes } from './routes/groups.js';
import { grantRoutes } from './routes/grants.js';
import { diagnosticRoutes } from './routes/diagnostic.js';
import { accessRequestRoutes } from './routes/access-request.js';
import { principalRoutes } from './routes/principals.js';
import { secretMatches } from '../lib/secret.js';

const dataDir = process.env.LAMALIBRE_LAMASTE_DATA_DIR ?? DEFAULT_DATA_DIR;
const tunnelsPath = path.join(dataDir, TUNNELS_FILE);
const sitesPath = path.join(dataDir, SITES_FILE);
const settingsPath = path.join(dataDir, SETTINGS_FILE);
const domainsPath = path.join(dataDir, DOMAINS_PROJECTION_FILE);

/**
 * The relay's assertion signing key, created by the panel (never here). A
 * plugin tunnel's user is vouched for to the agent with it, and a user on a
 * plugin's user surface to the panel; the file is re-read when it changes.
 */
const relaySigner = createRelaySigner(path.join(dataDir, RELAY_SIGNING_KEY_FILE), {
  create: false,
});

// ---------------------------------------------------------------------------
// In-memory caches (refreshed by file watch + TTL)
// ---------------------------------------------------------------------------

/** Tunnel info cache (refreshed on file change) */
let tunnelsCache: TunnelInfo[] = [];

/** The hosts serving plugins' user surfaces, from tunnels.json and sites.json (refreshed on either's change) */
let userSurfaceHostsCache: UserSurfaceHost[] = [];

/** Gatekeeper settings cache */
let settingsCache: GatekeeperSettings = {};

/**
 * The domains and their members, as the panel last wrote them
 * (`domains.json`), indexed for lookups; null while it is missing or not a
 * projection — every authorization is refused then.
 */
let domainsCache: DomainsIndex | null = null;

/** Authelia session cache: cookie hash → session data */
const sessionCache = new Map<string, AutheliaSession>();

/** Cache version counter — incremented on cache bust */
let cacheVersion = 0;

// ---------------------------------------------------------------------------
// File loaders
// ---------------------------------------------------------------------------

/** A state file of the panel's, parsed; null when it is missing or unreadable (no entries). */
async function readStateFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * Re-read tunnels.json and sites.json and rebuild what Gatekeeper derives
 * from them: the tunnels, and the hosts serving user surfaces — which
 * depend on both files (a site's route is served while the tunnels say its
 * plugin is hosted).
 */
async function loadHostState(): Promise<void> {
  const [tunnels, sites] = await Promise.all([
    readStateFile(tunnelsPath),
    readStateFile(sitesPath),
  ]);
  tunnelsCache = tunnelInfoFromState(tunnels);
  // The panel's own reading of both files (core), so both decide alike.
  userSurfaceHostsCache = userSurfaceHosts(tunnels, sites);
}

/** How often `domains.json` is read again whatever the watcher saw. */
const DOMAINS_RELOAD_INTERVAL_MS = 60_000;

async function loadDomains(): Promise<void> {
  const projection = parseDomainsProjection(await readStateFile(domainsPath));
  domainsCache = projection ? indexDomainsProjection(projection) : null;
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
    // Fastify's own request lines carry every URL (a tunnel's hostname, a
    // diagnostic query naming a user) — one metadata line per request
    // replaces them (below). Every caller is local (nginx, the panel): no
    // client address is logged.
    disableRequestLogging: true,
    // Forwarding headers are honoured only from loopback: the gatekeeper
    // listens on 127.0.0.1 and its callers (nginx, the panel proxy) are
    // local. Trust by address, not hop count — a hop count cannot tell a
    // proxy from a direct client spoofing X-Forwarded-*. nginx sets
    // X-Forwarded-For to `$remote_addr` on every authorization subrequest,
    // so there `request.ip` is the browser's address as nginx accepted it.
    trustProxy: '127.0.0.1',
  });

  // Method, route pattern, status and duration: never a URL or an address.
  logRequestMetadata(server);

  // Global rate limit, for the management API and health: reached only by
  // the panel proxy and local tooling, every caller from 127.0.0.1 — one
  // shared bucket with a high ceiling. The authorization routes nginx calls
  // on every protected request override it with buckets per client address
  // and tunnel host (`authzRoutes`), so one client cannot starve the rest.
  await server.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    keyGenerator: () => 'gatekeeper-internal',
  });

  // Load initial state
  await loadHostState();
  await loadDomains();
  settingsCache = await loadSettings();

  // Decorate server with shared state accessors
  server.decorate('getTunnels', () => tunnelsCache);
  server.decorate('getUserSurfaceHosts', () => userSurfaceHostsCache);
  server.decorate('getDomains', () => domainsCache);
  server.decorate('getSettings', () => settingsCache);
  server.decorate('getSessionCache', () => sessionCache);
  server.decorate('getCacheVersion', () => cacheVersion);
  server.decorate('getRelaySigner', () => relaySigner);
  const bustCache = (): void => {
    cacheVersion++;
    sessionCache.clear();
  };
  server.decorate('bustCache', bustCache);
  server.decorate('reloadDomains', loadDomains);
  registerCacheInvalidator(bustCache);
  server.decorate('updateSettings', (s: GatekeeperSettings) => {
    settingsCache = s;
  });

  // Watch state files for changes
  watchFile(tunnelsPath, loadHostState, server.log);
  watchFile(sitesPath, loadHostState, server.log);
  watchFile(domainsPath, loadDomains, server.log);
  // A watch event can be missed, and the panel never rewrites an unchanged
  // projection: read it again every minute too (and on every cache bust —
  // the panel busts after each membership change).
  const domainsTimer = setInterval(() => {
    loadDomains().catch((err: unknown) =>
      server.log.warn({ err: (err as Error).message }, 'Could not reload domains.json'),
    );
  }, DOMAINS_RELOAD_INTERVAL_MS);
  domainsTimer.unref();
  server.addHook('onClose', async () => clearInterval(domainsTimer));

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
      if (!secretMatches(auth, apiSecret)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    await scope.register(groupRoutes, { prefix: '/api' });
    await scope.register(grantRoutes, { prefix: '/api' });
    await scope.register(principalRoutes, { prefix: '/api' });
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
    getUserSurfaceHosts(): UserSurfaceHost[];
    /** The domains and their members (`domains.json`); null: refuse everyone. */
    getDomains(): DomainsIndex | null;
    getSettings(): GatekeeperSettings;
    getSessionCache(): Map<string, AutheliaSession>;
    getCacheVersion(): number;
    getRelaySigner(): RelaySigner;
    bustCache(): void;
    /** Read `domains.json` again now. */
    reloadDomains(): Promise<void>;
    updateSettings(s: GatekeeperSettings): void;
  }
}
