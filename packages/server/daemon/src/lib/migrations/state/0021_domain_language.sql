-- The language every page on a domain speaks (packages/core/docs/page-language-design.md;
-- lib/domains.js `setDomainLanguage`): Lamaste's invitation, inviter and
-- "not available" pages, Gatekeeper's refusal and access-request pages, and
-- Authelia's portal, forced into it by the auth vhost.
--
-- NULL = not set — Lamaste's pages in English, Authelia's portal following
-- the visitor's browser, exactly as before 4.10. Values are validated in
-- code (core PAGE_LANGUAGES), so a new language needs no migration.
ALTER TABLE domains ADD COLUMN language TEXT;
