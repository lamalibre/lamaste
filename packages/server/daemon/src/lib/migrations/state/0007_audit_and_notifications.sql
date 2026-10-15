-- Lamaste's audit log and panel notifications (4.3, slice 2b).
--
-- audit_events: append-only record of administrative decisions and of what
-- plugins' lifecycle hooks report through the `audit` effect. `details` is
-- JSON metadata — never a request or response body, a secret or personal
-- data. Pruned by age and count (lib/audit.js), never edited.
CREATE TABLE audit_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  plugin  TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_plugin ON audit_events (plugin, id);
CREATE INDEX audit_events_action ON audit_events (action, id);

-- notifications: messages for the panel's administrators — the
-- `notify-admins` hook effect and Lamaste's own events. Read state is
-- shared: the panel has one administrator identity.
CREATE TABLE notifications (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  source  TEXT NOT NULL,
  level   TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX notifications_unread ON notifications (read_at, id);
