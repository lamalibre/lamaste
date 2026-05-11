import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_DATA_DIR } from './constants.js';
import { createGrant } from './grants.js';
import type { GatekeeperLogger } from './types.js';

const dataDir = process.env.LAMALIBRE_LAMASTE_DATA_DIR ?? DEFAULT_DATA_DIR;
const LEGACY_FILE = 'user-plugin-access.json';
const MIGRATED_SUFFIX = '.migrated';

interface LegacyGrant {
  grantId: string;
  username: string;
  pluginName: string;
  target: string;
  used: boolean;
  createdAt: string;
  usedAt: string | null;
}

interface LegacyState {
  grants: LegacyGrant[];
  otpTokens?: unknown[];
}

/**
 * Migrate legacy `user-plugin-access.json` grants to the new
 * `access-grants.json` format. Idempotent — skips if already migrated.
 *
 * Mapping:
 * - username → principalType: 'user', principalId: username
 * - pluginName → resourceType: 'plugin', resourceId: pluginName
 * - target → context: { target }
 *
 * The legacy file is renamed to `.migrated` after successful migration.
 *
 * @param logger - Logger for progress reporting
 * @returns Number of grants migrated
 */
export async function migrateFromLegacy(
  logger?: GatekeeperLogger,
): Promise<number> {
  const legacyPath = path.join(dataDir, LEGACY_FILE);

  let raw: string;
  try {
    raw = await readFile(legacyPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger?.info('No legacy user-plugin-access.json found, skipping migration');
      return 0;
    }
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || !('grants' in parsed)) {
    logger?.warn('Legacy file has unexpected format, skipping migration');
    return 0;
  }

  const legacy = parsed as LegacyState;
  if (!Array.isArray(legacy.grants) || legacy.grants.length === 0) {
    logger?.info('Legacy file has no grants, renaming to .migrated');
    await rename(legacyPath, legacyPath + MIGRATED_SUFFIX);
    return 0;
  }

  let migrated = 0;

  for (const legacyGrant of legacy.grants) {
    try {
      // Preserve consumption state from the legacy file so previously-used
      // local-plugin grants do not become re-usable post-migration.
      await createGrant(
        {
          principalType: 'user',
          principalId: legacyGrant.username,
          resourceType: 'plugin',
          resourceId: legacyGrant.pluginName,
          context: { target: legacyGrant.target },
        },
        {
          used: legacyGrant.used,
          createdAt: legacyGrant.createdAt,
          usedAt: legacyGrant.usedAt,
        },
      );
      migrated++;
    } catch (err: unknown) {
      // Skip duplicates (already migrated or duplicate in source)
      const error = err as Error & { statusCode?: number };
      if (error.statusCode === 409) {
        logger?.info(
          `Skipping duplicate grant for ${legacyGrant.username} → ${legacyGrant.pluginName}`,
        );
        continue;
      }
      throw err;
    }
  }

  // Rename legacy file to mark as migrated
  await rename(legacyPath, legacyPath + MIGRATED_SUFFIX);

  logger?.info(
    { migrated, total: legacy.grants.length },
    `Migrated ${migrated} of ${legacy.grants.length} legacy grants`,
  );

  return migrated;
}
