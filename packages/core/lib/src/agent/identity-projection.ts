/**
 * The identity projection — an agent half's copy of its plugin's audience,
 * kept in the agent half's own SQLite database from the panel's feed
 * (`identity.ts`), so the plugin can join its history to its users, show
 * their names, and check their roles without asking anyone.
 *
 * Two tables, created when missing and never migrated through the
 * database's `user_version`, which stays the plugin's own:
 *
 * - `lamaste_users` — one row per user the feed ever named: the declared
 *   attributes it last carried, the roles (JSON), `active`, `disabled` or
 *   `removed` with the reason and time, `erased_at`, the record's version,
 *   and the replay pass that last mentioned it (`seen_pass`);
 * - `lamaste_identity_cursor` — one row: the directory the projection
 *   follows and the `seq` it has applied up to.
 *
 * A batch and the cursor it moves to are written in one `BEGIN IMMEDIATE`
 * transaction, so a crash leaves the projection at the batch before or the
 * batch after, never between. A batch that does not continue from the
 * cursor — another `from`, or another directory without `reset` — is
 * refused with {@link IdentityCursorConflictError}, which carries what the
 * projection holds so the panel can continue from there.
 *
 * Removal keeps history readable: a user who was deleted or lost the
 * plugin keeps their row — the last known declared attributes, no roles,
 * `removed` — while an erased user is scrubbed to the bare `userId`, and
 * the plugin's `onErase` anonymises its own data in the same transaction:
 * the cursor passing the erasure is the acknowledgement the panel waits
 * for.
 *
 * **An erasure is sticky.** Once a row carries `erased_at`, nothing the
 * feed sends brings the user back: a later `upsert`, or a `remove` with
 * `deleted` or `unentitled` and its `last` attributes — what a relay
 * restored from a backup taken before the erasure would replay — leaves the
 * row scrubbed (`removed`, reason `erased`, no username, name, address or
 * roles), calls no hook, and counts as a mismatch in a reconcile: the panel
 * contradicted an erasure the half already performed. A user id is never
 * reused, so an erased id is never a new member.
 *
 * The database is anything shaped like `node:sqlite`'s `DatabaseSync`
 * ({@link IdentityProjectionDatabase}); this module does not load
 * `node:sqlite` itself.
 */

import {
  AUDIENCE_REMOVE_REASONS,
  IDENTITY_PROTOCOL_VERSION,
  parseIdentityChangesRequest,
} from '../identity.js';
import type {
  AudienceChange,
  AudienceRemoveReason,
  IdentityChangesAnswer,
  IdentityChangesRequest,
} from '../identity.js';

/** A value a statement binds. */
export type IdentitySqlValue = string | number | null;

/** A prepared statement, as `node:sqlite`'s `StatementSync` offers it. */
export interface IdentityProjectionStatement {
  run(...params: IdentitySqlValue[]): unknown;
  get(...params: IdentitySqlValue[]): unknown;
  all(...params: IdentitySqlValue[]): unknown[];
}

/** The database the projection lives in: `node:sqlite`'s `DatabaseSync`, or anything alike. */
export interface IdentityProjectionDatabase {
  exec(sql: string): void;
  prepare(sql: string): IdentityProjectionStatement;
}

export type ProjectedUserStatus = 'active' | 'disabled' | 'removed';

/** A user as the projection holds them. */
export interface ProjectedUser {
  readonly userId: string;
  /** Null once erased. */
  readonly username: string | null;
  /** Null when the plugin does not declare it, the directory has none, or the user was erased. */
  readonly displayName: string | null;
  readonly email: string | null;
  /** The user's roles in this plugin; none once removed. */
  readonly roles: readonly string[];
  readonly status: ProjectedUserStatus;
  readonly removedReason: AudienceRemoveReason | null;
  /** When the user stopped being a member (ISO 8601); null for a member. */
  readonly removedAt: string | null;
  /** When the row was scrubbed (ISO 8601); null unless erased. */
  readonly erasedAt: string | null;
  /** The directory record's version; 0 for a user the feed only ever named as removed. */
  readonly version: number;
  /** When the row last changed (ISO 8601). */
  readonly updatedAt: string;
}

