# 15 · Previewing the app on Google Cloud Shell

**Short answer:** yes for the UI, playback and downloads. **No for sign-in** — and not because of
Cloud Shell. There is no sign-in button in the web UI at all (see §0).

This document is the set of instructions to paste into Cloud Shell. It assumes nothing is installed.

---

## 0. Read this before you start: what you will and will not see

The app is one React bundle that runs in three shells. The **visual design is identical** in all of
them; the *capabilities* are supplied by whichever shell is hosting it. Cloud Shell runs the plain
browser bundle, so:

| Area | Visible in Cloud Shell? | Why |
|---|---|---|
| Every screen, layout, animation, gesture | ✅ **Pixel-identical** | Same React components, same CSS, same fonts |
| Home, Search, Lyrics recognition, Library, Settings | ✅ | Pure web code |
| Playback (audio) | ✅ | `<audio>` element path |
| Downloads (disk write, progress, cancel) | ✅ with a caveat | Uses the File System Access API; Chrome desktop will write to a folder you pick |
| Like / favourites / affinity learning | ✅ | Local only |
| Queue continuation + local radio ranking | ✅ | Local only |
| **Google sign-in** | ❌ **Absent** | No sign-in control exists in the web UI — see below |
| **Background playback / lockscreen / hardware media keys** | ❌ | Requires the Media3 service in the Android shell |
| **Native multi-threaded download + ffmpeg remux/mux** | ❌ | Requires the Kotlin service |

### The sign-in finding (a real gap, now recorded)

`AccountPlugin.kt` implements the Android sign-in fully: a WebView, `SAPISID` cookie capture,
`EncryptedSharedPreferences` storage, and status reporting. `nativeSignIn()` and
`nativeAccountStatus()` are exported from `apps/web/src/lib/native.ts`. **But nothing calls them.**
There is no button, and Settings only *reads* `service.hasAccount()` to display "Signed in (cookie)"
or "Anonymous".

`service.setCookie()` exists — the browser cookie path works end to end — but it is likewise never
called from any UI. So today:

- the app is **fully functional anonymously** (search and stream come from the public provider
  ladder; this is why every phase so far worked without an account);
- signing in changes nothing user-visible, because no feature is gated behind it yet;
- on Android, nothing ever opens the sign-in WebView.

That means "preview sign-in in Cloud Shell" cannot be answered by a URL — the missing piece is in
the app, not in the environment. Building a real sign-in surface is a code change (tracked as a
follow-up), not a preview step.

---

## 1. The one trap: `main` is empty

The repository's default branch is still the initial empty commit. **A plain `git clone` gives you a
repository with no code.** You must check out the working branch explicitly:

```
arena/2732fac9-themashup
```

Every command below does this.

---

## 2. Paste these, in order

### Step 1 — clone (about 10 s)

```bash
git clone --branch arena/2732fac9-themashup --depth 1 \
  https://github.com/sadapay404/TheMashup.git themashup
cd themashup
```

Verify you have the real code — this must print a number around 150, not 0:

```bash
git ls-files | wc -l
```

### Step 2 — Node 22 (about 20 s)

Cloud Shell usually ships an older Node; the toolchain needs 22.

```bash
nvm install 22 && nvm use 22 && node -v
```

### Step 3 — install dependencies (about 60–90 s)

```bash
npm ci
```

If `npm ci` fails, the sandbox is too new for the lockfile — `npm install` resolves it, but say so,
because that changes the tree rather than reproducing it exactly.

### Step 4 — serve the *production* build (about 30 s)

This is the important step for a faithful preview. `vite dev` serves unbundled ES modules with
development-only warnings; the real app on your phone is a bundled, minified build. Serve that.

```bash
npm run build && npm run preview -w @themashup/web
```

Cloud Shell will print a URL and offer **"Web Preview"**. Click it.

> If the preview panel shows a blank page or a connection error, the dev server is not the problem —
> the preview proxy needs the server bound to `0.0.0.0`. Both `vite` configs in this repo already are,
> so this should work unchanged.

### Step 5 — match the phone exactly

The E2E suite targets a **Pixel 7**, so use the same viewport for a faithful comparison:

1. Open the preview URL in **Chrome**.
2. `F12` → click the device-toolbar icon (`Ctrl+Shift+M`).
3. Choose **Pixel 7** in the device dropdown.

The app is mobile-first and safe-area aware; this is the geometry it was designed against.

---

## 3. What to actually try (5-minute pass)

| Do this | Expect |
|---|---|
| Type a song name in Search | Real results from the public ladder; the Home screen shows which route answered |
| Tap a result | Artwork-driven colour palette, fades in; mini-player appears |
| Open the full player, drag down | Sheet dismisses with velocity awareness |
| Switch player faces: Artwork → Queue → Lyrics | Lyrics may show a "no synced lyrics" state — that is honest, not a bug |
| Tap the heart | Fills, and the track appears under **Library → Likes** |
| Let a track play to the end | The queue extends itself via local radio ranking |
| Settings → **Run diagnostics** | Live checks; shows which transports are reachable from Cloud Shell |
| Download a track | Chrome asks where to save; progress and cancel work |
| Kill and reopen the tab | Queue, position, likes and settings are restored |
| Rotate the device toolbar | No horizontal overflow |

---

## 4. What this cannot show you, and how to see it instead

- **The true Android look.** The browser is very close, but Chrome's mobile emulation does not
  reproduce Android's system bars, the WebView's font metrics, or the native photo picker. Only a
  device does. Cheapest route: the debug APK from the `android` workflow artefacts, sideloaded via
  `adb install`.
- **Background audio, lockscreen controls, hardware keys.** Needs the APK on a real phone.
- **Native downloads (multi-threaded, resumable, ffmpeg remux/mux).** Needs the APK.

---

## 5. Things that will look wrong and are not bugs

- **Sign-in is absent** — see §0. It is not hidden or broken by Cloud Shell.
- **Some tracks refuse to stream.** Expected: several InnerTube profiles are signature-locked and
  the app falls back down a ladder. Premium-only download tiers are shown but locked *on purpose* —
  the app tells you what each option really does rather than pretending.
- **No 4K H.264.** It does not exist in the catalogue for the targets offered; the app does not
  claim it.
- **Cloud Shell has no audio output.** Playback will advance and the UI behaves correctly, but you
  will not hear sound. Test audio on your phone or a local machine.

---

## 6. Optional: see the automated E2E suite run

This drives the real app in a real browser and asserts the behaviour in the table above:

```bash
npx playwright install --with-deps chromium
npx playwright test --config apps/web/playwright.config.ts
```

---

*Written after the Phase 4 strict audit. The sign-in gap in §0 was discovered while preparing this
document, not before it — which is the honest reason it is documented here and not in the Phase 4
report.*
