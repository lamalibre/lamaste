CREATE TABLE tickets (
  index_hash    TEXT    PRIMARY KEY,
  id            TEXT    NOT NULL,
  scope         TEXT    NOT NULL,
  instance_id   TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  target        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  used_at       TEXT,
  session_id    TEXT,
  transport     TEXT    NOT NULL
);

CREATE INDEX idx_tickets_target_active ON tickets(target, used);
CREATE INDEX idx_tickets_instance_id   ON tickets(instance_id);
CREATE INDEX idx_tickets_created_at    ON tickets(created_at);

CREATE TABLE ticket_scopes (
  name          TEXT    PRIMARY KEY,
  version       TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  scopes        TEXT    NOT NULL,
  transport     TEXT    NOT NULL,
  hooks         TEXT    NOT NULL DEFAULT '{}',
  installed_at  TEXT    NOT NULL
);

CREATE TABLE ticket_instances (
  instance_id    TEXT    PRIMARY KEY,
  scope          TEXT    NOT NULL,
  agent_label    TEXT    NOT NULL,
  registered_at  TEXT    NOT NULL,
  last_heartbeat TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  transport      TEXT    NOT NULL
);

CREATE INDEX idx_ticket_instances_scope_agent ON ticket_instances(scope, agent_label);
CREATE INDEX idx_ticket_instances_status      ON ticket_instances(status);

CREATE TABLE ticket_assignments (
  agent_label    TEXT    NOT NULL,
  instance_scope TEXT    NOT NULL,
  assigned_at    TEXT    NOT NULL,
  assigned_by    TEXT    NOT NULL DEFAULT 'admin',
  PRIMARY KEY (agent_label, instance_scope)
);

CREATE INDEX idx_ticket_assignments_instance_scope ON ticket_assignments(instance_scope);

CREATE TABLE ticket_sessions (
  session_id                 TEXT    PRIMARY KEY,
  ticket_id                  TEXT    NOT NULL,
  scope                      TEXT    NOT NULL,
  instance_id                TEXT    NOT NULL,
  source                     TEXT    NOT NULL,
  target                     TEXT    NOT NULL,
  created_at                 TEXT    NOT NULL,
  last_activity_at           TEXT    NOT NULL,
  status                     TEXT    NOT NULL,
  reconnect_grace_seconds    INTEGER NOT NULL DEFAULT 60,
  terminated_by              TEXT,
  terminated_at              TEXT
);

CREATE INDEX idx_sessions_target_active   ON ticket_sessions(target, status);
CREATE INDEX idx_sessions_instance_id     ON ticket_sessions(instance_id);
CREATE INDEX idx_sessions_last_activity   ON ticket_sessions(last_activity_at);
