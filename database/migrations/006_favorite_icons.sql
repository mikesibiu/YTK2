-- Icon per favorite: an https image URL. Channel icons are filled in by the server from the
-- channel's own avatar the first time the list is requested. Safe to re-run.
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS icon TEXT;

UPDATE favorites SET icon = 'https://youtubekids.farace.net/icons/toy-train.jpg' WHERE kind = 'search' AND value = 'toy trains' AND icon IS NULL;
UPDATE favorites SET icon = 'https://youtubekids.farace.net/icons/real-train.jpg' WHERE kind = 'search' AND value = 'Trains' AND icon IS NULL;
