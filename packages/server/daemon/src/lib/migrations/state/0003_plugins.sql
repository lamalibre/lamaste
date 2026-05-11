CREATE TABLE plugins (
  name          TEXT    PRIMARY KEY,
  display_name  TEXT,
  package_name  TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  description   TEXT,
  capabilities  TEXT    NOT NULL DEFAULT '[]',
  packages      TEXT,
  panel         TEXT,
  config        TEXT,
  modes         TEXT,
  status        TEXT    NOT NULL,
  installed_at  TEXT    NOT NULL,
  enabled_at    TEXT
);
