# YTK2 Android

Phone and Android TV client for YTK2.

## What it does

- Searches through your backend (`/api/search`); all filtering happens server-side
- If the backend is unreachable or cannot load its rules, search shows nothing
- Plays allowed videos in a locked-down embedded player (cannot navigate away)

## Requirements

- Android Studio Iguana or newer, JDK 17, Android SDK 34
- Running YTK2 backend URL

## Configure

```properties
# android/gradle.properties (or FILTER_API_BASE_URL env var, which overrides it)
FILTER_API_BASE_URL=https://ytk2.farace.net
```

## Build

Open `android/` in Android Studio, or: `JAVA_HOME=<jdk17> ./gradlew testDebugUnitTest assembleRelease`

## Android TV

- TV launcher activity (`LEANBACK_LAUNCHER`); install the same APK on Android TV / Google TV.
- D-pad friendly: topic buttons (Animals, Learning, Music, Science), a search box, focusable results.
