-- Lifecycle hooks of agent-hosted plugins (4.3, slice 2b).

-- The manifest's `hooks` block (JSON; NULL when the plugin declares none)
-- and the SHA-256 of its relay entry module, read when the package was
-- installed. Together they give the relay hook set's digest without
-- touching the package again.
ALTER TABLE plugins ADD COLUMN hooks TEXT;
ALTER TABLE plugins ADD COLUMN hooks_entry_sha256 TEXT;

-- Approval of a plugin's relay hook set, and what the hook runner holds.
--   approved_digest   the digest an administrator (or auto-approve) approved
--   auto_approve      approve later hook-set changes automatically (audited)
--   installed_digest  the digest lamaste-priv last installed into the runner
--   pack_versions     JSON {pack: version} of the shared-hook rule packs last
--                     recorded, to audit a rule update once per plugin
--   pending_update    JSON {version, digest, ...} of a staged update waiting
--                     for approval, or NULL
--   tunnel_fallback   JSON fallback response the plugin's tunnel:down hook
--                     returned, served while it is down; NULL otherwise
-- Kept per plugin name; removed when the plugin is uninstalled.
CREATE TABLE plugin_hook_sets (
  plugin            TEXT PRIMARY KEY,
  approved_digest   TEXT,
  approved_version  TEXT,
  approved_at       TEXT,
  approved_by       TEXT,
  auto_approve      INTEGER NOT NULL DEFAULT 0,
  installed_digest  TEXT,
  pack_versions     TEXT NOT NULL DEFAULT '{}',
  pending_update    TEXT,
  tunnel_fallback   TEXT
);

-- Long-running plugin operations (hosting, unhosting, update, uninstall):
-- one running per plugin; steps and outcome kept for the panel. `steps` is
-- JSON [{name, status, startedAt, finishedAt, error?}] — metadata only.
CREATE TABLE plugin_operations (
  id          TEXT PRIMARY KEY,
  plugin      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  status      TEXT NOT NULL,
  steps       TEXT NOT NULL DEFAULT '[]',
  error       TEXT,
  params      TEXT NOT NULL DEFAULT '{}',
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX plugin_operations_plugin ON plugin_operations (plugin, started_at);

-- Work for an agent's sync (agent-config `agentJobs`): calls the agent
-- makes to its agent half on its own loopback (hook stages outside the
-- tunnel), reported back with a result. `input` is the hook input (JSON
-- metadata, no secrets); the agent signs the call with the installation
-- secret it already holds.
CREATE TABLE agent_jobs (
  id           TEXT PRIMARY KEY,
  agent_label  TEXT NOT NULL,
  plugin       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  stage        TEXT NOT NULL,
  input        TEXT NOT NULL,
  timeout_ms   INTEGER NOT NULL,
  status       TEXT NOT NULL,
  result       TEXT,
  created_at   TEXT NOT NULL,
  deadline_at  TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX agent_jobs_agent ON agent_jobs (agent_label, status);
