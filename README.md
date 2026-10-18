# YTK2

YTK2 is a kid-safe YouTube filtering platform with:

- Hosted filter backend + admin UI (`service/`)
- Android phone + Android TV client (`android/`)
- Samsung Tizen TV client (`tizen/`)
- Browser web frontend (`web/`)

## Current Deployment

- Database: Neon Postgres
- Backend/Admin hosting: Koyeb
- Backend URL (current): `https://incredible-reena-mysysadmin-92a1a6a5.koyeb.app` (the `ytk2.farace.net` custom domain is not attached; Koyeb allows 5 custom domains and all are in use)

## Repository Layout

- `service/`: Node.js API and admin web UI
- `database/`: PostgreSQL schema and DB setup notes
- `android/`: Android app (phone + Android TV launcher/activity)
- `tizen/`: Samsung Tizen TV web app
- `web/`: browser web frontend for `youtubekids.farace.net`
- `DEPLOYMENT.md`: infra deployment steps

## Backend (Service)

Main endpoints:

- `GET /health`
- `GET /api/filters`
- `GET /api/filters/summary`
- `GET /api/search?q=` (server-side YouTube search + filtering; rate limited, cached)
- `GET/POST/DELETE /api/admin/keywords`
- `GET/POST/DELETE /api/admin/blocked-channels`
- `GET/POST/DELETE /api/admin/allowed-channels`
- `GET /api/admin/config`, `PUT /api/admin/config/:key`

Admin protection:

- Basic auth for `/` and `/api/admin/*`:
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
  - In production, missing auth env vars fail startup.

See: `service/README.md`

## Android App

- Package id: `com.mikesibiu.ytk2kids`
- Includes phone UI + Android TV launcher/activity
- Searches through the backend `/api/search`; no YouTube key or PIN is stored in the app
- Player is locked to the embed (no navigation to youtube.com)

Config: `FILTER_API_BASE_URL` in `android/gradle.properties` (or env var).

See: `android/README.md`

## Tizen App

- Tizen Web App for Samsung TV
- Searches through the backend `/api/search`; no YouTube key stored on the TV
- Back key closes the player, then exits the app

Config: `FILTER_API_BASE_URL` in `tizen/js/config.js` (optional override via `./scripts/config.sh`).

See: `tizen/README.md`

## Web Frontend

- Folder: `web/`
- Uses backend `/api/search` (server-side key, browser key not exposed)
- Deploy as separate Koyeb service using `web/Dockerfile`
- Set `FILTER_API_BASE_URL=https://incredible-reena-mysysadmin-92a1a6a5.koyeb.app`

See: `web/README.md`

## Tests

Backend tests:

```bash
cd service
npm test
```

Tizen tests:

```bash
cd tizen
npm test
```

Android unit tests are included under `android/app/src/test/`.

## Community lists (reviewed import)

Admin page > **Community lists**. Importing a public list only **queues** entries; nothing is blocked until you accept it.

- Sources: `dkberktas` (parent-maintained channel IDs, CC0), `aislist` (AI-generated channel handles, CC BY-NC, personal use), `ldnoobw` (profanity words, CC BY; words common in kids' content are never offered).
- **Block / Dismiss** per entry, or **Block all / Dismiss all** per category. Channels on your allowed list are never blocked from here (shown with a warning).
- `aislist` is handle-based: handles are stored and matched when a channel appears in results (one extra YouTube call per 50 new channels). Matches join the review queue.
- Setting **Block matches immediately** skips review (still never blocks an allowed channel).
- **Remove everything from this source** takes back what it added.
- Needs migration `database/migrations/004_community_lists.sql` (already in `schema.sql`). Research: `docs/community-lists-research.md`.

## Filtering rules

- Keywords match whole words (plus plurals/-ed/-ing), in the title, description and tags.
- Blocked channels, age-restricted videos and (when `whitelist_mode` is on) non-allowed channels are dropped.
- The server fails closed: if rules cannot be loaded, `/api/search` returns 503 and no results.
- Database setup: `database/schema.sql`, then `database/migrations/*.sql`.

## Notes

- For production deployment details, use `DEPLOYMENT.md`.
- For Samsung child-device enforcement, use Samsung Kids allowed-app controls.
