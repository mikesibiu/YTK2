# Public filter lists for YTK2 / YT2: research (2026-10-18)

Question: can the filters reference a publicly maintained list of channels and words, for YouTube Kids and for regular YouTube?

**Short answer.** Yes, but the useful lists are small or narrow. There is **no maintained public list aimed at scary/horror content for young kids**, which is the main goal here. What exists covers other problems (kidfluencer content farms, AI-generated "slop", profanity). They help at the edges; the keyword filter stays the core defense.

## What I found

| # | Source | What it covers | Size | License | Fresh? | Format | Fit |
|---|---|---|---|---|---|---|---|
| 1 | [dkberktas/youtube-kids-blocklist](https://github.com/dkberktas/youtube-kids-blocklist) | One parent's blocked YouTube Kids channels with a reason and category for each (kidfluencer farms, localized copies, game recordings, chase videos, sleep-autoplay traps, reuploads) | 86 rows: 62 blocked, 24 watchlist; 84 valid channel IDs | **CC0** (public domain) | Created 2026-08-20, last push 2026-09-01 | JSON/CSV with `channel_id` (UC...) | **Best fit.** Direct ID match, tiny, rows carry reasons and categories so you can drop a category. Opinionated: its "language policy" rows are one household's preference. |
| 2 | [AiSList](https://github.com/Override92/AiSList) (via aisloplist.com) | Channels that mostly publish AI-generated video, a growing problem in kids' content | ~29.7k handles (the repo lists ~30.2k lines) | CC BY-NC 4.0 (fine for personal, non-commercial use) | Very active: commits on 2026-10-18, 347 stars, community submissions | Text, one `@handle` per line | **Useful, with work.** Handles only, so each must be resolved to a channel ID (see "Handle resolution" below). |
| 3 | [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) | English profanity and sexual terms | 403 words | CC BY 4.0 (attribution) | Last push 2024-08 | One word per line | **Good as a reviewed keyword import.** Not scary-content words. Review before use. |
| 4 | [coffee-and-fun/google-profanity-words](https://github.com/coffee-and-fun/google-profanity-words) | Bad-words list | 962 | MIT | 2026-06 | One word per line | Same role as #3, bigger, with leetspeak variants. |
| 5 | [NikoboiNFTB/DeSlop](https://github.com/NikoboiNFTB/DeSlop) | Another AI-slop channel list | not measured | GPL-3.0 | 2026-10-04 | Text/JSON | Overlaps #2. Not examined further. |
| 6 | [cmeans/yt-dont-recommend](https://github.com/cmeans/yt-dont-recommend) | A tool, not a list. It bulk-applies "Don't recommend channel" from lists such as AiSList and DeSlop | n/a | Apache-2.0 | 2026-06 | n/a | Different approach: trains YouTube's own recommender on your account. Does not stop a child searching. |
| 7 | Common Sense Media / Sensical lists | Hand-picked kid-friendly channels by interest (e.g. Bluey, Earth to Luna, Vooks) | dozens per article | Editorial, not a data file | Some articles are years old | Web pages | **Allowlist seeds.** Must be hand-copied into channel IDs. |
| 8 | Papadamou et al., "Disturbed YouTube for Kids" ([Zenodo](https://zenodo.org/records/3632781)) | Research dataset of 4,797 labeled videos (929 disturbing) | 4.8k videos | Access **restricted**, request needed | 2020; about 30% of the videos have since been removed | n/a | Too old, video-level, restricted. The classifier code is public but needs training data and GPU work. Not practical. |

## Not useful, or not found
- **Reddit and parenting forums:** my tools cannot read Reddit (blocked). Web search of forums and blogs returned parent guides and opinion pieces (Skibidi Toilet, Poppy Playtime), **no shared channel lists**. A subreddit that tracked Elsagate channels was closed in August 2023. That is a gap in what I could reach, not proof nothing exists.
- **BlockTube:** a popular extension for list-based blocking. A competitor's article calls it dead, though its GitHub repo was last updated in February 2026 (so treat that claim as unconfirmed). The shared BlockTube lists I found are personal or political, not kid-safety.
- **Elsagate datasets on GitHub:** academic code and analyses from 2017 to 2021. No maintained channel list.
- **A scary-content channel list for kids:** none found.

## Pi-hole (checked as you asked)
- **Default and recommended lists:** the default adlist is StevenBlack's Unified Hosts (ads and malware). The community "Big Blocklist Collection" ([firebog.net](https://firebog.net/)) groups lists into Suspicious, Advertising, Tracking, Malicious and Other. The only adult-content entry there is Fabrice Prigent's Adult list (3M+ entries, about 90 MB) plus Chad Mayfield's Top 1M. **None is YouTube-specific or kids-specific.**
- **Block List Project** ([blocklistproject/Lists](https://github.com/blocklistproject/Lists), Unlicense): categories include porn, abuse, drugs, gambling, piracy, scam, tiktok, and a `youtube.txt` file whose contents I could not confirm.
- **The core limit:** Pi-hole blocks whole domains by DNS. YouTube serves every channel from the same domains, so it **cannot block individual channels or keywords**, only all of YouTube or none. My apps also play video through YouTube's own servers, so blocking those domains at DNS would break playback too.
- **Where Pi-hole still helps:** household-wide blocking of adult/porn and malware domains for the child's devices. That protects against the open web, which this project does not.
- **Unverified idea:** DNS-block only the stock YouTube app's API hostname for the child's device group so the official app stops working while the embedded player in these apps keeps working. I have not tested whether that works. The TVs and phones would need their own Pi-hole client group.

## Reality check against live data
I queried the deployed YTK2 service with 12 kids' searches (kids songs, nursery rhymes, toy review, roblox and so on). **194 unique channels were shown to a child.**
- **dkberktas list:** **5** were on it: Kids Roma Show, Vlad and Niki (watchlist), PrestonPlayz, Kyoot, Genevieve's Playhouse. All kidfluencer or reupload farms, not scary content.
- **AiSList:** at least **3** matched by channel name (King English Kids, Mr Book and Me Stories, Learn Bright). This undercounts because I only matched names to handles, not resolved IDs.
- **Takeaway:** each list catches a few percent of what a child sees, in the "content farm" category. None would have caught the "SCARIEST GAME" video I found earlier. Those misses are fixed by keywords, not lists.

## Handle resolution (needed for AiSList)
The list has `@handles`; filtering sees channel IDs. Doing it lazily is cheap:
1. After each search, collect the channel IDs not yet seen and call `channels.list` (`part=snippet`, up to 50 IDs per call, **1 quota unit**) to read each channel's `customUrl` (its handle).
2. Store `channel_id -> handle` in a small table; refresh a row every ~30 days (handles can change; the list tracks changes daily).
3. Match the handle against the AiSList set.
Extra cost: about 1 unit per search (about 1%), versus 21k units to pre-resolve everything. The prebuilt mapping in grantuall/AI-Blocklist-for-Freetube (MIT code, data derived from the CC BY-NC list) could seed the table, but it was last built from an older list.

## Options

**A. Reviewed import (recommended).** Add a "community lists" section to the admin page, import-on-demand, never automatic.
- Sources: dkberktas (channel IDs, CC0) and AiSList (via lazy handle resolution). Optionally LDNOOBW/google-profanity words for a keyword review.
- Imports land in a **review queue** with source, category and reason. You accept (becomes a blocked channel or keyword, tagged with its source), reject, or reject the whole category.
- Your own allowed and blocked channels always win. A conflict with your allowed list is shown, not applied. One click removes everything from a source.
- Works in both YTK2 and YT2, and for regular YouTube as well as Kids content.
- Effort: about one day. Ongoing work: low. **Already done:** the parsers, a diff against existing rules, and a dry-run script (`service/lib/communityLists.js`, `service/scripts/community-lists-dry-run.js`, 27 passing tests). Nothing is wired into the server.

**B. A plus a DNS layer.** Everything in A, plus a Pi-hole (or AdGuard Home) on the home network with its own client groups.
- Adds adult/porn/malware domain blocking for the child's devices and possibly disables the stock YouTube app (the unverified idea above).
- Does not touch YouTube channels or keywords. It needs hardware or a container at home and device-by-device setup.
- Effort: a few hours plus testing. Ongoing: some (lists, device groups).

**C. Allowlist-first.** Switch the apps to "only approved channels", seeded from Common Sense Media lists, Sensical and your own picks. Blocklists become a second layer.
- Strongest protection, and it stops the cat-and-mouse with new content farms.
- Highest ongoing effort: you keep approving channels, and a 6-year-old will ask for things that aren't on the list. The Review log already built in YT2 makes this easier there than in YTK2.

## Recommendation
**A now, and treat C as a later switch** (YT2 already supports allowlist mode and the review log). B only if you also want to keep him off the open web. Do not pursue the Zenodo research dataset or subreddit sources.

Licence notes for A: dkberktas needs no attribution; AiSList is CC BY-NC (personal use, keep the credit in the admin page); LDNOOBW needs attribution (CC BY).

## Sources
- https://github.com/dkberktas/youtube-kids-blocklist
- https://github.com/Override92/AiSList
- https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
- https://github.com/coffee-and-fun/google-profanity-words
- https://github.com/NikoboiNFTB/DeSlop
- https://github.com/cmeans/yt-dont-recommend
- https://github.com/grantuall/AI-Blocklist-for-Freetube
- https://github.com/blocklistproject/Lists
- https://firebog.net/
- https://zenodo.org/records/3632781
- https://www.commonsensemedia.org/articles/youtube-kids-channels-that-promote-stem
