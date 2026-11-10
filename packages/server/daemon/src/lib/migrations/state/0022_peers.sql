-- Calls and events between app plugins (4.13, slice 8; lib/peers.js).
--
-- plugins.peers is the manifest's `peers` block as the installed version
-- declares it (JSON, normalized by core `normalizePeersBlock`; NULL when it
-- declares none): what it provides to other plugins and what it consumes
-- from them. It enters the approval digest.
ALTER TABLE plugins ADD COLUMN peers TEXT;

-- A shelf applied to this relay: its scope graph's edges, which are the
-- only grants of peer calls and events. Lamaste needs no Shelf code — a
-- shelf id is a name; Shelf's page applies a shelf from the admin's browser.
CREATE TABLE peer_shelves (
  shelf_id   TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL
);

-- One edge per (shelf, scope, consumer): the scope's provider is its
-- namespace, kept for the views.
CREATE TABLE peer_edges (
  shelf_id TEXT NOT NULL REFERENCES peer_shelves (shelf_id) ON DELETE CASCADE,
  scope    TEXT NOT NULL,
  provider TEXT NOT NULL,
  consumer TEXT NOT NULL,
  PRIMARY KEY (shelf_id, scope, consumer)
);
CREATE INDEX peer_edges_consumer ON peer_edges (consumer, scope);

-- When each (consumer, scope) pair became granted by any applied shelf: a
-- store-wide sequence (peer_counter), stamped when the pair first appears
-- and kept while any shelf grants it, the row deleted when none does — so
-- a pair granted again after a gap gets a new number. The number is the
-- first part of a subscription's epoch: a consumer whose grant was renewed
-- starts at the provider's head (a gap), and never receives what was
-- published while it had no grant.
CREATE TABLE peer_grants (
  consumer    TEXT NOT NULL,
  scope       TEXT NOT NULL,
  granted_seq INTEGER NOT NULL,
  PRIMARY KEY (consumer, scope)
);

CREATE TABLE peer_counter (
  id  INTEGER PRIMARY KEY CHECK (id = 1),
  seq INTEGER NOT NULL
);
INSERT INTO peer_counter (id, seq) VALUES (1, 0);
