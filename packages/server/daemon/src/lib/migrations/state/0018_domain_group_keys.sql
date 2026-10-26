-- Opaque names for the Authelia groups Lamaste owns
-- (packages/core/docs/external-members-design.md, security review): a
-- domain's members and external members are `lamaste:m:<key>` and
-- `lamaste:x:<key>`, with a random key per domain, so an OIDC relying party
-- that asks for the `groups` claim learns no domain's name. The panel gives
-- a new domain its key when it inserts it; the trigger is the fallback, and
-- existing domains get one here.
ALTER TABLE domains ADD COLUMN group_key TEXT;
UPDATE domains SET group_key = lower(hex(randomblob(8))) WHERE group_key IS NULL;
CREATE UNIQUE INDEX domains_group_key ON domains(group_key);
CREATE TRIGGER domains_group_key_fill AFTER INSERT ON domains
WHEN NEW.group_key IS NULL
BEGIN
  UPDATE domains SET group_key = lower(hex(randomblob(8))) WHERE name = NEW.name;
END;

-- Domains removed from the relay: hostnames under them are still Lamaste's
-- groups (a host group left on a user is stripped at the next rendering,
-- never taken for an administrator's group).
CREATE TABLE retired_domains (
  name       TEXT PRIMARY KEY,
  removed_at TEXT NOT NULL
);
