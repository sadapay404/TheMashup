# TheMashup — Native Android (Kotlin + Jetpack Compose)

Full rewrite: **no PC required, ever.** The React UI design is ported as
closely as possible; all logic (extraction, playback, lyrics, downloads,
library, recommendations) is on-device.

📖 **Spec, phases, and build steps: [`docs/ANDROID.md`](../docs/ANDROID.md)**

## Current Home, queue, and downloads

- Connect a YouTube account once using the sign-in-only WebView. The app
  verifies the account and displays the Music Home feed in the native Home
  screen; playback is handled by TheMashup. Session credentials are encrypted
  with Android Keystore and excluded from backup. Google can change or block
  the sign-in or the unofficial endpoint.
- Tapping a song plays it without adding a list of search results. The prior
  song stays immediately behind the new one. Use an individual song's queue
  button to add it without interrupting playback.
- Downloads use parallel byte ranges and retain partial segments where the
  source supports safe resume; non-range servers require starting over.
  Speed is source-dependent. Completed videos appear in a separate section
  only when present; completed audio remains under songs.
- The latest offline-playback, notification, and lag-related edits are not yet
  compiled or tested; the next build is paused while more bugs are collected.
  Earlier CI results do **not** prove device playback, FFmpeg execution,
  notification controls, performance, or download speed. See the device
  checklist in `docs/ANDROID.md` before release.

## Debug APK — GitHub Actions (N9, preferred)

Every push to `arena/af3d0d7b-themashup` runs
`.github/workflows/android.yml`: it builds the static ffmpeg bundle for
both ABIs, runs the unit tests, assembles the debug APK, and uploads it as
the **`TheMashup-debug-apk`** artifact (Actions → run → Artifacts). No
local toolchain needed — download and `adb install`.

```bash
# local alternative (needs JDK 17+ and the Android SDK):
cd android
./gradlew assembleDebug
./gradlew test
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

> Note: `app/src/main/jniLibs/` is produced by the CI ffmpeg job (git-ignored).
> A local `assembleDebug` without it still builds — downloads just report
> "ffmpeg is not bundled for this device ABI" until a CI APK is installed.

## Release APK (signing — N8)

The release buildType is already configured (R8 minify + resource shrink +
`proguard-rules.pro`). Signing is opt-in via a git-ignored properties file:

```bash
# 1) one-time keystore (keep it + passwords safe — losing it means
#    uninstall/reinstall to update)
cd android
keytool -genkeypair -v -keystore themashup.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias themashup

# 2) android/app/key.properties  (git-ignored — never commit)
#    storeFile=../themashup.jks
#    storePassword=…
#    keyAlias=themashup
#    keyPassword=…

# 3) signed release APK
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Without `key.properties` the same task produces an unsigned release APK
(`app-release-unsigned.apk`) you can still side-load after aligning/signing
manually with `apksigner`.

First-time Gradle sync needs **JitPack + Google Maven + Maven Central**
(AGP, Compose, Media3, NewPipe Extractor, `org.tukaani:xz`).

Layout: single-module Gradle project (`:app`), package `local.themashup.music`.
