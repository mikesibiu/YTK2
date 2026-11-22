# Amazon Fire TV

The Android app already includes a TV screen (`TvActivity`, launched from the TV home row), so
the same APK runs on Fire TV. It shows the favorites as large icon cards, then the safe videos.
Use the remote's arrows and Select; Back returns to the favorites.

## Install (once per TV)
1. Fire TV: Settings > My Fire TV > About. Select the device name 7 times to unlock Developer Options.
2. Settings > My Fire TV > Developer Options: turn **ADB debugging** and **Apps from Unknown Sources** on.
3. Settings > My Fire TV > About > Network: note the IP address.
4. On the Mac:
   ```bash
   ~/Library/Android/sdk/platform-tools/adb connect <FIRETV-IP>:5555   # accept the prompt on the TV
   ~/Library/Android/sdk/platform-tools/adb -s <FIRETV-IP>:5555 install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
5. The app is under Your Apps & Channels > See all > YTK2 Kids.

Build the APK first with `./gradlew assembleDebug` (JDK 17, see android/README.md).