/** What the projection follows, and how far. */
export interface IdentityProjectionState {
  /** The panel's directory; null until the first batch. */
  readonly directoryId: string | null;
  /** The `seq` applied up to; 0 until the first batch. */
  readonly cursor: number;
}

/**
 * A batch that does not continue from the projection's cursor, or is for
 * another directory without `reset`. Carries what the projection holds.
 */
export class IdentityCursorConflictError extends Error {
  readonly directoryId: string | null;
  readonly cursor: number;

  constructor(state: IdentityProjectionState) {
    super(`The identity batch does not continue from the projection's cursor (${state.cursor})`);
    this.name = 'IdentityCursorConflictError';
    this.directoryId = state.directoryId;
    this.cursor = state.cursor;
  }
}

export interface IdentityProjectionOptions {
  readonly db: IdentityProjectionDatabase;
  /**
   * A change made a user's row a member's (new, or any field different) —
   * the row as written.
   */
  readonly onUpsert?: ((user: ProjectedUser, db: IdentityProjectionDatabase) => void) | undefined;
  /**
   * A change, or the final batch of a replay, made a user's row a removed
   * one (or changed a removed row) — the row as written, and why.
   */
  readonly onRemove?:
    | ((user: ProjectedUser, reason: AudienceRemoveReason, db: IdentityProjectionDatabase) => void)
    | undefined;
  /**
   * Anonymise everything the plugin keeps about `userId`. Called for every
   * `erased` change a batch carries, after the row was scrubbed — replays
   * repeat it (the daily reconcile replays every erasure), so it must be
   * idempotent; that is also how an erasure reaches data restored from a
   * backup taken before it — and whenever an erased row is found holding
   * anything but its id and is scrubbed again. An erased row never reaches
   * `onUpsert` or `onRemove`: erasure is sticky (see the module comment).
   */
  readonly onErase?: ((userId: string, db: IdentityProjectionDatabase) => void) | undefined;
}

/**
 * Every hook runs inside the batch's transaction, on `db`, and must be
 * synchronous: work it awaited would run after the commit, outside the
 * transaction. A hook that throws rolls the whole batch back — the cursor
 * does not move, and the panel sends the batch again.
 */
export interface IdentityProjection {
  /** What the projection follows, and how far — the answer to a notification. */
  state(): IdentityProjectionState;
  /**
   * Apply one batch (`POST /admin/identity/changes`) and move the cursor to
   * its `to`, in one transaction. Throws {@link IdentityCursorConflictError}
   * when the batch does not continue from the cursor, a `TypeError` when it
   * is not a batch, and whatever a hook or the database threw — the
   * projection unchanged in every case.
   */
  applyBatch(request: IdentityChangesRequest): IdentityChangesAnswer;
  /** One user, removed ones included; null when the feed never named them. */
  getUser(userId: string): ProjectedUser | null;
  /** The members (or every user, with `includeRemoved`), by username, erased rows last. */
  listUsers(opts?: { readonly includeRemoved?: boolean | undefined }): ProjectedUser[];
}

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS lamaste_users (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  email TEXT,
  roles TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'removed')),
  removed_reason TEXT,
  removed_at TEXT,
  erased_at TEXT,
  version INTEGER NOT NULL,
  seen_pass TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lamaste_identity_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  directory_id TEXT,
  cursor INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const USER_COLUMNS = `user_id, username, display_name, email, roles, status, removed_reason,
  removed_at, erased_at, version, seen_pass, updated_at`;

const STATUSES: readonly ProjectedUserStatus[] = ['active', 'disabled', 'removed'];

