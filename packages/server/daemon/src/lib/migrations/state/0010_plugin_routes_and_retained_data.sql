-- Plugin routes are unique; data an agent half leaves on an agent is kept
-- on record (4.3, slice 3).

-- A plugin's route — its name without a trailing "-server" or "-agent"
-- (`derivePluginRoute`) — is what its API (`/api/<route>`), capabilities
-- (`plugin:<route>:*`), OIDC client ids, hosting record and, on the agent,
-- its agent half's account and directories are named after. Two installed
-- plugins sharing one ("fx" and "fx-server") would act on each other's
-- hosting and capabilities, so each route belongs to one installed plugin.
ALTER TABLE plugins ADD COLUMN route TEXT;
UPDATE plugins SET route = CASE
  WHEN substr(name, -7) = '-server' THEN substr(name, 1, length(name) - 7)
  WHEN substr(name, -6) = '-agent' THEN substr(name, 1, length(name) - 6)
  ELSE name
END;
-- Plugins installed before the rule may already share a route: the one
-- installed first keeps it; the others hold none (NULL) and can only be
-- uninstalled — never hosted — until they are reinstalled under a route
-- of their own.
UPDATE plugins SET route = NULL WHERE EXISTS (
  SELECT 1 FROM plugins AS other
  WHERE other.route = plugins.route
    AND other.name <> plugins.name
    AND (other.installed_at < plugins.installed_at
         OR (other.installed_at = plugins.installed_at AND other.name < plugins.name))
);
CREATE UNIQUE INDEX plugins_route ON plugins (route);

-- The data an agent half leaves on an agent when it is removed without
-- purge (unhost, uninstall, a rolled-back install): its data directory and
-- service account, both named after the route. Kept here — not on the
-- plugin row — because it outlives the plugin's uninstall and is keyed the
-- way it exists on the agent: one record per agent and route. `package` is
-- the agent package that owns it (the agent's helper refuses to install
-- another package over it); `plugin` the plugin it belonged to. Removed when
-- it is purged, or when the same agent half is installed there again and
-- takes the data back.
CREATE TABLE retained_agent_data (
  agent_label  TEXT NOT NULL,
  route        TEXT NOT NULL,
  plugin       TEXT NOT NULL,
  package      TEXT NOT NULL,
  since        TEXT NOT NULL,
  operation    TEXT,
  PRIMARY KEY (agent_label, route)
);
CREATE INDEX retained_agent_data_plugin ON retained_agent_data (plugin);
