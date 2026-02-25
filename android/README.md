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
PARENT_PIN=1967
```

You can also set environment variables instead (these override `gradle.properties`):

```bash
export FILTER_API_BASE_URL=https://ytk2.farace.net
export YOUTUBE_API_KEY=your_youtube_data_api_key
export PARENT_PIN=1967
```

## Build

Open `android/` in Android Studio and run app on device.

## Android TV

- The app now includes a TV launcher activity (`LEANBACK_LAUNCHER`).
- Install the same APK on Android TV / Google TV.
- TV mode provides preset searches (Animals, Learning, Music) plus filter refresh (PIN-protected).

## Current limitations

- MVP search/player only (no offline cache yet)
- Parent PIN currently protects filter refresh action
- YouTube API quota applies