/** A stored row, and the replay pass that last mentioned it. */
interface StoredUser {
  readonly user: ProjectedUser;
  readonly seenPass: string | null;
}

function corrupt(column: string): Error {
  // Never the value: a row holds personal data.
  return new Error(`The identity projection holds a malformed row (column ${column})`);
}

function recordOf(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw corrupt('*');
  return raw as Record<string, unknown>;
}

function textOrNull(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw corrupt(column);
  return value;
}

function text(row: Record<string, unknown>, column: string): string {
  const value = textOrNull(row, column);
  if (value === null) throw corrupt(column);
  return value;
}

function integer(row: Record<string, unknown>, column: string): number {
  const value = row[column];
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw corrupt(column);
  return n;
}

function rolesOf(row: Record<string, unknown>): string[] {
  let roles: unknown;
  try {
    roles = JSON.parse(text(row, 'roles'));
  } catch {
    throw corrupt('roles');
  }
  if (!Array.isArray(roles) || !roles.every((r) => typeof r === 'string')) throw corrupt('roles');
  return roles as string[];
}

function storedUserOf(raw: unknown): StoredUser {
  const row = recordOf(raw);
  const status = text(row, 'status');
  const reason = textOrNull(row, 'removed_reason');
  if (!(STATUSES as readonly string[]).includes(status)) throw corrupt('status');
  if (reason !== null && !(AUDIENCE_REMOVE_REASONS as readonly string[]).includes(reason)) {
    throw corrupt('removed_reason');
  }
  return {
    user: {
      userId: text(row, 'user_id'),
      username: textOrNull(row, 'username'),
      displayName: textOrNull(row, 'display_name'),
      email: textOrNull(row, 'email'),
      roles: rolesOf(row),
      status: status as ProjectedUserStatus,
      removedReason: reason as AudienceRemoveReason | null,
      removedAt: textOrNull(row, 'removed_at'),
      erasedAt: textOrNull(row, 'erased_at'),
      version: integer(row, 'version'),
      updatedAt: text(row, 'updated_at'),
    },
    seenPass: textOrNull(row, 'seen_pass'),
  };
}

/** Roles as stored: sorted, each once. */
function canonicalRoles(roles: readonly string[]): string[] {
  return [...new Set(roles)].sort();
}

/** Whether two rows say the same about a user (times aside). */
function sameUser(a: ProjectedUser, b: ProjectedUser): boolean {
  return (
    a.username === b.username &&
    a.displayName === b.displayName &&
    a.email === b.email &&
    JSON.stringify(a.roles) === JSON.stringify(b.roles) &&
    a.status === b.status &&
    a.removedReason === b.removedReason &&
    a.version === b.version
  );
}

/** The row an `upsert` makes: the member as the feed carries it (never for an erased row). */
function upsertedRow(
  change: Extract<AudienceChange, { kind: 'upsert' }>,
  now: string,
): ProjectedUser {
  const { member } = change;
  return {
    userId: member.userId,
    username: member.username,
    displayName: member.displayName ?? null,
    email: member.email ?? null,
    roles: canonicalRoles(member.roles),
    status: member.status,
    removedReason: null,
    removedAt: null,
    erasedAt: null,
    version: member.version,
    updatedAt: now,
  };
}

/**
 * An erased row: the bare id, `removed` for reason `erased`, the time the
 * user stopped being a member and the time of the erasure (both kept from
 * `stored` when it has them) and the last member version.
 */
function erasedRow(userId: string, stored: ProjectedUser | null, now: string): ProjectedUser {
  return {
    userId,
    username: null,
    displayName: null,
    email: null,
    roles: [],
    status: 'removed',
    removedReason: 'erased',
    removedAt: stored?.removedAt ?? now,
    erasedAt: stored?.erasedAt ?? now,
    version: stored?.version ?? 0,
    updatedAt: now,
  };
}

