CREATE TABLE agents (
  label             TEXT    PRIMARY KEY,
  serial            TEXT    NOT NULL,
  capabilities      TEXT    NOT NULL DEFAULT '[]',
  allowed_sites     TEXT    NOT NULL DEFAULT '[]',
  enrollment_method TEXT    NOT NULL DEFAULT 'p12',
  delegated_by      TEXT,
  created_at        TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  revoked           INTEGER NOT NULL DEFAULT 0,
  revoked_at        TEXT
);
CREATE INDEX idx_agents_serial ON agents(serial);

CREATE TABLE revoked_certs (
  serial      TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  revoked_at  TEXT NOT NULL
);
