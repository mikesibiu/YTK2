# YTK2 Tizen TV MVP

Tizen Web App for Samsung TV (2017+), using your YTK2 filter API.

## Features

- Searches through `GET /api/search` on your backend; filtering is server-side
- No YouTube key or PIN on the TV; if the backend can't answer, nothing is shown
- Player is sandboxed and uses `youtube-nocookie.com`
- Remote-friendly: Back key closes the player, then exits the app

## Configure

Defaults are in `js/config.js` (`FILTER_API_BASE_URL`). To override locally:

```bash
FILTER_API_BASE_URL=https://incredible-reena-mysysadmin-92a1a6a5.koyeb.app ./scripts/config.sh   # writes js/config.local.js (git-ignored)
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
- Tests: `npm test`
