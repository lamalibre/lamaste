-- Where a plugin's code runs (manifest `hosting`, 4.2). Rows written before
-- the column existed are server plugins.
ALTER TABLE plugins ADD COLUMN hosting TEXT NOT NULL DEFAULT 'server';
