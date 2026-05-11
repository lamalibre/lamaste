CREATE TABLE access_grants (
  grant_id        TEXT    PRIMARY KEY,            -- UUID
  principal_type  TEXT    NOT NULL,               -- 'user' | 'group'
  principal_id    TEXT    NOT NULL,
  resource_type   TEXT    NOT NULL,               -- 'tunnel' | 'plugin' | extensible
  resource_id     TEXT    NOT NULL,
  context         TEXT    NOT NULL DEFAULT '{}',  -- JSON object
  used            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL,
  used_at         TEXT
);
CREATE INDEX idx_grants_principal     ON access_grants(principal_type, principal_id);
CREATE INDEX idx_grants_resource      ON access_grants(resource_type, resource_id);
CREATE INDEX idx_grants_used_used_at  ON access_grants(used, used_at);
