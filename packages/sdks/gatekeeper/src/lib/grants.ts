import crypto from 'node:crypto';
import { PromiseChainMutex } from '@lamalibre/lamaste';
import {
  MAX_GRANTS,
  GRANT_RETENTION_MS,
} from './constants.js';
import { notifyCacheInvalidated } from './cache-bust.js';
import { getGatekeeperDb } from './state-db.js';
import type { StatementSync } from 'node:sqlite';
import type {
  Grant,
  GrantState,
  CreateGrantOptions,
  GrantFilter,
} from './types.js';
import type { PrincipalType } from './constants.js';

// ---------------------------------------------------------------------------
// Promise-chain mutex (preserved from JSON era)
//
// SQLite's BEGIN IMMEDIATE serialises writers, but several public exports
// (createGrant with prune, consumeGrant with belongs-to check) are
// read-modify-write sequences whose JSON-era atomicity came from this lock.
// Drop as a follow-up after Step 4 (rodeo) lands.
// ---------------------------------------------------------------------------

const grantMutex = new PromiseChainMutex();

function withGrantLock<T>(fn: () => Promise<T>): Promise<T> {
  return grantMutex.run(fn);
}

// ---------------------------------------------------------------------------
// SQLite prepared-statement bundle (lazy init)
// ---------------------------------------------------------------------------

interface GrantStmts {
  selectAll: StatementSync;
  selectById: StatementSync;
  countAll: StatementSync;
  insert: StatementSync;
  markUsed: StatementSync;
  deleteById: StatementSync;
  deleteConsumedBefore: StatementSync;
  begin: StatementSync;
  commit: StatementSync;
  rollback: StatementSync;
}

let stmts: GrantStmts | null = null;

