-- The user directory and each plugin's audience (4.5, slice 6).
--
-- Authelia's users.yml stays its credential file; this directory gives every
-- user a stable id the panel tells plugins about, and keeps what the panel
-- last knew of a user after the user is gone (lib/directory.js). The panel
-- never writes users.yml from here: it reconciles this directory against the
-- file after its own writes, at start and every minute — read only.

-- This directory's identity: a UUID v4 made once, when the store is created.
-- A store that is replaced (a fresh state.db) has another id, which tells an
-- agent half that its cursor no longer means anything (it replays from 0).
CREATE TABLE directory_meta (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  directory_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
INSERT INTO directory_meta (id, directory_id, created_at)
  SELECT 1,
         substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-' ||
           substr('89ab', 1 + (random() & 3), 1) || substr(h, 18, 3) || '-' || substr(h, 21, 12),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM (SELECT lower(hex(randomblob(16))) AS h);

-- The store-wide sequence the audience triggers stamp changes with. It only
-- grows: a cursor on it never sees a number twice, across every plugin.
CREATE TABLE directory_counter (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  seq  INTEGER NOT NULL
);
INSERT INTO directory_counter (id, seq) VALUES (1, 0);

-- One row per user the directory ever knew, never deleted:
--   user_id         UUID v4, made when the username first appeared
--   username, display_name, email
--                   as users.yml last had them (display_name / email NULL
--                   when it had none); all three NULL once erased
--   status          active | disabled (Authelia's `disabled: true`) | removed
--   removed_reason  deleted (through Lamaste) | deleted-outside (gone from
--                   users.yml without Lamaste) — set exactly when removed
--   removed_at      when the user was removed
--   erased_at       when an administrator erased the tombstone
--   principal_cleared_at
--                   when Gatekeeper removed everything it held under the
--                   removed user's username — the grants naming it and its
--                   group memberships (Gatekeeper keys users by username,
--                   which a later user may reuse). NULL on a removed row:
--                   pending, retried every minute; the username is not given
--                   to a new user, and no username with a pending cleanup
--                   holds a role, until it is set. Set before an erasure
--                   scrubs the username it needs.
--   version         1 at creation, +1 on every change of the row
-- A username names at most one user that is not removed; a removed user
-- keeps it (history stays readable) until erased, and a username that comes
-- back is a new user with a new id.
CREATE TABLE directory_users (
  user_id         TEXT PRIMARY KEY,
  username        TEXT,
  display_name    TEXT,
  email           TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'removed')),
  removed_reason  TEXT CHECK (removed_reason IS NULL OR removed_reason IN ('deleted', 'deleted-outside')),
  removed_at      TEXT,
  erased_at       TEXT,
  principal_cleared_at TEXT,
  version         INTEGER NOT NULL CHECK (version >= 1),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK ((status = 'removed') = (removed_reason IS NOT NULL)),
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CHECK (status = 'removed' OR username IS NOT NULL),
  CHECK (erased_at IS NULL OR (status = 'removed' AND username IS NULL
                               AND display_name IS NULL AND email IS NULL)),
  CHECK (principal_cleared_at IS NULL OR status = 'removed'),
  CHECK (erased_at IS NULL OR principal_cleared_at IS NOT NULL)
);
CREATE UNIQUE INDEX directory_users_username ON directory_users (username)
  WHERE status <> 'removed';
-- The removed users whose Gatekeeper principal is still to be cleared.
CREATE INDEX directory_users_principal_pending ON directory_users (username)
  WHERE status = 'removed' AND principal_cleared_at IS NULL;

-- Each plugin's audience as last delivered (lib/audience.js): one row per
-- plugin and user who was ever a member, the change the feed carries for
-- them (the AudienceChange body without `seq`: an `upsert` with the member,
-- or a `remove` with its reason and, but for `erased`, the last known
-- declared attributes), its version (+1 whenever the change differs) and the
-- `seq` the triggers below stamp. Rows are written only when the change
-- differs; users who were never members have none. The plugin's ledger: kept
-- while any agent keeps data of the plugin (see 0014).
CREATE TABLE plugin_audience (
  plugin      TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES directory_users (user_id),
  change      TEXT NOT NULL,
  version     INTEGER NOT NULL CHECK (version >= 1),
  seq         INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (plugin, user_id)
);
CREATE INDEX plugin_audience_seq ON plugin_audience (plugin, seq);

-- A new row, and a row whose change was rewritten, take the next store-wide
-- seq. Only an UPDATE that names `change` stamps: the stamp itself updates
-- `seq` alone, so it does not fire again.
CREATE TRIGGER plugin_audience_stamp_insert AFTER INSERT ON plugin_audience
BEGIN
  UPDATE directory_counter SET seq = seq + 1 WHERE id = 1;
  UPDATE plugin_audience SET seq = (SELECT seq FROM directory_counter WHERE id = 1)
    WHERE plugin = NEW.plugin AND user_id = NEW.user_id;
END;
CREATE TRIGGER plugin_audience_stamp_update AFTER UPDATE OF change ON plugin_audience
BEGIN
  UPDATE directory_counter SET seq = seq + 1 WHERE id = 1;
  UPDATE plugin_audience SET seq = (SELECT seq FROM directory_counter WHERE id = 1)
    WHERE plugin = NEW.plugin AND user_id = NEW.user_id;
END;

-- What the panel knows of each plugin's agent half and its feed
-- (lib/identity-sync.js):
--   directory_id       the directory the half follows, as it last answered
--   cursor             the seq it has applied up to, as it last answered
--   ready_version      the plugin version installed when the half last
--                      applied every change up to the head after a complete
--                      replay — user callers go to the half only while it is
--                      the installed version
--   last_sync_at       the last sync that ended with the half up to date
--   last_reconcile_at  the last full replay (a reset or the daily reconcile);
--                      cleared when one starts, so one cut short is owed
--   last_mismatches    what the last daily reconcile found (null otherwise)
--   last_error         why the last sync did not finish (or was not tried)
-- Removed when its hosting is removed (the half of a later hosting is sent
-- everything, and is ready only once it has applied it) and with the
-- plugin's ledger (0014); kept when the plugin stops declaring identity.
CREATE TABLE plugin_identity_sync (
  plugin             TEXT PRIMARY KEY,
  directory_id       TEXT,
  cursor             INTEGER,
  ready_version      TEXT,
  last_sync_at       TEXT,
  last_reconcile_at  TEXT,
  last_mismatches    INTEGER,
  last_error         TEXT,
  updated_at         TEXT NOT NULL
);

-- Who erased a removed user, and when. The erasure itself is the scrubbed
-- directory row; each plugin acknowledges it when its half's cursor passes
-- the `remove/erased` change of its audience.
CREATE TABLE directory_erasures (
  user_id       TEXT PRIMARY KEY REFERENCES directory_users (user_id),
  requested_at  TEXT NOT NULL,
  requested_by  TEXT NOT NULL
);

-- The manifest's `identity` block as normalized (core
-- `normalizeIdentityBlock`: roles by id, attributes sorted, the default
-- applied), NULL when the plugin declares none. It enters the approval
-- digest when present.
ALTER TABLE plugins ADD COLUMN identity TEXT;
