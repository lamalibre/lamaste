-- The relay's base domains and who is a member of each (the multi-domain
-- relay, packages/core/docs/multi-domain-relay-design.md; lib/domains.js).
--
-- One domain is the primary: the panel's (panel.json `domain`), inserted at
-- the first start after onboarding together with every user the directory
-- holds as its members (lib/domains.js `ensurePrimaryDomain`) — an upgraded
-- single-domain relay keeps letting everyone in.

-- A base domain:
--   name          lower case, two labels at least; domains never overlap
--   is_primary    1 for exactly one row: the panel's domain
--   status        pending (added, auth.<domain> not yet issued) | active
--                 (its sign-in, session cookie and members rendered)
CREATE TABLE domains (
  name          TEXT PRIMARY KEY,
  is_primary    INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at    TEXT NOT NULL,
  activated_at  TEXT,
  CHECK (is_primary = 0 OR status = 'active'),
  CHECK ((status = 'active') = (activated_at IS NOT NULL))
);
CREATE UNIQUE INDEX domains_one_primary ON domains (is_primary) WHERE is_primary = 1;

-- Who may reach a domain: one row per domain and user, by user id (a
-- re-created username is a new user with no membership). Rows go when the
-- user is deleted or the domain removed; a disabled user keeps theirs but
-- is never rendered as a member. Changes take the directory's store-wide
-- sequence, as plugin audiences do.
CREATE TABLE domain_members (
  domain    TEXT NOT NULL REFERENCES domains (name),
  user_id   TEXT NOT NULL REFERENCES directory_users (user_id),
  added_at  TEXT NOT NULL,
  added_by  TEXT NOT NULL,
  seq       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, user_id)
);
CREATE INDEX domain_members_user ON domain_members (user_id);

CREATE TRIGGER domain_members_stamp_insert AFTER INSERT ON domain_members
BEGIN
  UPDATE directory_counter SET seq = seq + 1 WHERE id = 1;
  UPDATE domain_members SET seq = (SELECT seq FROM directory_counter WHERE id = 1)
    WHERE domain = NEW.domain AND user_id = NEW.user_id;
END;
CREATE TRIGGER domain_members_stamp_delete AFTER DELETE ON domain_members
BEGIN
  UPDATE directory_counter SET seq = seq + 1 WHERE id = 1;
END;

-- The domain a plugin belongs to — its OIDC clients' `{domain}` and sign-in,
-- its user and web surfaces, its audience. NULL: the primary domain.
ALTER TABLE plugins ADD COLUMN domain TEXT;
