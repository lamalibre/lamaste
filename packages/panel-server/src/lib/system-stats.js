import si from 'systeminformation';

let cachedStats = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 2000;

/**
 * Retrieve system stats with a 2-second cache to avoid
 * hammering the system when multiple clients poll simultaneously.
 */
export async function getSystemStats(logger) {
  const now = Date.now();

  if (cachedStats && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedStats;
  }

  try {
    const [currentLoad, cpu, mem, fsSizes, time] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      Promise.resolve(si.time()),
    ]);

    // Find root filesystem (or first available)
    const rootFs = fsSizes.find((fs) => fs.mount === '/') || fsSizes[0] || {};

    const stats = {
      cpu: {
        usage: Math.round(currentLoad.currentLoad * 10) / 10,
        cores: cpu.cores,
      },
      memory: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
      },
      disk: {
        total: rootFs.size || 0,
        used: rootFs.used || 0,
        free: (rootFs.size || 0) - (rootFs.used || 0),
      },
      uptime: time.uptime,
    };

    cachedStats = stats;
    cacheTimestamp = now;

    return stats;
  } catch (err) {
    if (logger) {
      logger.error({ err }, 'Failed to retrieve system stats');
    }
    throw new Error('Failed to retrieve system stats');
  }
}
