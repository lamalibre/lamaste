/**
 * A user principal as a whole — everything Gatekeeper holds under a
 * username: the grants naming it (any resource type) and its membership of
 * Lamaste groups.
 *
 * Gatekeeper keys users by username, which Authelia lets anyone reuse: a
 * user created later with the same username would inherit every grant and
 * group the earlier one had. The panel therefore removes the principal
 * when it deletes a user — and before it creates one whose username an
 * earlier user held — in one transaction, so no half-removed principal is
 * ever seen.
 */

import type { StatementSync } from 'node:sqlite';
import { notifyCacheInvalidated } from './cache-bust.js';
import { withGrantLock } from './grants.js';
import { withGroupLock } from './groups.js';
import { getGatekeeperDb } from './state-db.js';

/** What removing a user principal removed. */
export interface RemovedUserPrincipal {
  /** Grants whose principal was the user. */
  readonly grantsRemoved: number;
  /** Groups the user was a member of. */
  readonly groupsLeft: number;
}

interface PrincipalStmts {
  deleteUserGrants: StatementSync;
  selectGroups: StatementSync;
  updateMembers: StatementSync;
  begin: StatementSync;
  commit: StatementSync;
  rollback: StatementSync;
}

let stmts: PrincipalStmts | null = null;

async function getStmts(): Promise<PrincipalStmts> {
  if (stmts) return stmts;
  const db = await getGatekeeperDb();
  stmts = {
    deleteUserGrants: db.prepare(
      "DELETE FROM access_grants WHERE principal_type = 'user' AND principal_id = ?",
    ),
    selectGroups: db.prepare('SELECT name, members FROM groups'),
    updateMembers: db.prepare('UPDATE groups SET members = ? WHERE name = ?'),
    begin: db.prepare('BEGIN IMMEDIATE'),
    commit: db.prepare('COMMIT'),
    rollback: db.prepare('ROLLBACK'),
  };
  return stmts;
}

/**
 * Remove user principal `username` everywhere: every grant to it and its
 * membership of every group, in one transaction, holding the groups lock
 * and then the grants lock (the order of every cascade). Idempotent: a
 * username Gatekeeper does not know removes nothing.
 *
 * @param username - The Authelia username
 */
export function removeUserPrincipal(username: string): Promise<RemovedUserPrincipal> {
  return withGroupLock(() =>
    withGrantLock(async () => {
      const s = await getStmts();
      let grantsRemoved = 0;
      let groupsLeft = 0;
      s.begin.run();
      try {
        grantsRemoved = Number(s.deleteUserGrants.run(username).changes);
        const groups = s.selectGroups.all() as unknown as { name: string; members: string }[];
        for (const group of groups) {
          const members = JSON.parse(group.members) as string[];
          if (!members.includes(username)) continue;
          s.updateMembers.run(JSON.stringify(members.filter((m) => m !== username)), group.name);
          groupsLeft += 1;
        }
        s.commit.run();
      } catch (err) {
        s.rollback.run();
        throw err;
      }
      if (grantsRemoved > 0 || groupsLeft > 0) notifyCacheInvalidated();
      return { grantsRemoved, groupsLeft };
    }),
  );
}
