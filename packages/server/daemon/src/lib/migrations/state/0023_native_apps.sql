-- Native apps on the user surface (packages/core/docs/native-apps-design.md;
-- lib/native-apps.js, lib/native-grants.js, routes/native-oauth.js).
--
-- Numbered after slice 8's 0022_peers.sql; the runner applies whatever is
-- missing, in order, so a relay that never had 0022 takes this one alone.
--
-- Times are milliseconds since the epoch.

-- A native client: one per application host (a plugin-owned site or a
-- tunnel bound to plugin routes). The host's hostname and domain are read
-- from sites.json / tunnels.json on every use, never stored twice.
CREATE TABLE native_clients (
  client_id            TEXT PRIMARY KEY,
  host_kind            TEXT NOT NULL CHECK (host_kind IN ('site', 'tunnel')),
  host_id              TEXT NOT NULL,
  name                 TEXT NOT NULL,
  redirect_paths_json  TEXT NOT NULL,
  access_token_minutes INTEGER NOT NULL,
  idle_days            INTEGER NOT NULL,
  absolute_days        INTEGER NOT NULL,
  associations_json    TEXT NOT NULL DEFAULT '{}',
  enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  UNIQUE (host_kind, host_id)
);

-- A grant: one person's sign-in on one device with one native client — the
-- chain of refresh tokens from one authorization-code exchange.
--   issuer_failures  consecutive 5xx Authelia answered for the current token
--                    while it was up (three end the grant)
CREATE TABLE native_grants (
  grant_id            TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  last_used_at        INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  device_name         TEXT,
  user_agent          TEXT,
  revoked_at          INTEGER,
  revoked_reason      TEXT,
  issuer_failures     INTEGER NOT NULL DEFAULT 0,
  version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX native_grants_user ON native_grants (user_id);
CREATE INDEX native_grants_client ON native_grants (client_id);

-- The refresh tokens of a grant, by SHA-256 only. One `current`; the
-- `spent` ones detect reuse. A spent token's rotation answer is kept sealed
-- under that token (core `sealGraceAnswer`) until `grace_until`, so a lost
-- answer or two refreshes at once get it again instead of ending the grant.
CREATE TABLE native_refresh_tokens (
  sha256       TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  grant_id     TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('current', 'spent')),
  issued_at    INTEGER NOT NULL,
  spent_at     INTEGER,
  grace_until  INTEGER,
  grace_answer TEXT
);
CREATE INDEX native_refresh_tokens_grant ON native_refresh_tokens (grant_id);
CREATE UNIQUE INDEX native_refresh_tokens_current
  ON native_refresh_tokens (grant_id) WHERE state = 'current';

-- The access tokens the broker saw issued, by SHA-256 of the whole token:
-- the allow-list of the user surface's bearer path.
CREATE TABLE native_access_tokens (
  token_sha256 TEXT PRIMARY KEY CHECK (length(token_sha256) = 64),
  grant_id     TEXT NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX native_access_tokens_grant ON native_access_tokens (grant_id);
CREATE INDEX native_access_tokens_expiry ON native_access_tokens (expires_at);

-- Sign-in events waiting for a plugin's agent half (delivered by
-- lib/sign-in-events.js).
CREATE TABLE native_sign_in_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin       TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  at           INTEGER NOT NULL,
  client_id    TEXT NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX native_sign_in_events_plugin ON native_sign_in_events (plugin, seq);
CREATE INDEX native_sign_in_events_user ON native_sign_in_events (user_id);
