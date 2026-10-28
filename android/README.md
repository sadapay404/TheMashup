# TheMashup — Native Android (Kotlin + Jetpack Compose)

Full rewrite: **no PC required, ever.** The React UI design is ported as
closely as possible; all logic (extraction, playback, lyrics, downloads,
library, recommendations) is on-device.

📖 **Spec, phases, and build steps: [`docs/ANDROID.md`](../docs/ANDROID.md)**

```bash
cd android
./gradlew assembleDebug   # needs JDK 17+ and the Android SDK
./gradlew test
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Layout: single-module Gradle project (`:app`), package `local.themashup.music`.
