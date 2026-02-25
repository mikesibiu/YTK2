# YTK2 Web Frontend

Browser-based kid-safe search UI for testing and home use.

## Architecture

- Web frontend runs from `web/`
- It calls backend `GET /api/search` (server-side YouTube API key)
- No YouTube API key is exposed in browser code

## Environment Variables

- `PORT` (default `8080`)
- `FILTER_API_BASE_URL` (default `https://ytk2.farace.net`)

## Local Run

```bash
cd web
npm install
npm start
```

Open: `http://localhost:8080`

## Koyeb Deploy (for youtubekids.farace.net)

- Create new Koyeb app/service from this repo
- Builder: Dockerfile
- Dockerfile path: `web/Dockerfile`
- Port: `8080`
- Env:
  - `FILTER_API_BASE_URL=https://ytk2.farace.net`

Then map custom domain `youtubekids.farace.net` to that service.
