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

Edit `js/config.js`:

```js
window.YTK2_CONFIG = {
  FILTER_API_BASE_URL: 'https://ytk2.farace.net',
  YOUTUBE_API_KEY: 'YOUR_KEY',
  PARENT_PIN: '1967'
};
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
