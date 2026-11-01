# TheMashup

Local-first music player. Plays audio resolved from public catalog sources (Piped / Invidious mirrors, with an iTunes 30s-preview failover),
local files and offline downloads. Keeps playlists, liked songs and history on your device.

| Folder | What it is |
| --- | --- |
| `src/` | **Web edition** (Next.js + PostgreSQL / Drizzle). Runs in the preview, also exposes `/api/search`, `/api/stream`, `/api/lyrics` … |
| `android/` | **Android app** – Kotlin, Jetpack Compose, Media3/ExoPlayer. Builds a debug APK. |
| `windows/` | **Windows app** – C#, Avalonia 11, .NET 10, LibVLCSharp. Builds a self-contained win-x64 EXE. |
| `.github/workflows/` | CI for both native apps (no local toolchain needed). |

## Build with GitHub Actions (recommended)

1. Create a GitHub repo and push this project (`git init && git add . && git commit -m init && git remote add origin <url> && git push -u origin main`).
2. **Actions → "Android APK" → Run workflow** → download artifact `TheMashup-debug-apk` → `app-debug.apk`. Install with `adb install app-debug.apk` or copy it to the phone.
3. **Actions → "Windows EXE" → Run workflow** → download `TheMashup-win-x64.zip`, unzip, run `TheMashup.exe`.
   Keep the `libvlc` folder next to the EXE (it is part of the zip) – that is the audio engine.

Pushing to `main` triggers the matching workflow automatically.

## Manual build commands (if you do have the toolchains)

```bash
# Android (JDK 17, Android SDK 34, Gradle 8.9+)
cd android && gradle assembleDebug
#   -> android/app/build/outputs/apk/debug/app-debug.apk

# Windows (.NET 10 SDK)
dotnet publish windows/TheMashup/TheMashup.csproj -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish
#   -> publish/TheMashup.exe (+ publish/libvlc)
```

## ffmpeg (Android)
The workflow downloads static ffmpeg builds into `android/app/src/main/jniLibs/{arm64-v8a,armeabi-v7a}/libffmpeg.so`.
At runtime `DownloadCenter` uses it to convert downloads to MP3 (128/192/320k). If the binary is missing, downloads keep the original container.
(ffmpeg static builds are GPL-licensed; review before distributing.)

## Known platform notes
* Android: no `android.media.audiofx.Equalizer` binding – EQ preset and normalization strength are tracked as state; normalization is applied as volume headroom.
  Crossfade is a fade-out/fade-in (single ExoPlayer). Gapless uses ExoPlayer's playlist pre-buffering with lazily resolved stream URIs.
* Windows: LibVLCSharp `Rate` is read-only and the equalizer API is not used – speed/EQ are stored preferences only.
  The Node search host (`host.mjs`) is not bundled; search goes to public sources directly and shows a clear "not available" message if everything is unreachable.
  YouTube sign-in detects the WebView2 runtime and shows an install message if it is missing (never crashes); the cookie is then pasted and verified.
* Web: sign-in uses cookie paste (verified against the YouTube Music account endpoint).

## Tested here
The web edition builds and passes type-checking in the sandbox. The sandbox has no JDK / Android SDK / .NET SDK, so the Android and Windows projects
were written but **not compiled here** – CI is the build path.
