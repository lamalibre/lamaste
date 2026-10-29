-- Invitations, the administrator's and delegated ones
-- (packages/core/docs/delegated-invitations-design.md; lib/invitations.js).
-- They lived in invitations.json with their tokens in clear; the first start
-- with this table imports that file (tokens hashed) and deletes it.
--
-- An invitation:
--   token_sha256     hex SHA-256 of its 32-byte token — the token itself is
--                    shown once, to whoever made it, and never stored
--   kind             admin (POST /api/invitations) | delegated (a plugin
--                    user holding an inviting role)
--   username         admin: chosen by the administrator; delegated: the one
--                    the invitee claimed while accepting
--   email,
--   display_name     what the invitation was made for; NULL once accepted
--                    (the directory holds them then)
--   email_domain     the address's domain, kept for the policy's sweeps and
--                    the listing
--   groups_json      Authelia groups (admin only)
--   domains_json     the memberships acceptance makes: [{ name, kind }]
--   plugin, role,
--   site_id,
--   inviter_user_id  delegated: the plugin, the one role, the plugin's web
--                    surface it grants and who invited
--   created_by       'admin' | 'user:<userId>'
--   status           pending | accepting (claimed by an acceptance under
--                    way) | accepted | revoked; expiry is read from
--                    expires_at, never swept
--   failed_attempts  refused acceptances; five lock the link
--   claim_id         the acceptance under way (`accepting`): a random id the
--                    acceptance checks under the users lock before it writes
--                    anything — recovery or a revocation that took the claim
--                    stops it
--   revoke_pending_reason
--                    a sweep or the administrator found an `accepting`
--                    invitation no longer acceptable: its acceptance makes no
--                    grant and ends it revoked with this reason
--   role_granted_at,
--   site_granted_at,
--   rendered_at      delegated: what acceptance has completed
--   site_attempted_at
--                    when the site grant was asked of Gatekeeper: an attempt
--                    whose answer was lost is never made again blindly (the
--                    administrator may have revoked what it made)
CREATE TABLE invitations (
  id                TEXT PRIMARY KEY,
  token_sha256      TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
  kind              TEXT NOT NULL CHECK (kind IN ('admin', 'delegated')),
  username          TEXT,
  email             TEXT,
  display_name      TEXT,
  email_domain      TEXT NOT NULL,
  groups_json       TEXT NOT NULL DEFAULT '[]',
  domains_json      TEXT NOT NULL,
  plugin            TEXT,
  role              TEXT,
  site_id           TEXT,
  inviter_user_id   TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'accepting', 'accepted', 'revoked')),
  status_at         TEXT NOT NULL,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  claim_id          TEXT,
  revoke_pending_reason TEXT,
  revoked_by        TEXT,
  revoked_reason    TEXT,
  accepted_user_id  TEXT,
  role_granted_at   TEXT,
  site_granted_at   TEXT,
  rendered_at       TEXT,
  site_attempted_at TEXT,
  CHECK (kind = 'admin' OR (
    plugin IS NOT NULL AND role IS NOT NULL AND site_id IS NOT NULL
    AND inviter_user_id IS NOT NULL AND groups_json = '[]'
  )),
  CHECK ((status = 'revoked') = (revoked_reason IS NOT NULL)),
  CHECK (status NOT IN ('accepting', 'accepted') OR username IS NOT NULL),
  CHECK ((status = 'accepting') = (claim_id IS NOT NULL)),
  CHECK (revoke_pending_reason IS NULL OR status = 'accepting')
);
CREATE INDEX invitations_open ON invitations (status, plugin, inviter_user_id);
CREATE INDEX invitations_accepted_user ON invitations (accepted_user_id);
-- One open invitation per username, across plugins and kinds: two
-- acceptances can never claim one name. (An expired pending one is closed
-- as `superseded` before another names its username.)
CREATE UNIQUE INDEX invitations_open_username ON invitations (username)
  WHERE username IS NOT NULL AND status IN ('pending', 'accepting');

-- The invitation whose acceptance created a user — what recovery and the
-- reconcile match an acceptance by, never the time it happened.
ALTER TABLE directory_users ADD COLUMN invitation_id TEXT;

-- The administrator's policy for one plugin's delegated invitations: off
-- until enabled, the e-mail domains invitees' addresses must be under, and
-- the bounds.
CREATE TABLE plugin_invitation_policies (
  plugin                TEXT PRIMARY KEY,
  enabled               INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  email_domains_json    TEXT NOT NULL DEFAULT '[]',
  max_open_per_inviter  INTEGER NOT NULL DEFAULT 10 CHECK (max_open_per_inviter BETWEEN 1 AND 100),
  max_joined            INTEGER NOT NULL DEFAULT 50 CHECK (max_joined BETWEEN 1 AND 500),
  lifetime_days         INTEGER NOT NULL DEFAULT 7 CHECK (lifetime_days BETWEEN 1 AND 30),
  updated_at            TEXT NOT NULL,
  updated_by            TEXT NOT NULL
);
