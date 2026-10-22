-- Erasure obligations outlive a plugin's feed (4.5, slice 6).
--
-- plugin_audience (0013) is each plugin's ledger of everyone its agent
-- halves were ever sent, and so of the erasures it owes. It stays when the
-- plugin is uninstalled or stops declaring identity — its data stays on an
-- agent — and goes only once no data of the plugin is left anywhere: the
-- plugin is not installed and no agent retains its data (lib/audience.js
-- `dropIdentityLedgerIfNoData`). Erasing a user rewrites the user's row in
-- every ledger, so a plugin that comes back replays the erasure.
--
-- Data an agent retains (retained_agent_data, 0010) is an agent half's data
-- directory, its identity projection included. What that projection had
-- applied when the data was retained — the directory it followed and its
-- cursor, as the half last answered — is recorded with it: the erasures of
-- the plugin's ledger stamped after that cursor are pending on that agent
-- until the data is purged, or taken back by a hosting whose half replays
-- them. NULL when the relay knew no position (the half had never answered):
-- every erasure of the ledger is pending there.
ALTER TABLE retained_agent_data ADD COLUMN identity_directory_id TEXT;
ALTER TABLE retained_agent_data ADD COLUMN identity_cursor INTEGER;
