# YTK2 Tizen TV MVP

Tizen Web App for Samsung TV (2017+), using your YTK2 filter API.

## Features

- Fetches filters from `GET /api/filters`
- Searches YouTube Data API v3
- Blocks by keyword + blocked channel list
- Whitelist enforcement is disabled for now (by request)
- Parent PIN required to refresh filters
- Remote-friendly TV layout

## Configure

Base defaults are in `js/config.js`.

## One Script Setup (Environment Injection)

Use one command to inject runtime secrets/config from env (or `~/.api_keys`):

```bash
./scripts/config.sh
```

This script:
- loads `~/.api_keys` if present
- requires `YOUTUBE_API_KEY`
- writes `js/config.local.js` (git-ignored)

Optional overrides before running script:

```bash
export FILTER_API_BASE_URL=https://ytk2.farace.net
export PARENT_PIN=1967
./scripts/config.sh
```

To remove local injected config:

```bash
./scripts/config.sh clean
```

## Run on Samsung TV (Tizen Studio)

1. Install Tizen Studio + TV Extension.
2. Enable developer mode on TV and set your laptop IP.
3. In Tizen Studio, open this `tizen/` folder as a Web App project.
4. Build package (`.wgt`).
5. Install/run on connected TV.

## Notes

- This is MVP quality for fast iteration.
- For production-hardening, next steps are custom PIN UI, local cache, and stricter session controls.
