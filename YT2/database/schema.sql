-- YT2 Database Schema
-- PostgreSQL / Neon initialization script. Safe to re-run (idempotent).

-- Blocked keywords. Matched as WHOLE WORDS / phrases against title, description and tags.
-- Multi-word keywords are phrases ("escape room"). Stored lower-case unless case_sensitive.
CREATE TABLE IF NOT EXISTS blocked_keywords (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(255) NOT NULL UNIQUE,
    case_sensitive BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocked_channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL UNIQUE,
    channel_name VARCHAR(255),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Allowed channels (used when config allowlist_only = true)
CREATE TABLE IF NOT EXISTS allowed_channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL UNIQUE,
    channel_name VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The parent's Google connection (single row). The refresh token is stored ENCRYPTED
-- (AES-256-GCM, key = TOKEN_ENCRYPTION_KEY env var); it is never sent to a browser.
CREATE TABLE IF NOT EXISTS google_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    refresh_token_enc TEXT NOT NULL,
    scope TEXT,
    channel_id VARCHAR(255),
    channel_title VARCHAR(255),
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Keyword matches on ALLOWED channels. Allowed channels are never blocked by keywords; the
-- match is logged here for the parent to review (leave / stop alerting / block the channel).
CREATE TABLE IF NOT EXISTS review_flags (
    id SERIAL PRIMARY KEY,
    video_id VARCHAR(32) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    title TEXT,
    channel_id VARCHAR(255) NOT NULL,
    channel_name VARCHAR(255),
    status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored', 'blocked', 'dismissed')),
    hit_count INTEGER NOT NULL DEFAULT 1,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (video_id, keyword)
);

-- "Don't alert in the future": this allowed channel + keyword pair is no longer logged.
CREATE TABLE IF NOT EXISTS alert_ignores (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL,
    channel_name VARCHAR(255),
    keyword VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (channel_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_review_flags_status ON review_flags(status, last_seen DESC);

CREATE INDEX IF NOT EXISTS idx_blocked_keywords_keyword ON blocked_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_blocked_channels_channel_id ON blocked_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_allowed_channels_channel_id ON allowed_channels(channel_id);

-- Default configuration. The service FAILS CLOSED (503) if any of these four keys is missing.
INSERT INTO config (key, value, description) VALUES
    ('allowlist_only', 'false', 'When true, ONLY videos from allowed_channels are shown (blocked keywords still apply)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO config (key, value, description) VALUES
    ('made_for_kids', 'off', 'off = ignore, prefer = list made-for-kids videos first, require = only made-for-kids videos')
ON CONFLICT (key) DO NOTHING;

INSERT INTO config (key, value, description) VALUES
    ('block_live', 'true', 'When true, live streams and upcoming premieres are hidden')
ON CONFLICT (key) DO NOTHING;

INSERT INTO config (key, value, description) VALUES
    ('match_plurals', 'true', 'When true, a keyword also matches its simple plural (ghost -> ghosts, gun -> guns)')
ON CONFLICT (key) DO NOTHING;

-- Starter blocklist (whole-word matching, so "ass" does not hit "class"). Edit freely in the admin UI.
-- Keywords do NOT block channels on the allowed list; those matches go to the review log instead,
-- so broad scare words are cheap to keep. Words that mostly catch harmless videos (war, granny,
-- shooting, survive, roast, dead) are deliberately left out.
INSERT INTO blocked_keywords (keyword, case_sensitive) VALUES
    ('horror', false),
    ('scary', false),
    ('creepy', false),
    ('haunted', false),
    ('ghost', false),
    ('zombie', false),
    ('demon', false),
    ('monster', false),
    ('killer', false),
    ('murder', false),
    ('blood', false),
    ('bloody', false),
    ('gore', false),
    ('gory', false),
    ('escape', false),
    ('escape room', false),
    ('nightmare', false),
    ('jump scare', false),
    ('jumpscare', false),
    ('backrooms', false),
    ('creepypasta', false),
    ('analog horror', false),
    ('fnaf', false),
    ('five nights', false),
    ('poppy playtime', false),
    ('huggy wuggy', false),
    ('siren head', false),
    ('slenderman', false),
    ('slender', false),
    ('skibidi', false),
    ('sprunki', false),
    ('scp', false),
    ('horror game', false),
    ('kill', false),
    ('killing', false),
    ('killed', false),
    ('death', false),
    ('dead by daylight', false),
    ('walking dead', false),
    ('weapon', false),
    ('gun', false),
    ('shooter', false),
    ('shooting game', false),
    ('prank gone wrong', false),
    ('scream', false),
    ('screaming', false),
    ('evil', false),
    ('cursed', false),
    ('possessed', false),
    ('paranormal', false),
    ('spooky', false),
    ('terror', false),
    ('chucky', false),
    ('annabelle', false),
    ('kidnap', false),
    ('kidnapped', false),
    ('nextbot', false),
    ('18+', false),
    ('nsfw', false)
ON CONFLICT (keyword) DO NOTHING;

CREATE OR REPLACE VIEW filter_summary AS
SELECT
    (SELECT COUNT(*) FROM blocked_keywords) AS blocked_keywords_count,
    (SELECT COUNT(*) FROM blocked_channels) AS blocked_channels_count,
    (SELECT COUNT(*) FROM allowed_channels) AS allowed_channels_count,
    (SELECT COUNT(*) FROM review_flags WHERE status = 'open') AS open_flags_count;

-- Community lists: imported public lists go to a review queue; nothing is applied automatically.
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
