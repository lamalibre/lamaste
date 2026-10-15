-- Agent halves Lamaste installs onto an agent (4.3, slice 3).

-- The agent half pinned when the plugin's version was staged (install or
-- update): JSON {package, version, integrity}, where `integrity` is the npm
-- Subresource Integrity (sha512) of the agent package's tarball as the
-- registry published it. The approval digest covers it and the agent
-- installs only a tarball that matches it. NULL when Lamaste installs no
-- agent half (no `agent.package` in the manifest).
ALTER TABLE plugins ADD COLUMN agent_half_pin TEXT;

-- Agent jobs gain kinds besides `hook`: `app-install`, `app-activate` and
-- `app-remove` run the agent's root helper. Their parameters are `payload`
-- (JSON: {spec} | {version, package} | {purge, package}); `stage` and
-- `input` belong to hook jobs only, so they become nullable. SQLite cannot
-- drop a NOT NULL constraint in place: the table is rebuilt with its rows.
CREATE TABLE agent_jobs_v2 (
  id           TEXT PRIMARY KEY,
  agent_label  TEXT NOT NULL,
  plugin       TEXT NOT NULL,
  kind         TEXT NOT NULL,
  stage        TEXT,
  input        TEXT,
  payload      TEXT,
  timeout_ms   INTEGER NOT NULL,
  status       TEXT NOT NULL,
  result       TEXT,
  created_at   TEXT NOT NULL,
  deadline_at  TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO agent_jobs_v2
  (id, agent_label, plugin, kind, stage, input, payload, timeout_ms, status, result,
   created_at, deadline_at, completed_at)
SELECT id, agent_label, plugin, kind, stage, input, NULL, timeout_ms, status, result,
       created_at, deadline_at, completed_at
FROM agent_jobs;
DROP TABLE agent_jobs;
ALTER TABLE agent_jobs_v2 RENAME TO agent_jobs;
CREATE INDEX agent_jobs_agent ON agent_jobs (agent_label, status);

-- What an agent reports about its host (JSON HostFacts: OS, distribution,
-- architecture, Node.js, systemd, the app host helper) and when it last
-- did — checked against a plugin's `agent.requires` when it is hosted.
ALTER TABLE agents ADD COLUMN host_facts TEXT;
ALTER TABLE agents ADD COLUMN host_facts_at TEXT;

-- An agent's push-install window and policy. The registry code has set both
-- fields since push install exists, but the SQLite table (0004) had no
-- columns for them, so an enabled window was never stored and the
-- push-install gates could never pass. Hosting, updating and removing an
-- agent half are gated on them.
ALTER TABLE agents ADD COLUMN push_install_enabled_until TEXT;
ALTER TABLE agents ADD COLUMN push_install_policy TEXT;
