-- The relay's mail (packages/core/docs/mail-design.md; lib/mail-store.js).
--
-- mail_transports — one relay row (domain NULL: Authelia's mail and every
-- domain's default) and at most one row per domain (its override):
--   kind             gmail-api | smtp; NULL on a domain row that sets a
--                    sender only (the relay's transport carries its mail)
--   settings         JSON by kind (core SmtpTransportSettings /
--                    GmailApiTransportSettings) — never answered whole
--   secret           smtp: the password; gmail-api: JSON { clientSecret,
--                    refreshToken } — never answered, never logged
--                    (state.db is 0600 lamaste)
--   account_key      the sending account the budget counts against:
--                    gmail:<account> | smtp:<host>:<username or ->
--   daily_limit      the provider's per-account limit the administrator
--                    entered (§3.7); NULL exactly when kind is NULL
--   health_*         the last admission check (start, every 6 h)
CREATE TABLE mail_transports (
  id              INTEGER PRIMARY KEY,
  domain          TEXT UNIQUE REFERENCES domains(name) ON DELETE CASCADE,
  kind            TEXT CHECK (kind IN ('gmail-api', 'smtp')),
  settings        TEXT,
  secret          TEXT,
  account_key     TEXT,
  sender_address  TEXT NOT NULL,
  sender_name     TEXT,
  daily_limit     INTEGER CHECK (daily_limit BETWEEN 1 AND 100000),
  health_status   TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('up', 'down', 'unknown')),
  health_checked_at TEXT,
  health_reason   TEXT,
  verified_at     TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK ((kind IS NULL) = (settings IS NULL)),
  CHECK ((kind IS NULL) = (account_key IS NULL)),
  CHECK ((kind IS NULL) = (daily_limit IS NULL)),
  CHECK (domain IS NOT NULL OR kind IS NOT NULL)
);
-- At most one relay row (SQLite's UNIQUE admits many NULLs).
CREATE UNIQUE INDEX mail_transports_relay ON mail_transports ((domain IS NULL)) WHERE domain IS NULL;
CREATE INDEX mail_transports_account ON mail_transports (account_key);

-- What the relay knows of a sending account, whichever rows send through
-- it (§3.7): a provider's limit refusal stops the account — every row on it
-- — until `limited_until`; `warned_at` / `exhausted_at` record the budget
-- notifications of the current crossing (each once, cleared when usage
-- falls back below the threshold).
CREATE TABLE mail_accounts (
  account_key    TEXT PRIMARY KEY,
  limited_until  TEXT,
  limited_reason TEXT,
  warned_at      TEXT,
  exhausted_at   TEXT
);

-- A Google consent under way (§3.3): one row per attempt, single use,
-- 10 minutes. `state_sha256` — the state's SHA-256 (the state travels only
-- in Google's redirect); `draft` — JSON of what the transport will store
-- (client id and secret, sender, daily limit).
CREATE TABLE mail_oauth_pending (
  state_sha256   TEXT PRIMARY KEY CHECK (length(state_sha256) = 64),
  domain         TEXT,
  code_verifier  TEXT NOT NULL,
  draft          TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);

-- Every delivery attempt (§3.7): no address, no subject. Usage is counted
-- per sending account over 24 h; swept after 48 h.
CREATE TABLE mail_sends (
  id           INTEGER PRIMARY KEY,
  account_key  TEXT NOT NULL,
  class        TEXT NOT NULL CHECK (class IN ('essential', 'admin', 'public')),
  kind         TEXT NOT NULL CHECK (kind IN ('authelia', 'invitation', 'reset', 'password-changed', 'test')),
  sent_at      TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('sent', 'failed'))
);
CREATE INDEX mail_sends_account_time ON mail_sends (account_key, sent_at);

-- Forgot-password links (§6.2): the token's SHA-256 only, 30 minutes,
-- single use, five failures void it; swept after 24 h.
CREATE TABLE password_resets (
  id               INTEGER PRIMARY KEY,
  token_sha256     TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
  user_id          TEXT NOT NULL,
  username         TEXT NOT NULL,
  domain           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  used_at          TEXT,
  failed_attempts  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX password_resets_user ON password_resets (user_id);

-- What became of an invitation's mail (§6.1): sent | failed |
-- not-configured | deferred-budget; NULL before 4.13 or not yet sent.
ALTER TABLE invitations ADD COLUMN mail_status TEXT
  CHECK (mail_status IN ('sent', 'failed', 'not-configured', 'deferred-budget'));
ALTER TABLE invitations ADD COLUMN mail_sent_at TEXT;
