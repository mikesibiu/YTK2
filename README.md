# YTK2

YTK2 is a kid-safe YouTube filtering platform with:

- Hosted filter backend + admin UI (`service/`)
- Android phone + Android TV client (`android/`)
- Samsung Tizen TV client (`tizen/`)

## Current Deployment

- Database: Neon Postgres
- Backend/Admin hosting: Koyeb
- Backend URL (current): `https://ytk2.farace.net`

## Repository Layout

- `service/`: Node.js API and admin web UI
- `database/`: PostgreSQL schema and DB setup notes
- `android/`: Android app (phone + Android TV launcher/activity)
- `tizen/`: Samsung Tizen TV web app
- `DEPLOYMENT.md`: infra deployment steps

## Backend (Service)

Main endpoints:

- `GET /health`
- `GET /api/filters`
- `GET /api/filters/summary`
- `GET/POST/DELETE /api/admin/keywords`
- `GET/POST/DELETE /api/admin/blocked-channels`
- `GET/POST/DELETE /api/admin/allowed-channels`
- `GET/PUT /api/admin/config`

Admin protection:

- Basic auth for `/` and `/api/admin/*` when set:
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`

See: `service/README.md`

## Android App

- Package id: `com.mikesibiu.ytk2kids`
- Includes phone UI + Android TV launcher/activity
- Enforces blocked keywords + blocked channels
- Whitelist enforcement is intentionally disabled for now
- Parent PIN gate for filter refresh

Config:

- `FILTER_API_BASE_URL` and `PARENT_PIN` in `android/gradle.properties`
- `YOUTUBE_API_KEY` from environment variable

See: `android/README.md`

## Tizen App

- Tizen Web App for Samsung TV
- Enforces blocked keywords + blocked channels
- Whitelist enforcement is intentionally disabled for now
- Parent PIN gate for filter refresh

Config injection (single script):

```bash
cd tizen
./scripts/config.sh
```

This loads `~/.api_keys` if present, requires `YOUTUBE_API_KEY`, and creates `js/config.local.js`.

Cleanup:

```bash
./scripts/config.sh clean
```

See: `tizen/README.md`

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

## Notes

- For production deployment details, use `DEPLOYMENT.md`.
- For Samsung child-device enforcement, use Samsung Kids allowed-app controls.