async function getStmts(): Promise<GrantStmts> {
  if (stmts) return stmts;

  const db = await getGatekeeperDb();

  stmts = {
    selectAll: db.prepare('SELECT * FROM access_grants ORDER BY created_at'),
    selectById: db.prepare('SELECT * FROM access_grants WHERE grant_id = ?'),
    countAll: db.prepare('SELECT COUNT(*) AS n FROM access_grants'),
    insert: db.prepare(`
      INSERT INTO access_grants
        (grant_id, principal_type, principal_id, resource_type, resource_id, context, used, created_at, used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    markUsed: db.prepare(
      'UPDATE access_grants SET used = 1, used_at = ? WHERE grant_id = ?',
    ),
    deleteById: db.prepare('DELETE FROM access_grants WHERE grant_id = ?'),
    // Retention sweep: prune consumed grants past GRANT_RETENTION_MS. The
    // matching index (idx_grants_used_used_at) covers the predicate.
    deleteConsumedBefore: db.prepare(
      'DELETE FROM access_grants WHERE used = 1 AND used_at IS NOT NULL AND used_at < ?',
    ),
    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

interface GrantRow {
  grant_id: string;
  principal_type: string;
  principal_id: string;
  resource_type: string;
  resource_id: string;
  context: string;
  used: number;
  created_at: string;
  used_at: string | null;
}

function rowToGrant(row: GrantRow): GrantState {
  return {
    grantId: row.grant_id,
    principalType: row.principal_type as PrincipalType,
    principalId: row.principal_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    context: JSON.parse(row.context) as Record<string, unknown>,
    used: row.used === 1,
    createdAt: row.created_at,
    usedAt: row.used_at,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Prune consumed grants older than the retention period. Replaces the
 * JSON-era `pruneStaleGrants` array filter — the SQL DELETE is now driven
 * by `idx_grants_used_used_at`, but the call sites (every write operation)
 * remain the same.
 */
function pruneStaleGrants(s: GrantStmts): void {
  const cutoff = new Date(Date.now() - GRANT_RETENTION_MS).toISOString();
  s.deleteConsumedBefore.run(cutoff);
}

/**
 * Check if a grant should be auto-consumed on creation.
 * Tunnel grants and agent-side plugin grants are auto-consumed.
 * Local plugin grants start unused (consumed on enrollment).
 */
function shouldAutoConsume(options: CreateGrantOptions): boolean {
  if (options.resourceType === 'tunnel') return true;
  if (options.resourceType === 'plugin') {
    const target = (options.context?.['target'] as string) ?? 'local';
    return target.startsWith('agent:');
  }
  return true;
}

/**
 * Check if two grants are duplicates (same principal + resource + context).
 */
function isDuplicate(a: GrantState, b: CreateGrantOptions): boolean {
  if (a.principalType !== b.principalType) return false;
  if (a.principalId !== b.principalId) return false;
  if (a.resourceType !== b.resourceType) return false;
  if (a.resourceId !== b.resourceId) return false;

  const aCtx = JSON.stringify(a.context ?? {});
  const bCtx = JSON.stringify(b.context ?? {});
  return aCtx === bCtx;
}

// ---------------------------------------------------------------------------
// Public API — signatures preserved byte-identical to the JSON-backed version
// ---------------------------------------------------------------------------

export async function createGrant(
  options: CreateGrantOptions,
  initialState?: { used?: boolean; createdAt?: string; usedAt?: string | null },
): Promise<Grant> {
  return withGrantLock(async () => {
    const s = await getStmts();

    // Prune stale grants on every write operation (matches JSON-era cadence).
    pruneStaleGrants(s);

    const countRow = s.countAll.get() as { n: number };
    if (countRow.n >= MAX_GRANTS) {
      throw Object.assign(
        new Error(`Maximum number of grants (${MAX_GRANTS}) reached`),
        { statusCode: 503 },
      );
    }

    // Reject duplicates — same scan as the JSON era over the full table.
    // Index-friendly tightening (e.g. idx_grants_principal + resource pre-
    // filter) is a Step 4+ optimisation; not changing semantics here.
    const allRows = s.selectAll.all() as unknown as GrantRow[];
    const all = allRows.map(rowToGrant);
    if (all.some((g) => isDuplicate(g, options))) {
      throw Object.assign(
        new Error('Duplicate grant: a grant with the same principal, resource, and context already exists'),
        { statusCode: 409 },
      );
    }

    const now = new Date().toISOString();
    const used = initialState?.used ?? shouldAutoConsume(options);
    const createdAt = initialState?.createdAt ?? now;
    const usedAt =
      initialState?.usedAt !== undefined
        ? initialState.usedAt
        : used
          ? now
          : null;

    const grant: GrantState = {
      grantId: crypto.randomUUID(),
      principalType: options.principalType,
      principalId: options.principalId,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      context: options.context ?? {},
      used,
      createdAt,
      usedAt,
    };

    s.begin.run();
    try {
      s.insert.run(
        grant.grantId,
        grant.principalType,
        grant.principalId,
        grant.resourceType,
        grant.resourceId,
        JSON.stringify(grant.context),
        grant.used ? 1 : 0,
        grant.createdAt,
        grant.usedAt,
      );
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return grant;
  });
}

export async function listGrants(filter?: GrantFilter): Promise<readonly Grant[]> {
  const s = await getStmts();
  const rows = s.selectAll.all() as unknown as GrantRow[];
  let grants: GrantState[] = rows.map(rowToGrant);

  if (filter) {
    grants = grants.filter((g) => {
      if (filter.principalType !== undefined && g.principalType !== filter.principalType) return false;
      if (filter.principalId !== undefined && g.principalId !== filter.principalId) return false;
      if (filter.resourceType !== undefined && g.resourceType !== filter.resourceType) return false;
      if (filter.resourceId !== undefined && g.resourceId !== filter.resourceId) return false;
      if (filter.used !== undefined && g.used !== filter.used) return false;
      return true;
    });
  }

  return grants;
}

export async function getGrant(grantId: string): Promise<Grant | null> {
  const s = await getStmts();
  const row = s.selectById.get(grantId) as GrantRow | undefined;
  return row ? rowToGrant(row) : null;
}

export async function revokeGrant(grantId: string): Promise<Grant> {
  return withGrantLock(async () => {
    const s = await getStmts();
    const row = s.selectById.get(grantId) as GrantRow | undefined;
    if (!row) {
      throw Object.assign(
        new Error('Grant not found'),
        { statusCode: 404 },
      );
    }

    const grant = rowToGrant(row);

    // Local plugin grants: only revocable if unused
    if (
      grant.resourceType === 'plugin' &&
      (grant.context?.['target'] as string) === 'local' &&
      grant.used
    ) {
      throw Object.assign(
        new Error('Cannot revoke a consumed local plugin grant'),
        { statusCode: 409 },
      );
    }

    s.begin.run();
    try {
      s.deleteById.run(grantId);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return grant;
  });
}

/**
 * Remove all grants matching a filter predicate.
 * Used by groups.ts for cascading deletes/renames — serialized via grantLock.
 */
export async function removeGrantsByPredicate(
  predicate: (g: GrantState) => boolean,
): Promise<number> {
  return withGrantLock(async () => {
    const s = await getStmts();
    const rows = s.selectAll.all() as unknown as GrantRow[];
    const all = rows.map(rowToGrant);
    const toRemove = all.filter(predicate);

    if (toRemove.length === 0) return 0;

    s.begin.run();
    try {
      for (const g of toRemove) {
        s.deleteById.run(g.grantId);
      }
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return toRemove.length;
  });
}

/**
 * Remove all grants belonging to a specific principal (user or group).
 *
 * Used by the panel server when a user is deleted from Authelia, to cascade
 * the deletion across gatekeeper grants. Serialized via grantLock.
 *
 * @param principalType - 'user' or 'group'
 * @param principalId   - The principal's identifier (username or group name)
 * @returns Number of grants removed
 */
export async function removeGrantsByPrincipal(
  principalType: 'user' | 'group',
  principalId: string,
): Promise<number> {
  return removeGrantsByPredicate(
    (g) => g.principalType === principalType && g.principalId === principalId,
  );
}

/**
 * Update grants matching a filter predicate.
 * Used by groups.ts for cascading renames — serialized via grantLock.
 */
export async function updateGrantsByPredicate(
  predicate: (g: GrantState) => boolean,
  updater: (g: GrantState) => void,
): Promise<number> {
  return withGrantLock(async () => {
    const s = await getStmts();
    const rows = s.selectAll.all() as unknown as GrantRow[];
    const all = rows.map(rowToGrant);

    let updated = 0;
    const mutated: GrantState[] = [];
    for (const grant of all) {
      if (predicate(grant)) {
        updater(grant);
        mutated.push(grant);
        updated++;
      }
    }

    if (updated === 0) return 0;

    s.begin.run();
    try {
      // The legacy updater closure mutates principalId / context fields in
      // place. Persist whatever the closure changed by re-inserting the row
      // (delete + insert keeps the prepared-statement bundle small and
      // avoids needing a generic UPDATE for every column permutation).
      for (const g of mutated) {
        s.deleteById.run(g.grantId);
        s.insert.run(
          g.grantId,
          g.principalType,
          g.principalId,
          g.resourceType,
          g.resourceId,
          JSON.stringify(g.context),
          g.used ? 1 : 0,
          g.createdAt,
          g.usedAt,
        );
      }
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return updated;
  });
}

export async function consumeGrant(
  grantId: string,
  username: string,
): Promise<Grant> {
  return withGrantLock(async () => {
    const s = await getStmts();
    const row = s.selectById.get(grantId) as GrantRow | undefined;
    if (!row) {
      throw Object.assign(
        new Error('Grant not found'),
        { statusCode: 404 },
      );
    }
    const grant = rowToGrant(row);

    if (grant.principalType !== 'user' || grant.principalId !== username) {
      throw Object.assign(
        new Error('Grant does not belong to this user'),
        { statusCode: 403 },
      );
    }

    if (grant.used) {
      throw Object.assign(
        new Error('Grant has already been consumed'),
        { statusCode: 409 },
      );
    }

    const usedAt = new Date().toISOString();
    s.begin.run();
    try {
      s.markUsed.run(usedAt, grantId);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    grant.used = true;
    grant.usedAt = usedAt;
    notifyCacheInvalidated();
    return grant;
  });
}
