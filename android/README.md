# TheMashup — Native Android (Kotlin + Jetpack Compose)

Full rewrite: **no PC required, ever.** The React UI design is ported as
closely as possible; all logic (extraction, playback, lyrics, downloads,
library, recommendations) is on-device.

📖 **Spec, phases, and build steps: [`docs/ANDROID.md`](../docs/ANDROID.md)**

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
