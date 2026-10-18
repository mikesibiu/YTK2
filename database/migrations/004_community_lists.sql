-- Community lists: imported public lists go to a review queue; nothing is applied automatically.
-- Safe to re-run.
ALTER TABLE blocked_channels ADD COLUMN IF NOT EXISTS source VARCHAR(64);
ALTER TABLE blocked_keywords ADD COLUMN IF NOT EXISTS source VARCHAR(64);

CREATE TABLE IF NOT EXISTS community_sources (
    source VARCHAR(64) PRIMARY KEY,
    last_imported_at TIMESTAMP,
    entry_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS community_candidates (
    id SERIAL PRIMARY KEY,
    source VARCHAR(64) NOT NULL,
    type VARCHAR(16) NOT NULL CHECK (type IN ('channel', 'keyword')),
    value VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    category VARCHAR(64),
    reason TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'removed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP,
    UNIQUE (source, type, value)
);

-- Handle lists (AiSList) are stored whole; matches are queued when a channel's handle is known.
CREATE TABLE IF NOT EXISTS community_handles (
    source VARCHAR(64) NOT NULL,
    handle VARCHAR(128) NOT NULL,
    PRIMARY KEY (source, handle)
);

-- channel id -> handle cache, filled lazily from channels.list as channels appear in results.
CREATE TABLE IF NOT EXISTS channel_handles (
    channel_id VARCHAR(255) PRIMARY KEY,
    handle VARCHAR(128),
    channel_name VARCHAR(255),
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_channel_handles_handle ON channel_handles(handle);
CREATE INDEX IF NOT EXISTS idx_community_candidates_status ON community_candidates(status, source);

INSERT INTO config (key, value, description) VALUES
    ('community_auto_block', 'false', 'When true, channels matching an imported community list are blocked at once instead of waiting for review')
ON CONFLICT (key) DO NOTHING;
