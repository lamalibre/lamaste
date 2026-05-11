import { PromiseChainMutex } from '@lamalibre/lamaste';
import {
  RESERVED_GROUP_NAMES,
  MAX_GROUPS,
  MAX_MEMBERS_PER_GROUP,
  GROUP_NAME_REGEX,
  MIN_GROUP_NAME_LENGTH,
  MAX_GROUP_NAME_LENGTH,
} from './constants.js';
import { removeGrantsByPredicate, updateGrantsByPredicate } from './grants.js';
import { notifyCacheInvalidated } from './cache-bust.js';
import { getGatekeeperDb } from './state-db.js';
import type { StatementSync } from 'node:sqlite';
import type {
  Group,
  GroupState,
  CreateGroupOptions,
  UpdateGroupOptions,
  DeleteGroupResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Promise-chain mutex (preserved from JSON era)
//
// SQLite's BEGIN IMMEDIATE already serialises writers, but the existing
// public API exposes a few read-modify-write sequences (e.g. updateGroup
// followed by a cascading grant rename). Keeping the mutex preserves the
// JSON-era atomicity guarantees byte-for-byte during the storage migration.
// Drop as a follow-up after Step 4 (rodeo) lands.
// ---------------------------------------------------------------------------

const groupMutex = new PromiseChainMutex();

function withGroupLock<T>(fn: () => Promise<T>): Promise<T> {
  return groupMutex.run(fn);
}

// ---------------------------------------------------------------------------
// SQLite prepared-statement bundle (lazy init)
// ---------------------------------------------------------------------------

interface GroupStmts {
  selectAll: StatementSync;
  selectByName: StatementSync;
  countAll: StatementSync;
  insert: StatementSync;
  updateDescription: StatementSync;
  updateName: StatementSync;
  updateMembers: StatementSync;
  deleteByName: StatementSync;
  begin: StatementSync;
  commit: StatementSync;
  rollback: StatementSync;
}

let stmts: GroupStmts | null = null;

async function getStmts(): Promise<GroupStmts> {
  if (stmts) return stmts;

  const db = await getGatekeeperDb();

  stmts = {
    selectAll: db.prepare('SELECT * FROM groups ORDER BY created_at'),
    selectByName: db.prepare('SELECT * FROM groups WHERE name = ?'),
    countAll: db.prepare('SELECT COUNT(*) AS n FROM groups'),
    insert: db.prepare(`
      INSERT INTO groups (name, description, members, created_at, created_by)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateDescription: db.prepare('UPDATE groups SET description = ? WHERE name = ?'),
    updateName: db.prepare('UPDATE groups SET name = ? WHERE name = ?'),
    updateMembers: db.prepare('UPDATE groups SET members = ? WHERE name = ?'),
    deleteByName: db.prepare('DELETE FROM groups WHERE name = ?'),
    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };

  return stmts;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

interface GroupRow {
  name: string;
  description: string;
  members: string;
  created_at: string;
  created_by: string;
}

function rowToGroup(row: GroupRow): GroupState {
  return {
    name: row.name,
    description: row.description,
    members: JSON.parse(row.members) as string[],
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateGroupName(name: string): void {
  if (name.length < MIN_GROUP_NAME_LENGTH || name.length > MAX_GROUP_NAME_LENGTH) {
    throw Object.assign(
      new Error(`Group name must be ${MIN_GROUP_NAME_LENGTH}-${MAX_GROUP_NAME_LENGTH} characters`),
      { statusCode: 400 },
    );
  }
  if (!GROUP_NAME_REGEX.test(name)) {
    throw Object.assign(
      new Error(
        'Group name must be lowercase alphanumeric with hyphens, cannot start or end with a hyphen',
      ),
      { statusCode: 400 },
    );
  }
  if ((RESERVED_GROUP_NAMES as readonly string[]).includes(name)) {
    throw Object.assign(new Error(`Group name "${name}" is reserved for Authelia identity tiers`), {
      statusCode: 400,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API — signatures preserved byte-identical to the JSON-backed version
// ---------------------------------------------------------------------------

export async function createGroup(name: string, options: CreateGroupOptions = {}): Promise<Group> {
  validateGroupName(name);

  return withGroupLock(async () => {
    const s = await getStmts();

    const countRow = s.countAll.get() as { n: number };
    if (countRow.n >= MAX_GROUPS) {
      throw Object.assign(new Error(`Maximum number of groups (${MAX_GROUPS}) reached`), {
        statusCode: 503,
      });
    }

    const existing = s.selectByName.get(name) as GroupRow | undefined;
    if (existing) {
      throw Object.assign(new Error(`Group "${name}" already exists`), { statusCode: 409 });
    }

    const group: GroupState = {
      name,
      description: options.description ?? '',
      members: [],
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy ?? 'admin',
    };

    s.begin.run();
    try {
      s.insert.run(
        group.name,
        group.description,
        JSON.stringify(group.members),
        group.createdAt,
        group.createdBy,
      );
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return group;
  });
}

export async function listGroups(): Promise<readonly Group[]> {
  const s = await getStmts();
  const rows = s.selectAll.all() as unknown as GroupRow[];
  return rows.map(rowToGroup);
}

export async function getGroup(name: string): Promise<Group | null> {
  const s = await getStmts();
  const row = s.selectByName.get(name) as GroupRow | undefined;
  return row ? rowToGroup(row) : null;
}

export async function updateGroup(name: string, updates: UpdateGroupOptions): Promise<Group> {
  return withGroupLock(async () => {
    const s = await getStmts();
    const existingRow = s.selectByName.get(name) as GroupRow | undefined;
    if (!existingRow) {
      throw Object.assign(new Error(`Group "${name}" not found`), { statusCode: 404 });
    }
    const group = rowToGroup(existingRow);

    let cascadingRename: string | null = null;

    if (updates.name !== undefined && updates.name !== name) {
      validateGroupName(updates.name);

      const conflict = s.selectByName.get(updates.name) as GroupRow | undefined;
      if (conflict) {
        throw Object.assign(new Error(`Group "${updates.name}" already exists`), {
          statusCode: 409,
        });
      }
      cascadingRename = updates.name;
    }

    if (updates.description !== undefined) {
      group.description = updates.description;
    }

    s.begin.run();
    try {
      if (updates.description !== undefined) {
        s.updateDescription.run(group.description, name);
      }
      if (cascadingRename !== null) {
        s.updateName.run(cascadingRename, name);
        group.name = cascadingRename;
      }
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    if (cascadingRename !== null) {
      // Cascade rename to grants (uses grantLock for safe concurrent access).
      // Runs outside the SQL transaction because grants writes use their own
      // mutex + transaction; nesting them would deadlock.
      const newName = cascadingRename;
      await updateGrantsByPredicate(
        (g) => g.principalType === 'group' && g.principalId === name,
        (g) => {
          g.principalId = newName;
        },
      );
    }

    notifyCacheInvalidated();
    return group;
  });
}

export async function deleteGroup(name: string): Promise<DeleteGroupResult> {
  validateGroupName(name);

  return withGroupLock(async () => {
    const s = await getStmts();
    const existing = s.selectByName.get(name) as GroupRow | undefined;
    if (!existing) {
      throw Object.assign(new Error(`Group "${name}" not found`), { statusCode: 404 });
    }

    s.begin.run();
    try {
      s.deleteByName.run(name);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();

    // Auto-revoke all grants referencing this group (uses grantLock)
    const deletedGrants = await removeGrantsByPredicate(
      (g) => g.principalType === 'group' && g.principalId === name,
    );

    return { deletedGrants };
  });
}

export async function addMembers(groupName: string, usernames: readonly string[]): Promise<Group> {
  return withGroupLock(async () => {
    const s = await getStmts();
    const row = s.selectByName.get(groupName) as GroupRow | undefined;
    if (!row) {
      throw Object.assign(new Error(`Group "${groupName}" not found`), { statusCode: 404 });
    }
    const group = rowToGroup(row);

    for (const username of usernames) {
      if (!group.members.includes(username)) {
        if (group.members.length >= MAX_MEMBERS_PER_GROUP) {
          throw Object.assign(
            new Error(`Maximum members per group (${MAX_MEMBERS_PER_GROUP}) reached`),
            { statusCode: 503 },
          );
        }
        group.members.push(username);
      }
    }

    s.begin.run();
    try {
      s.updateMembers.run(JSON.stringify(group.members), groupName);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return group;
  });
}

export async function removeMembers(
  groupName: string,
  usernames: readonly string[],
): Promise<Group> {
  return withGroupLock(async () => {
    const s = await getStmts();
    const row = s.selectByName.get(groupName) as GroupRow | undefined;
    if (!row) {
      throw Object.assign(new Error(`Group "${groupName}" not found`), { statusCode: 404 });
    }
    const group = rowToGroup(row);

    const removeSet = new Set(usernames);
    group.members = group.members.filter((m) => !removeSet.has(m));

    s.begin.run();
    try {
      s.updateMembers.run(JSON.stringify(group.members), groupName);
      s.commit.run();
    } catch (err) {
      s.rollback.run();
      throw err;
    }

    notifyCacheInvalidated();
    return group;
  });
}

export async function getGroupsForUser(username: string): Promise<readonly string[]> {
  const s = await getStmts();
  const rows = s.selectAll.all() as unknown as GroupRow[];
  return rows
    .map(rowToGroup)
    .filter((g) => g.members.includes(username))
    .map((g) => g.name);
}
