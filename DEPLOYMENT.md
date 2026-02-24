# YTK2 Deployment Guide

This project is deployed with:
- Database: Neon Postgres
- API + Admin UI: Koyeb (single Node.js service)

## Architecture

- The Node service in `service/` serves:
  - REST API (`/api/*`)
  - Admin UI (`/` from `service/public`)
- Neon hosts PostgreSQL.
- Koyeb runs the Node service and injects environment variables.

## 1. Create Neon Database

1. Create a Neon project and database.
2. Copy the Neon connection string.
3. Ensure it includes SSL mode, for example:
   `postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

## 2. Initialize Schema in Neon

Run the schema from `database/schema.sql`.

### Option A: Neon SQL Editor

1. Open Neon SQL Editor.
2. Paste `database/schema.sql`.
3. Execute the script.

### Option B: `psql`

```bash
psql "postgresql://USER:PASSWORD@HOST/DB?sslmode=require" -f database/schema.sql
```

## 3. Deploy Service to Koyeb

Create a Web Service from this repo.

Recommended settings:
- Root directory: `service`
- Build command: `npm ci`
- Run command: `npm start`
- Port: `8080`

Set environment variables in Koyeb:
- `DATABASE_URL=<your neon connection string>`
- `NODE_ENV=production`
- `PORT=8080`
- `ALLOWED_ORIGINS=https://<your-koyeb-domain>` (optional but recommended)

## 4. Verify Deployment

After deployment is healthy:

```bash
curl https://<your-koyeb-domain>/health
curl https://<your-koyeb-domain>/api/filters
```

Admin UI:

- `https://<your-koyeb-domain>/`

## 5. Updates

- Push code changes to your repo.
- Redeploy from Koyeb (or enable auto-deploy).
- For schema updates, apply SQL migrations against Neon.

## Local Development (Optional)

You can still run locally using Docker Compose:

```bash
docker-compose up -d
```

This local path is for development only; production target is Neon + Koyeb.
