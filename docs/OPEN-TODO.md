# Open to-do list (updated 2026-10-18)

TODO.md in the repo root is the original Phase 1 plan and is out of date. This file is the current list.

## You (manual steps)
- [ ] YT2: add redirect URI `https://yt2-mysysadmin-15fdcb03.koyeb.app/api/admin/google/callback` to the Web client in Google Cloud project `ytk2-488423`; set consent screen to "In production".
- [ ] YT2: sign in at `https://yt2-mysysadmin-15fdcb03.koyeb.app/admin/` (user `admin`, password = ADMIN_PASSWORD in `YT2/.env`); test child UI at `/` with code 6969.
- [ ] YT2: review the 62 queued dkberktas candidates (Admin > Community lists).
- [ ] YTK2: open `https://incredible-reena-mysysadmin-92a1a6a5.koyeb.app/`, Community lists, click Import per source, then review (Dismiss all for profanity words you don't want).

## Client testing (not yet done on real hardware)
- [ ] Android phone
- [ ] Android TV (Back key, embed "Error 153")
- [ ] Samsung TV / Tizen (CORS under ALLOWED_ORIGINS; if "Search unavailable", report it). BLOCKED 2026-10-19: TV UE58RU7100 at 192.168.50.63 opens port 26101 but sdb and Device Manager both fail with "failed to connect to remote target" after Developer Mode off/on and restarts. Tizen Studio 6.1 is at ~/tizen-studio; certificate profile ytk2 exists (~/SamsungCertificate/ytk2) but its distributor cert has deviceid=UE58RU7100 (model, not DUID) and must be redone via the pencil icon in Certificate Manager once the TV connects. Ideas left: Reset Smart Hub, TV firmware update. ~/tizen-studio.broken can be deleted.

## Optional follow-ups
- [ ] Trim over-broad keywords (die, dead, grave, hell, gun, weapon, skeleton): Bluey 8/24 and Baby Shark 5/25 were filtered.
- [ ] Skull-emoji meme video still passes.
- [ ] Related videos inside the embed (rel=0) are unfiltered.
- [ ] Quota protection for public `/api/search` (about 100 uncached searches/day exhaust 10k units); shared-secret header idea.
- [ ] Attach `ytk2.farace.net` if a Koyeb custom-domain slot frees up.
- [ ] Commit `.claude/`, `.kb/`, `CLAUDE.md`, `claude-kb-readme.md`, `setup-claude-kb.sh`, `skills-lock.json`.
- [ ] Option C (allowlist-first) later.
