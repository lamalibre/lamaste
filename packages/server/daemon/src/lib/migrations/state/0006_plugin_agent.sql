-- The `agent` block of an agent-hosted plugin's manifest (4.3): present
-- when the plugin has an agent half Lamaste connects to. JSON text; NULL for
-- server plugins and identity-only agent-hosted plugins.
ALTER TABLE plugins ADD COLUMN agent TEXT;
