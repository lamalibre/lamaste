-- Native clients of two kinds (packages/core/docs/desktop-native-clients-design.md):
-- `mobile` — claimed HTTPS redirect paths on the host and its app
-- association files (every client before this migration); `desktop` —
-- loopback redirect paths on the device (`http://127.0.0.1<path>`), no
-- files on the host. A host holds at most one client of each kind, so the
-- unique key moves from (host_kind, host_id) to (host_kind, host_id, kind).
-- SQLite cannot drop a table constraint in place: the table is rebuilt
-- with its rows (nothing references it by a foreign key).
--
--   redirect_paths_json  a mobile client's paths on the host; '[]' for desktop
--   loopback_paths_json  a desktop client's paths on the device; '[]' for mobile
CREATE TABLE native_clients_v2 (
  client_id            TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL DEFAULT 'mobile' CHECK (kind IN ('mobile', 'desktop')),
  host_kind            TEXT NOT NULL CHECK (host_kind IN ('site', 'tunnel')),
  host_id              TEXT NOT NULL,
  name                 TEXT NOT NULL,
  redirect_paths_json  TEXT NOT NULL DEFAULT '[]',
  loopback_paths_json  TEXT NOT NULL DEFAULT '[]',
  access_token_minutes INTEGER NOT NULL,
  idle_days            INTEGER NOT NULL,
  absolute_days        INTEGER NOT NULL,
  associations_json    TEXT NOT NULL DEFAULT '{}',
  enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  UNIQUE (host_kind, host_id, kind)
);
INSERT INTO native_clients_v2
  (client_id, kind, host_kind, host_id, name, redirect_paths_json, loopback_paths_json,
   access_token_minutes, idle_days, absolute_days, associations_json, enabled,
   created_at, updated_at, version)
SELECT client_id, 'mobile', host_kind, host_id, name, redirect_paths_json, '[]',
       access_token_minutes, idle_days, absolute_days, associations_json, enabled,
       created_at, updated_at, version
FROM native_clients;
DROP TABLE native_clients;
ALTER TABLE native_clients_v2 RENAME TO native_clients;
