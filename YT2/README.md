# YT2

YT2 is a filter layer in front of a parent's own, regular YouTube account. The parent signs in with Google once (read-only). The child then gets a simple big-thumbnail web UI to search YouTube and to watch from the parent's subscriptions and playlists. Every result is filtered server-side before it is returned.

It follows YTK2's conventions (Express, `pg`/Neon, Basic-auth admin UI, plain-JS frontends, `node --test`, Koyeb Dockerfile) but is a separate, self-contained folder: nothing is imported from `service/`, `web/` etc.

## How it works

```
child browser  -->  YT2 server  -->  YouTube Data API (with the parent's OAuth token)
(no credentials)      |  filter rules from Neon (fail closed)
                      |  encrypted refresh token in Neon
parent browser --> /admin/ (Basic auth) --> Google sign-in / keywords / channels / settings
```

- The OAuth authorization-code flow (with PKCE and a `state` cookie) runs on the server. The refresh token is encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) before it is stored in Postgres and is never sent to any browser. The only scope requested is `https://www.googleapis.com/auth/youtube.readonly`.
- Search, subscriptions and playlist calls use the parent's access token. The child UI holds no credentials.

## Filtering rules

Applied to every video after fetching `videos.list?part=snippet,contentDetails,status` for the result ids (batched, 50 per call):

| Rule | Behaviour |
|------|-----------|
| Blocked keywords | Matched as **whole words** against **title, description and each tag**. "ass" does not block "class". Case-insensitive unless the keyword is marked case sensitive. Multi-word keywords are phrases ("escape room" matches "Escape-Room" but not "escape from the room"). Optional plural tolerance (`match_plurals`, on by default: "ghost" also blocks "ghosts"). Fullwidth letters and zero-width characters are normalised before matching. |
| Blocked channels | By channel id (`UC...`). |
| Allowlist-only mode | `allowlist_only = true`: only videos from allowed channels pass. An empty allowlist shows nothing. Blocked channels still apply. |
| Allowed channels vs keywords | Keywords never block a channel on the allowed list. A match is shown to the child and logged in the admin **Review** list, where you can press **Don't alert again** (that channel + word is no longer logged), **Block channel** (blocks it and removes it from the allowed list), or **Dismiss**. Blocked channels, age restriction and live-stream blocking still apply to allowed channels. |
| Access code | The child UI asks for a code (default `6969`, set `CHILD_ACCESS_CODE` to change). Wrong tries are limited to 10 per 10 minutes per IP; a correct code is remembered for 30 days in a signed cookie. The admin UI uses its own login. |
| Age restriction | `ytAgeRestricted` videos are always dropped. |
| Live streams | Live and upcoming premieres dropped when `block_live = true` (default). |
| Made for kids | `made_for_kids`: `off`, `prefer` (list them first), `require` (only made-for-kids). |
| Not embeddable | Dropped (they cannot play in the player anyway). |
| Missing details | Anything without full `videos.list` details is dropped. |

**Fail closed:** rules are loaded from the database before any YouTube call. If they cannot be loaded or are malformed (missing config rows, bad values), the endpoint returns `503 {"error":"filter_unavailable"}` and no items. There is no "serve stale rules after an error" path; the rules cache lasts 10 seconds and admin edits invalidate it immediately.

A search query that itself contains a blocked word returns nothing without spending quota.

## API

Public (rate limited):

