# YTK2 Filter Service

REST API service for managing YouTube Kids content filters.

## Features

- REST API for mobile app to fetch filters
- Admin API for managing keywords, channels, and configuration
- PostgreSQL backend (Neon-compatible)
- Web admin UI served from the same service

## API Endpoints

### Mobile App Endpoints

- `GET /api/filters` - Get all filters (keywords, channels, config)
- `GET /api/filters/summary` - Get filter statistics
- `GET /api/search?q=...` - Server-side YouTube search with filtering

### Admin Endpoints

- `GET /api/admin/keywords`
- `POST /api/admin/keywords`
- `DELETE /api/admin/keywords/:id`
- `GET /api/admin/blocked-channels`
- `POST /api/admin/blocked-channels`
- `DELETE /api/admin/blocked-channels/:id`
- `GET /api/admin/allowed-channels`
- `POST /api/admin/allowed-channels`
- `DELETE /api/admin/allowed-channels/:id`
- `GET /api/admin/config`
- `PUT /api/admin/config/:key`

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `PORT` - Server port (default: `8080`)
- `NODE_ENV` - `development` or `production`
- `ALLOWED_ORIGINS` - CORS allowlist (required in production)
- `YOUTUBE_API_KEY` - Required for `/api/search` endpoint
- `ADMIN_USERNAME` - Admin basic-auth username (required in production)
- `ADMIN_PASSWORD` - Admin basic-auth password (required in production)
- `DB_SSL_REJECT_UNAUTHORIZED` - SSL cert verification toggle (`true` by default; set `false` only if provider cert chain requires it)

## Local Run

```bash
cd service
npm install
cp .env.example .env
npm run dev
```

## Production Target

- Database: Neon
- Hosting: Koyeb

See [DEPLOYMENT.md](../DEPLOYMENT.md) for full steps.

## Quick Test

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/filters
```