/**
 * The row a `remove` makes: no roles, `removed`, the reason, and the time
 * the user stopped being a member (kept from an earlier removal). `deleted`
 * and `unentitled` keep the last known declared attributes; `erased` keeps
 * nothing but the id (never for an erased row).
 */
function removedRow(
  change: Extract<AudienceChange, { kind: 'remove' }>,
  stored: ProjectedUser | null,
  now: string,
): ProjectedUser {
  if (change.reason === 'erased') return erasedRow(change.userId, stored, now);
  const last = change.last;
  return {
    userId: change.userId,
    username: last?.username ?? null,
    displayName: last?.displayName ?? null,
    email: last?.email ?? null,
    roles: [],
    status: 'removed',
    removedReason: change.reason,
    removedAt: stored?.removedAt ?? now,
    erasedAt: null,
    version: stored?.version ?? 0,
    updatedAt: now,
  };
}

/** Refuse a hook that returned a promise: its work would escape the transaction. */
function synchronous(result: unknown): void {
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    throw new TypeError(
      "An identity projection hook must be synchronous: it runs inside the batch's transaction",
    );
  }
}

/**
 * The projection over `db` — creating its two tables when missing. The
 * hooks let the plugin follow along in its own tables, inside the same
 * transaction ({@link IdentityProjection}).
 */
