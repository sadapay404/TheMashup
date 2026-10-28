# TheMashup — Android (Capacitor)

Phase 8 wraps the production web build (`apps/web/dist`) in a native Android
shell via **Capacitor 8** (`mobile/`). The WebView loads the bundled SPA; the
app talks to the gateway on your LAN exactly like the desktop shell does.

> The sandbox/CI used to author this repo has **no JDK or Android SDK**, so
> APKs are compiled on your machine with the steps below. Everything else
> (web bundle, native project, plugin wiring, tests) is committed and verified.

## Layout

| Path | What it is |
| --- | --- |
| `mobile/capacitor.config.json` | App id `local.themashup.player`, `webDir ../apps/web/dist`, `server.androidScheme: https` (WebView origin `https://localhost`), `android.allowMixedContent: true` (http gateway from https WebView), BackgroundRunner config |
| `mobile/package.json` | Capacitor deps live here (plugin discovery needs them in this folder) |
| `mobile/android/` | Generated native project — committed as source (including the custom `DownloadSaver` plugin) |
| `apps/web/public/runners/background.js` | BackgroundRunner script (bundled to `dist/runners/`) |
| `apps/web/src/lib/mediaSession.ts` | Lock-screen / notification / headset controls (`navigator.mediaSession`) |
| `apps/web/src/lib/mobile.ts` | Capacitor detection, scoped-storage save, back-button decision table |

## Prerequisites (your machine)

1. **JDK 21+** (Temurin/OpenJDK; Capacitor 8 targets Java 21).
2. **Android Studio** (or command-line SDK) — `ANDROID_HOME` set, `platform-tools`
   installed. Android Studio is also the easiest way to install an emulator:
   Device Manager → create e.g. *Pixel 7, API 34*.
3. Node 22+ and pnpm 9 (repo root): `pnpm install && pnpm setup`.

## Build a debug APK

```bash
pnpm mobile:apk
# → mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

This runs, in order: `apps/web` production build → `cap sync android` (copies
web assets + config, updates plugin registry) → `gradlew assembleDebug`.

Install on a connected device/emulator:

```bash
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the project in Android Studio (`cd mobile && pnpm open`) and press ▶.

## Talking to the gateway

| Where the app runs | API base | What you need |
| --- | --- | --- |
| Android **emulator** | `http://10.0.2.2:4000` (default, built in) | Gateway on the host: `pnpm dev` |
| **Physical device** | `http://<your-LAN-IP>:4000` | `VITE_API_BASE=http://192.168.x.x:4000 pnpm mobile:apk` |

Notes:

- The WebView origin is `https://localhost` while the gateway is plain http —
  `android.allowMixedContent: true` covers this, and the gateway always allows
  the `https://localhost` CORS origin (app/api/src/config.ts).
- `VITE_API_BASE` is baked at **build** time (it's a Vite env var), so rebuild
  after changing it.
- The resolver must be running too (`pnpm dev` starts API + resolver): the
  gateway proxies stream/download work to `:8000`.

## What's native in the shell

- **Scoped-storage downloads** — the Save button on the Downloads page writes
  through the custom `DownloadSaver` plugin
  (`mobile/android/.../DownloadSaver.java`): `MediaStore.Downloads` on
  Android 10+ (no permissions), legacy public Downloads folder on Android 9−
  (`WRITE_EXTERNAL_STORAGE` is declared with `maxSdkVersion="28"`). Files show
  up in the system Files/Downloads app.
- **Lock-screen / notification controls** — driven by `navigator.mediaSession`
  from the page (metadata, artwork, play/pause/next/prev/seek, seek bar
  position). This is intentionally page-driven: it sees the real player state.
- **BackgroundRunner** — `@capacitor/background-runner` is installed and
  configured (`playerHeartbeat`, every 30 min after backgrounding, auto-start).
  The handler is deliberately minimal: it refreshes notification permissions
  and resolves. The runner runs in an **isolated JS engine with no shared
  state** with the page, so it cannot drive playback — media controls are
  MediaSession's job. Treat the runner as the hook for future background work
  (e.g. scheduling syncs), not as a second player.
- **Hardware back button** — collapses the expanded player → closes queue /
  sidebar → exits the app (testable on the emulator's back gesture).
- **Media keys** — play/pause/next/prev from Bluetooth headsets and the
  system media output panel via the same MediaSession handlers.

## Release build & signing

```bash
pnpm mobile:apk:release   # → app/build/outputs/apk/release/app-release-unsigned.apk
```

Gradle won't sign release APKs until you configure a keystore (do this once):

```bash
keytool -genkey -v -keystore ~/themashup-release.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias themashup
```

Then in `mobile/android/key.properties` (never commit it — already ignored):

```properties
storeFile=/absolute/path/themashup-release.jks
storePassword=…
keyAlias=themashup
keyPassword=…
```

and in `mobile/android/app/build.gradle` add a `release` signing config that
reads those properties (standard Capacitor/Android pattern). For personal use
you can instead sideload the unsigned APK signed with apksigner.

## Tests & checks

- `pnpm test` — includes `lib/mobile.test.ts` (detection, filename safety,
  base64 chunking, back-button decisions) and `lib/mediaSession.test.ts`
  (metadata/state mirroring, action handlers, cleanup).
- `pnpm typecheck` — covers `mobile/` config via the web/api/shared projects.
- The native project itself compiles on your machine with `pnpm mobile:apk`
  (Gradle downloads the Android Gradle Plugin from Google's Maven repo).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `net::ERR_CLEARTEXT_NOT_PERMITTED` | `allowMixedContent` got reset — re-check `capacitor.config.json` and re-run `pnpm mobile:sync` |
| Gateway CORS errors in logcat | Origin mismatch — WebView must be `https://localhost` (default `androidScheme`). If you changed the scheme, add your origin to `CORS_ORIGIN` |
| Spinning forever on cold start | Gateway not running / wrong `VITE_API_BASE` — emulator needs `10.0.2.2`, device needs your LAN IP |
| `SDK location not found` | Install Android Studio SDK or set `ANDROID_HOME`; create `mobile/android/local.properties` with `sdk.dir=…` |
| Save button falls back to browser download | `DownloadSaver.save` rejected — check logcat (`chromium` / `Capacitor` tags) for the message |
| Runner never fires | It only runs ≥30 min after backgrounding with `repeat: true`; verify config survived `cap sync` (`assets/capacitor.config.json`) |
