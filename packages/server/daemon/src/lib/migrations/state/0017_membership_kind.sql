-- The kind of a domain membership (packages/core/docs/external-members-design.md;
-- lib/domains.js): a `member` reaches what the domain gives its members, an
-- `external` member only what names them (a grant, a site's listed users, an
-- OIDC client granted to them). Every membership from before is a member.
ALTER TABLE domain_members ADD COLUMN kind TEXT NOT NULL DEFAULT 'member'
  CHECK (kind IN ('member', 'external'));

-- A change of kind takes the directory's store-wide sequence, as an insert does.
CREATE TRIGGER domain_members_stamp_kind AFTER UPDATE OF kind ON domain_members
WHEN OLD.kind IS NOT NEW.kind
BEGIN
  UPDATE directory_counter SET seq = seq + 1 WHERE id = 1;
  UPDATE domain_members SET seq = (SELECT seq FROM directory_counter WHERE id = 1)
    WHERE domain = NEW.domain AND user_id = NEW.user_id;
END;
