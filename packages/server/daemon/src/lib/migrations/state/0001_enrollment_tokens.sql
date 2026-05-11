CREATE TABLE enrollment_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  capabilities  TEXT    NOT NULL,
  allowed_sites TEXT    NOT NULL,
  type          TEXT,
  delegated_by  TEXT,
  scope         TEXT,
  created_at    TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  used_at       TEXT
);

CREATE INDEX idx_enrollment_label_active ON enrollment_tokens(label, used);
CREATE INDEX idx_enrollment_created_at  ON enrollment_tokens(created_at);
