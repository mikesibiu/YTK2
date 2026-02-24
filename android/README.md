# YTK2 Android MVP

This is a first Android client for YTK2.

## What it does

- Fetches filters from your backend (`/api/filters`)
- Searches YouTube Data API v3
- Hides results that match blocked keywords/channels
- Supports whitelist mode from backend config
- Plays allowed videos in an embedded in-app web player

## Requirements

- Android Studio Iguana or newer
- Android SDK 34
- YouTube Data API key
- Running YTK2 backend URL

## Configure

Create `android/gradle.properties` entries (or edit existing file):

```properties
FILTER_API_BASE_URL=https://your-koyeb-domain.koyeb.app
YOUTUBE_API_KEY=your_youtube_data_api_key
```

## Build

Open `android/` in Android Studio and run app on device.

## Current limitations

- MVP search/player only (no offline cache yet)
- No parent PIN yet
- YouTube API quota applies
