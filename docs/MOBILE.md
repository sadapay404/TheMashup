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

The app **finds the gateway itself** on the LAN — no rebuilds for phone use:

1. **mDNS discovery** — the Express server advertises `_themashup._tcp` (see
   `advertiseOnLan()` in `apps/api/src/server.ts`); on launch the app scans via
   Android's `NsdManager` (`NsdDiscovery` plugin) and probes every advertiser.
2. **Remembered address** — the first server that answers is persisted in the
   WebView (`themashup.server`) and re-probed on later launches.
3. **Setup screen** — if nothing answers (cold PC, mDNS blocked by the router),
   a full-screen picker appears: *Scan again*, a manual **PC LAN IP** field
   (`192.168.1.20` or `http://192.168.1.20:4000`), and an emulator shortcut
   (`10.0.2.2`). The sidebar **API pill** re-opens this flow any time.
4. **Live recovery** — when requests start failing mid-session a
   *Gateway lost — tap to reconnect* chip appears; it re-probes and re-scans.

| Where the app runs | Default API base | Notes |
| --- | --- | --- |
| Android **emulator** | `http://10.0.2.2:4000` (tried automatically) | Host machine's loopback alias |
| **Physical device** | discovered / entered LAN address | Same Wi‑Fi as the PC; PC firewall must allow 4000/8000 |
| Forced override | `VITE_API_BASE=http://<ip>:4000 pnpm mobile:apk` | Still supported; bypasses discovery entirely |

Notes:

- The WebView origin is `https://localhost` while the gateway is plain http —
  `android.allowMixedContent: true` covers WebView loads, and native HTTP
  (discovery probes, downloads) is allowed via `android:usesCleartextTraffic`.
  The gateway always allows the `https://localhost` CORS origin.
- `MDNS_OFF=1` on the gateway disables the advertisement (tests skip it too).
- The resolver must be running too (`pnpm dev` starts API + resolver): the
  gateway proxies stream/download work to `:8000`.

## What's native in the shell

- **Scoped-storage downloads** — the Save button streams through the custom
  `DownloadSaver` plugin (`mobile/android/.../DownloadSaver.java`): the file is
  fetched natively (no base64 across the bridge) into `MediaStore.Downloads`
  on Android 10+ (no permissions) or the legacy public Downloads folder on
  Android 9− (`WRITE_EXTERNAL_STORAGE`, `maxSdkVersion="28"`). Files show up
  in the system Files/Downloads app.
- **Edge-to-edge / cutout** — targetSdk 36 forces edge-to-edge, so the
  content frame is padded with the status-bar, punch-hole (display cutout)
  and gesture-bar insets in `MainActivity`, on the app background `#0A0A0F`
  (never a white band). System-bar icons are forced light-on-dark.
- **Back button UX** — a press closes the top layer (expanded player → queue
  → sidebar), then walks section history (Home/Search/Library/Downloads);
  a **double press within 400 ms jumps to Home**; at Home the press does
  nothing (the system gesture leaves the app — back never force-closes).
  History lives in `uiStore.pageHistory` (in-memory, capped at 30).
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
  back-button decision matrix incl. double-press), `lib/connection.test.ts`
  (URL normalization + health probe), `stores/uiStore.test.ts` (section
  history) and `lib/mediaSession.test.ts` (metadata/state mirroring, action
  handlers, cleanup).
- `pnpm typecheck` — covers `mobile/` config via the web/api/shared projects.
- The native project itself compiles on your machine with `pnpm mobile:apk`
  (Gradle downloads the Android Gradle Plugin from Google's Maven repo).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Stuck on “Connect to TheMashup” | Gateway not running, wrong Wi‑Fi, or PC firewall — start `pnpm dev`, same network, allow ports 4000/8000, tap Scan or type the PC IP |
| `net::ERR_CLEARTEXT_NOT_PERMITTED` | `allowMixedContent` / `usesCleartextTraffic` got reset — re-check config + manifest, re-run `pnpm mobile:sync` |
| Gateway CORS errors in logcat | Origin mismatch — WebView must be `https://localhost` (default `androidScheme`). If you changed the scheme, add your origin to `CORS_ORIGIN` |
| Spinning forever on cold start | Gateway not running / wrong `VITE_API_BASE` — emulator needs `10.0.2.2`, device needs your LAN IP |
| `SDK location not found` | Install Android Studio SDK or set `ANDROID_HOME`; create `mobile/android/local.properties` with `sdk.dir=…` |
| Save button falls back to browser download | `DownloadSaver.save` rejected — check logcat (`chromium` / `Capacitor` tags) for the message |
| Runner never fires | It only runs ≥30 min after backgrounding with `repeat: true`; verify config survived `cap sync` (`assets/capacitor.config.json`) |
