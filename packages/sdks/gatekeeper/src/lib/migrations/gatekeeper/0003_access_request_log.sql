CREATE TABLE access_request_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp     TEXT    NOT NULL,
  username      TEXT    NOT NULL,
  resource_type TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  resource_fqdn TEXT    NOT NULL
);
CREATE INDEX idx_access_log_timestamp ON access_request_log(timestamp);
