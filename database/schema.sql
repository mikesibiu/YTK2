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
