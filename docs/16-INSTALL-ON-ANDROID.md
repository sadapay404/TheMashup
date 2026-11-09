# 16 · Install TheMashup on Android

The APK is built in CI and attached to a GitHub Release, so you can install it straight from your
phone without a cable, an account, or Android Studio.

---

## 1. Download it on the phone

Open this on the phone:

```
https://github.com/sadapay404/TheMashup/releases
```

Pick the newest `v0.3.0-apk.N` release and tap the **`.apk`** asset under *Assets*.

Expect roughly **2 MB**. The release build is R8-minified; a debug build of the same code is about
8 MB, and seeing ~2 MB is the signal you got the release one.

## 2. Allow the install

Android will refuse at first, by design:

1. Tap **Settings** in the warning dialog.
2. Enable **Allow from this source** for your browser (Chrome, Brave, Firefox…).
3. Go back and tap the downloaded file again.

You will see a second warning, because the APK is signed with a **debug certificate** rather than a
Play-store identity. That is expected — see §5.

## 3. First run

- The app opens on **Home**.
- Paste a YouTube or YouTube Music link into **Search** to play something immediately, or search by
  name.
- **Settings → Diagnostics → Run diagnostics** tells you exactly what your network allows. This is
  worth doing first, because what works depends on your carrier more than on the app.

## 4. What works on the APK that does not in a browser

| Feature | Browser | APK |
|---|---|---|
| Full UI, themes, haptics structure | ✅ | ✅ |
| Background playback, lockscreen controls, hardware media keys | ❌ | ✅ |
| Vibration | rarely | ✅ |
| Direct InnerTube (no CORS limit) | ❌ | ✅ |
| Native downloads writing real folders | ❌ | builds directory structure |

## 5. About the signature

CI signs with the **Android debug key** unless you provide a keystore, so:

- the install warning is expected;
- you cannot update over a Play Store install;
- a future build signed with a different key will refuse to update this one — uninstall first.

To sign properly, add three repository secrets and the workflow will use them automatically:

| Secret | Contents |
|---|---|
| `MASHUP_KEYSTORE_BASE64` | `base64 -w0 your.keystore` |
| `MASHUP_KEYSTORE_PASSWORD` | keystore password |
| `MASHUP_KEY_ALIAS` | key alias |
| `MASHUP_KEY_PASSWORD` | key password |

Create one with:

```bash
keytool -genkey -v -keystore themashup.keystore -alias themashup \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 themashup.keystore   # paste this as MASHUP_KEYSTORE_BASE64
```

## 6. If it will not install

| Symptom | Cause |
|---|---|
| "App not installed" | An older build with a different signature is present. Uninstall it first. |
| "There was a problem parsing the package" | The download was truncated. Re-download on Wi-Fi. |
| Installs but a blank screen | The web bundle failed to load. Check `adb logcat | grep -i mashup`. |
| No sound on a track | Check **Settings → Diagnostics**; a blocked network is far more likely than the app. |

## 7. Building it yourself

The workflow is `.github/workflows/android.yml`. Manual runs accept a build type:

- **release** (default for tags) — minified, ~2 MB.
- **debug** — ~8 MB, keeps full symbol names, useful when a crash needs a readable stack trace.

Either way the web bundle is built first and copied in by `npx cap copy android`, so the APK always
contains the same UI you see in the browser preview.
