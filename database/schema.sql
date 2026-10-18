-- YTK2 Database Schema
-- PostgreSQL initialization script

-- Filter keywords table (for blocking videos by title)
CREATE TABLE IF NOT EXISTS blocked_keywords (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL UNIQUE,
    case_sensitive BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Blocked channels table
CREATE TABLE IF NOT EXISTS blocked_channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL UNIQUE,
    channel_name VARCHAR(255),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Allowed channels table (for whitelist mode)
CREATE TABLE IF NOT EXISTS allowed_channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL UNIQUE,
    channel_name VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Application configuration table
CREATE TABLE IF NOT EXISTS config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_blocked_keywords_keyword ON blocked_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_blocked_channels_channel_id ON blocked_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_allowed_channels_channel_id ON allowed_channels(channel_id);

-- Insert default configuration
INSERT INTO config (key, value, description) VALUES
    ('whitelist_mode', 'false', 'When true, only allowed_channels are permitted')
ON CONFLICT (key) DO NOTHING;

INSERT INTO config (key, value, description) VALUES
    ('search_in', 'title,description,tags', 'Where to search for keywords: title, description, tags, or comma-separated')
ON CONFLICT (key) DO NOTHING;

INSERT INTO config (key, value, description) VALUES
    ('api_version', '1.0', 'Current API version')
ON CONFLICT (key) DO NOTHING;

-- Insert starter blocklist keywords
INSERT INTO blocked_keywords (keyword, case_sensitive) VALUES
    ('scary', false),
    ('horror', false),
    ('creepy', false),
    ('nightmare', false),
    ('haunted', false),
    ('ghost', false),
    ('demon', false),
    ('zombie', false),
    ('fnaf', false),
    ('five nights at freddys', false),
    ('slenderman', false),
    ('siren head', false),
    ('cartoon cat', false),
    ('huggy wuggy', false),
    ('poppy playtime', false),
    ('bendy', false),
    ('granny', false),
    ('monster', false),
    ('killer', false),
    ('murder', false),
    ('blood', false),
    ('gore', false),
    ('violent', false),
    ('disturbing', false),
    ('terrifying', false)
ON CONFLICT (keyword) DO NOTHING;

-- Stricter keywords (escape, kill, jumpscare, ...) live in migrations/002_stricter_keywords.sql.
-- Run it after this file.

-- Create a view for easy filter retrieval
CREATE OR REPLACE VIEW filter_summary AS
SELECT
    (SELECT COUNT(*) FROM blocked_keywords) as blocked_keywords_count,
    (SELECT COUNT(*) FROM blocked_channels) as blocked_channels_count,
    (SELECT COUNT(*) FROM allowed_channels) as allowed_channels_count,
    (SELECT value FROM config WHERE key = 'whitelist_mode') as whitelist_mode,
    (SELECT value FROM config WHERE key = 'search_in') as search_in;

-- Community lists (also in migrations/004_community_lists.sql)
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
