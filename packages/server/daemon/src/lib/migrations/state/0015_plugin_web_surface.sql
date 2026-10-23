-- A plugin's web surface (4.6, slice 7).
--
-- user_surface is the manifest's `userSurface` block as the installed
-- version declares it (JSON; NULL when it declares none): its `web` names
-- the default subdomain and access mode Lamaste offers for the plugin's own
-- site and the directory of the server package that holds the shell.
--
-- web_tree_sha256 is the digest of that directory's web tree (core
-- `webTreeManifest`), read from the installed package: it enters the
-- approval digest, and the relay serves a copy of the tree only when the
-- copy's own digest equals it. NULL when the version declares no web
-- surface.
ALTER TABLE plugins ADD COLUMN user_surface TEXT;
ALTER TABLE plugins ADD COLUMN web_tree_sha256 TEXT;
