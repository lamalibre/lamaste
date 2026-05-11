CREATE TABLE groups (
  name         TEXT    PRIMARY KEY,
  description  TEXT    NOT NULL DEFAULT '',
  members      TEXT    NOT NULL DEFAULT '[]',   -- JSON array of usernames
  created_at   TEXT    NOT NULL,
  created_by   TEXT    NOT NULL DEFAULT 'admin'
);