export function createIdentityProjection(opts: IdentityProjectionOptions): IdentityProjection {
  const { db } = opts;
  db.exec(CREATE_TABLES);

  const selectUser = db.prepare(`SELECT ${USER_COLUMNS} FROM lamaste_users WHERE user_id = ?`);
  const insertUser = db.prepare(
    `INSERT INTO lamaste_users (${USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Rows are only ever updated in place, never replaced: a plugin's foreign
  // keys to lamaste_users must not see a delete.
  const updateUser = db.prepare(
    `UPDATE lamaste_users SET username = ?, display_name = ?, email = ?, roles = ?, status = ?,
       removed_reason = ?, removed_at = ?, erased_at = ?, version = ?, seen_pass = ?, updated_at = ?
     WHERE user_id = ?`,
  );
  const stampUser = db.prepare('UPDATE lamaste_users SET seen_pass = ? WHERE user_id = ?');
  const selectUnseen = db.prepare(
    `SELECT ${USER_COLUMNS} FROM lamaste_users
     WHERE status <> 'removed' AND (seen_pass IS NULL OR seen_pass <> ?)`,
  );
  const selectUsers = db.prepare(
    `SELECT ${USER_COLUMNS} FROM lamaste_users
     WHERE ? = 1 OR status <> 'removed'
     ORDER BY username IS NULL, username, user_id`,
  );
  const selectCursor = db.prepare(
    'SELECT directory_id, cursor FROM lamaste_identity_cursor WHERE id = 1',
  );
  const upsertCursor = db.prepare(
    `INSERT INTO lamaste_identity_cursor (id, directory_id, cursor, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       directory_id = excluded.directory_id, cursor = excluded.cursor, updated_at = excluded.updated_at`,
  );

  function readState(): IdentityProjectionState {
    const raw = selectCursor.get();
    if (raw === undefined || raw === null) return { directoryId: null, cursor: 0 };
    const row = recordOf(raw);
    return { directoryId: textOrNull(row, 'directory_id'), cursor: integer(row, 'cursor') };
  }

  function readUser(userId: string): StoredUser | null {
    const raw = selectUser.get(userId);
    return raw === undefined || raw === null ? null : storedUserOf(raw);
  }

  function writeUser(user: ProjectedUser, seenPass: string | null, exists: boolean): void {
    const values: IdentitySqlValue[] = [
      user.username,
      user.displayName,
      user.email,
      JSON.stringify(user.roles),
      user.status,
      user.removedReason,
      user.removedAt,
      user.erasedAt,
      user.version,
      seenPass,
      user.updatedAt,
    ];
    if (exists) updateUser.run(...values, user.userId);
    else insertUser.run(user.userId, ...values);
  }

  function apply(request: IdentityChangesRequest, now: string): IdentityChangesAnswer {
    const current = readState();
    if (
      !request.reset &&
      (current.directoryId !== request.directoryId || current.cursor !== request.from)
    ) {
      throw new IdentityCursorConflictError(current);
    }
    // A replay (reset or reconcile) stamps every row it mentions with its
    // pass, so its final batch can tell the rows it did not mention.
    const stamping = request.reset || request.reconcile;
    let mismatches = 0;

    for (const change of request.changes) {
      const userId = change.kind === 'upsert' ? change.member.userId : change.userId;
      const erasure = change.kind === 'remove' && change.reason === 'erased';
      const stored = readUser(userId);
      if (stored !== null && stored.user.erasedAt !== null) {
        // Sticky: an erased row stays the bare id whatever the change says
        // (scrubbed again should it hold anything else).
        const next = erasedRow(userId, stored.user, now);
        const scrubbed = !sameUser(stored.user, next);
        if (scrubbed) writeUser(next, stamping ? request.pass : stored.seenPass, true);
        else if (stamping && stored.seenPass !== request.pass) stampUser.run(request.pass, userId);
        // Anything but the erasure itself contradicts it.
        if (request.reconcile && (scrubbed || !erasure)) mismatches += 1;
        if (erasure || scrubbed) synchronous(opts.onErase?.(userId, db));
        continue;
      }
      const next =
        change.kind === 'upsert'
          ? upsertedRow(change, now)
          : removedRow(change, stored?.user ?? null, now);
      const changed = stored === null || !sameUser(stored.user, next);
      if (changed) {
        writeUser(next, stamping ? request.pass : (stored?.seenPass ?? null), stored !== null);
        if (request.reconcile) mismatches += 1;
        if (change.kind === 'upsert') synchronous(opts.onUpsert?.(next, db));
        else synchronous(opts.onRemove?.(next, change.reason, db));
      } else if (stamping && stored.seenPass !== request.pass) {
        stampUser.run(request.pass, userId);
      }
      if (erasure) synchronous(opts.onErase?.(userId, db));
    }

    if (request.final && stamping) {
      // The pass named every member the directory has; anyone else still
      // listed as one is not.
      for (const raw of selectUnseen.all(request.pass)) {
        const stored = storedUserOf(raw);
        mismatches += 1;
        if (stored.user.erasedAt !== null) {
          // Erased, yet listed as a member: scrubbed again.
          writeUser(erasedRow(stored.user.userId, stored.user, now), stored.seenPass, true);
          synchronous(opts.onErase?.(stored.user.userId, db));
          continue;
        }
        const removed: ProjectedUser = {
          ...stored.user,
          roles: [],
          status: 'removed',
          removedReason: 'deleted',
          removedAt: stored.user.removedAt ?? now,
          updatedAt: now,
        };
        writeUser(removed, stored.seenPass, true);
        synchronous(opts.onRemove?.(removed, 'deleted', db));
      }
    }

    upsertCursor.run(request.directoryId, request.to, now);
    return {
      protocol: IDENTITY_PROTOCOL_VERSION,
      directoryId: request.directoryId,
      cursor: request.to,
      ...(stamping ? { mismatches } : {}),
    };
  }

  return {
    state: readState,

    applyBatch(input) {
      const request = parseIdentityChangesRequest(input);
      if (!request) throw new TypeError('Not an identity batch');
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        const answer = apply(request, now);
        db.exec('COMMIT');
        return answer;
      } catch (err: unknown) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // SQLite already rolled back (some errors end the transaction).
        }
        throw err;
      }
    },

    getUser(userId) {
      return readUser(userId)?.user ?? null;
    },

    listUsers(listOpts = {}) {
      return selectUsers
        .all(listOpts.includeRemoved === true ? 1 : 0)
        .map((raw) => storedUserOf(raw).user);
    },
  };
}