- `GET /health`
- `GET /api/search?q=...&pageToken=...`
- `GET /api/subscriptions` (recent uploads from the parent's subscribed channels)
- `GET /api/playlists`
- `GET /api/playlists/:playlistId/items?pageToken=...` (only the parent's own playlists that pass the rules)

Admin (Basic auth; mutating requests need an `X-Requested-With: yt2` header):

- `GET /api/admin/summary`
- `GET/POST /api/admin/keywords`, `DELETE /api/admin/keywords/:id`
- `GET/POST /api/admin/blocked-channels`, `DELETE /api/admin/blocked-channels/:id`
- `GET/POST /api/admin/allowed-channels`, `DELETE /api/admin/allowed-channels/:id`
- `GET /api/admin/flags`, `POST /api/admin/flags/:id/{ignore,block,dismiss}`, `GET /api/admin/alert-ignores`, `DELETE /api/admin/alert-ignores/:id`
- `GET /api/admin/config`, `PUT /api/admin/config/:key` (`allowlist_only`, `block_live`, `match_plurals`, `made_for_kids`)
- `GET /api/admin/google/status`, `GET /api/admin/google/start`, `GET /api/admin/google/callback`, `POST /api/admin/google/disconnect`

`:id` must be an integer, otherwise `400`. Channel ids must be 24-character ids starting with `UC`.

UIs: child UI at `/`, admin UI at `/admin/`.

## Google Cloud OAuth client setup

1. Open https://console.cloud.google.com/ and create a project (e.g. "YT2").
2. **APIs & Services > Library**: enable **YouTube Data API v3**.
3. **APIs & Services > OAuth consent screen** (Google Auth Platform): choose **External**, fill in app name and your email, and add the scope `.../auth/youtube.readonly`.
4. Publishing status: set it to **In production** (button "Publish app"). If it stays in **Testing**, Google expires the refresh token after 7 days and the parent has to sign in weekly. An unverified app in production works for you as a single user (you will click through an "unverified app" warning once); verification is only needed for >100 users.
5. **Credentials > Create credentials > OAuth client ID**, type **Web application**.
   - Authorized redirect URI: `https://YOUR_HOST/api/admin/google/callback`. For local testing also add `http://localhost:8080/api/admin/google/callback`. It must match `GOOGLE_REDIRECT_URI` exactly.
6. Copy the client id and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
7. Generate the encryption key: `openssl rand -base64 32` -> `TOKEN_ENCRYPTION_KEY`.
8. Start the app, open `/admin/`, and press **Sign in with Google**. Sign in with the parent's account and approve read-only access. The admin page shows the connected channel. **Sign out** revokes the token at Google and deletes it from the database.

## Environment variables

See `.env.example`. Required in production (the server refuses to start otherwise): `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`.

Also: `PORT` (8080), `NODE_ENV`, `TRUST_PROXY` (1 behind Koyeb; needed for correct per-IP rate limits and Secure cookies), `RATE_LIMIT_PER_MIN` (120), `SEARCH_RATE_LIMIT_PER_MIN` (20), `ADMIN_RATE_LIMIT_PER_MIN` (120), `SEARCH_CACHE_TTL_SECONDS` (600), `FEED_CACHE_TTL_SECONDS` (900), `YOUTUBE_DAILY_QUOTA_BUDGET` (9000), `SUBSCRIPTION_MAX_CHANNELS` (50), `SUBSCRIPTION_VIDEOS_PER_CHANNEL` (5), `RESULT_LIMIT` (24), `YOUTUBE_REGION_CODE`.

Outside production, missing admin credentials leave the admin open (like YTK2) for local development; in production they are mandatory, and a server built without them rejects admin requests with 503.

## Local development

```bash
cd YT2
cp .env.example .env        # fill in values; NODE_ENV=development
npm install
npm run init-db             # applies database/schema.sql to DATABASE_URL
npm run dev                 # http://localhost:8080  (admin: /admin/)
npm test
```

## Deployment: Neon + Koyeb

**Neon**

1. Create a Neon project/database and copy the connection string (`?sslmode=require`).
2. Apply the schema once: `DATABASE_URL='postgresql://...' npm run init-db`, or paste `database/schema.sql` into the Neon SQL editor. It is idempotent and seeds the starter blocklist and the four config rows.

**Koyeb**

1. Create a service from this Git repository, builder **Dockerfile**, **Work directory** `YT2` (Dockerfile `Dockerfile`).
2. Expose port 8080 (HTTP), health check path `/health`.
3. Set the environment variables above (put secrets in Koyeb Secrets). `NODE_ENV=production`, `TRUST_PROXY=1`.
4. Attach a domain, then set `GOOGLE_REDIRECT_URI` to `https://YOUR_DOMAIN/api/admin/google/callback` and add the same URI to the Google OAuth client.
5. Run a single instance: caches, rate limits and the quota counter are in-memory per process.
6. Open `https://YOUR_DOMAIN/admin/` and sign in with Google.

## Starter blocklist

`database/schema.sql` seeds about 50 keywords (horror, scary, creepy, haunted, ghost, zombie, demon, monster, killer, murder, blood, gore, escape, escape room, nightmare, jump scare, jumpscare, backrooms, creepypasta, fnaf, five nights, poppy playtime, huggy wuggy, siren head, skibidi, granny, scp, slender, horror game, survive, kill, dead, death, weapon, gun, shooting, war, prank gone wrong, roast, 18+, nsfw, plus a few variants such as gory, bloody, slenderman, sprunki, analog horror, killing, killed, shooter). Edit them in the admin UI. Some are broad on purpose and will also hide harmless things, for example "war" (Star Wars), "granny" (Peppa Pig's Granny Pig), "escape", "shooting" (shooting star), "survive", "dead" and "roast".

## Quota

The Data API default quota is 10,000 units per day. An uncached search costs about 101 units (search.list 100 + videos.list 1), so roughly 90 distinct searches per day. Repeated queries are served from a 10-minute cache. The subscriptions feed costs about 1 unit per channel (default 50 channels) per refresh, cached 15 minutes. A soft in-memory budget (`YOUTUBE_DAILY_QUOTA_BUDGET`) stops calls before the real quota is exhausted and the child sees a friendly "enough for today" message. You can request more quota from Google if needed.

## Known limits

- **The access code is short.** A 4-digit code is a child-level gate, not security: it is rate limited, but anyone who learns it can browse the parent's filtered content. Use a longer `CHILD_ACCESS_CODE` if the URL is shared.
- **Playback happens inside YouTube's embed, which YT2 cannot filter.** With `rel=0` the end-of-video suggestions are limited to the same channel, but they are not run through the filter and can be clicked inside the player. The embed is sandboxed (no popups, no top navigation), so its YouTube logo/title links should not leave the page, but this depends on the browser honouring the sandbox.
- **Video ids are not re-checked at play time.** A technically capable child could edit the page and embed any video id. The server filters what it lists, not what the player is asked to load.
- **Text-only filtering.** Matching uses title, description and tags. It cannot see the video content, comments, or thumbnails. Misspellings, leetspeak, and keywords glued to digits ("fnaf2") are not matched. Only plain plurals ("s"/"es") are tolerated, not other word forms.
- **`safeSearch=strict` and `madeForKids` come from YouTube** and are imperfect; `madeForKids` is unknown for some videos (treated as not made for kids in `require` mode).
- **Subscriptions feed is approximate.** It lists the latest few uploads from the first N subscribed channels (default 50, ordered by relevance) via each channel's uploads playlist. It is not YouTube's own subscriptions page, includes Shorts, and YouTube's personalised Home recommendations are not available through the API. In allowlist mode it still fetches all subscribed channels, then filters.
- **Playlists:** only the parent's own playlists returned by the API. Watch Later is not exposed by the API. Playlist entries that are private or deleted are skipped.
- **Channel ids only.** Blocked/allowed channels need the `UC...` id (YouTube channel page > About > Share > Copy channel ID), not an @handle.
- **Single-instance, in-memory state.** Result cache, rate limits and the quota counter reset on restart and are not shared across instances. Rate limiting is per IP and needs `TRUST_PROXY` set correctly.
- **Neon cold starts:** if the database takes longer than about 8 seconds to answer, requests fail closed with 503 until it is awake.
- **Google refresh token** is lost if the OAuth app is in Testing (7-day expiry), if the parent revokes access, or if `TOKEN_ENCRYPTION_KEY` changes; the parent must sign in again and the child UI shows "a grown-up needs to sign in".
