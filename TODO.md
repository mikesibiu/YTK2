# YTK2 Development TODO

## Project Overview
Simple YouTube Kids filter app for Android that blocks content based on title keywords and channel IDs.

## Architecture
- **Filter Service**: Docker container on QNAP (REST API + Web UI)
- **Android App**: Replacement for YouTube Kids with filtering
- **Filter Storage**: JSON file with blocked keywords and channels

## Phase 1: Core Functionality

### 1. Filter Service (Docker on QNAP)
- [ ] Create Node.js/Python REST API
  - [ ] GET /api/filters - returns current filter rules
  - [ ] POST /api/filters - updates filter rules (for web UI)
- [ ] Build simple web interface at /admin
  - [ ] Add/remove blocked keywords
  - [ ] Add/remove blocked channel IDs
  - [ ] Add/remove allowed channel IDs (whitelist mode)
- [ ] Implement filters.json storage
  - [ ] blocked_keywords array
  - [ ] blocked_channels array
  - [ ] allowed_channels array
  - [ ] search_in setting (start with "title" only)
- [ ] Create Dockerfile and docker-compose.yml
- [ ] Configure for QNAP deployment

### 2. Android App
- [ ] Set up Android project structure
- [ ] Implement YouTube Data API integration
  - [ ] Get API key setup instructions
  - [ ] Search videos API
  - [ ] Get video details API
- [ ] Build filter logic
  - [ ] Fetch filters from QNAP service on startup
  - [ ] Cache filters locally
  - [ ] Apply keyword filters to titles
  - [ ] Apply channel blocklist
  - [ ] Apply channel whitelist (if enabled)
- [ ] Create UI
  - [ ] Search interface
  - [ ] Filtered video grid/list
  - [ ] Video player (YouTube embedded player)
- [ ] Handle offline mode with cached filters

### 3. Initial Filter Data
- [ ] Create starter blocklist based on common problematic content
  - [ ] Scary/horror keywords
  - [ ] Violence keywords
  - [ ] Monster-related keywords
  - [ ] Known problematic channels from research
- [ ] Make starter list easily customizable

### 4. Documentation
- [ ] Setup guide for QNAP Docker deployment
- [ ] Android app installation guide (sideload APK)
- [ ] YouTube API key setup instructions
- [ ] Filter management guide

## Phase 2: Enhanced Features (Future)

### Community Filter Integration
- [ ] Research community-maintained blocklists
- [ ] Add ability to import/merge external filter lists
- [ ] Option to subscribe to updated community lists
- [ ] Share your curated filters with other parents (if desired)

### Advanced Filtering
- [ ] Add description filtering (optional toggle)
- [ ] Add tag filtering (optional toggle)
- [ ] Whitelist-only mode
- [ ] Age-based filter profiles

### App Improvements
- [ ] Parent mode with passcode
- [ ] In-app filter management
- [ ] View history tracking
- [ ] Time limits
- [ ] iOS version

### Service Improvements
- [ ] Authentication for admin panel
- [ ] Filter rule categories/groups
- [ ] Import/export filter configurations
- [ ] Activity logs

## Current Status
- Phase 1 - Architecture designed
- Ready to begin implementation

## Technical Decisions Made
- Filter on **title only** to start (configurable later)
- No VPN needed - standalone app approach
- YouTube Data API (free tier sufficient)
- Docker deployment on existing QNAP server
- Web-based admin interface for filter management
- Start with curated starter blocklist (option 3)

## Notes
- QNAP has Docker, DDNS, symmetric gig fiber
- Primary device: Android (iOS later)
- API quota: 10k units/day (enough for single user)
- No authentication needed initially (behind home network)
