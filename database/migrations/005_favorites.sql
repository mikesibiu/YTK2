-- Favorites shown on every client's home screen. A favorite is either a search or a channel handle;
-- channel favorites are still run through the keyword and blocked-channel filters.
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('search', 'channel')),
    label VARCHAR(80) NOT NULL,
    value VARCHAR(200) NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (kind, value)
);

INSERT INTO favorites (kind, label, value, position) VALUES
    ('channel', 'Ryan', '@ryan', 10),
    ('channel', 'Nick DiGiovanni', '@nickdigiovanni', 20),
    ('search', 'Toy trains', 'toy trains', 30),
    ('search', 'Trains', 'Trains', 40)
ON CONFLICT (kind, value) DO NOTHING;
