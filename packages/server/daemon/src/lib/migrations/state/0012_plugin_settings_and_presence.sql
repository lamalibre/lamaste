-- Plugin settings and the presence of hosting agents (4.3, slice 4).

-- The manifest's `settings` block (JSON; NULL when the plugin declares
-- none): the schema the panel checks an administrator's change against
-- before sending it to the agent half, and the keys it keeps in the cache
-- below. Settings are not part of the approval digest.
ALTER TABLE plugins ADD COLUMN settings TEXT;

-- The relay's cache of each plugin's settings. The agent half is the system
-- of record (settings.json and secrets.json in its data directory); this row
-- is refreshed from its `GET /admin/settings` after hosting, after an
-- update, when the health monitor sees the plugin come up, and from its
-- answer to every change — so the panel can show the settings, and whether
-- the plugin still needs configuration, while the agent is offline.
-- There is no column for a secret's value: a secret exists on the relay only
-- in the memory of the request that carries it to the agent half.
--   schema_version    the agent half's settings schema version
--   revision          the agent half's revision (+1 per change)
--   values_json       JSON {key: value} — the non-secret values the agent half
--                     stored (no defaults), for keys the installed schema knows
--   secrets_set_json  JSON {key: setAt} — which secrets are set, and when
--   configured        1 when no required field lacks a value
--   missing_json      JSON [key] — the required fields without a value
--   synced_at         when the relay last read the agent half's state
-- Removed when the plugin's hosting is removed and when it is uninstalled.
CREATE TABLE plugin_settings (
  plugin            TEXT PRIMARY KEY,
  schema_version    INTEGER NOT NULL,
  revision          INTEGER NOT NULL,
  values_json       TEXT NOT NULL,
  secrets_set_json  TEXT NOT NULL,
  configured        INTEGER NOT NULL,
  missing_json      TEXT NOT NULL,
  synced_at         TEXT NOT NULL
);

-- When each machine agent last contacted the relay: its sync's
-- `GET /api/tunnels/agent-config`, every 30 s. Kept in memory and written
-- here at most once a minute per agent — never through the `agents` table,
-- which the registry rewrites whole. Tells how long a hosting agent has been
-- gone. Removed when the agent's certificate is revoked.
CREATE TABLE agent_presence (
  label         TEXT PRIMARY KEY,
  last_seen_at  TEXT NOT NULL
);
