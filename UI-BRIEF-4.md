# UI BRIEF 4 — status bar, search, notifications, downloads (APK 46)

**Date:** 2026-11-12 · **Branch:** `arena/0f8a3444-themashup`
**Base:** `a758235` (`v0.3.0-apk.45`) · **Shipped:** `v0.3.0-apk.49` · **Commit:** `b307df0`
**Release:** https://github.com/sadapay404/TheMashup/releases/tag/v0.3.0-apk.49

**Why 49 and not 46:** tags 46–48 belong to a *different* lineage (`arena/2732fac9-themashup`, which
forked at `7a3a764` and does not contain apk.45). It raised the playback channel to DEFAULT and made
`dockBottom()`'s compact branch meaningful; the channel work is superseded by `NotifyChannels` here,
and `dockBottom`'s dead parameter is removed. 49 is the first free number on this branch.

**Playback is frozen this round.** Transport, the resolver ladder, stalls and `usePlayer` logic were
not touched. Nothing in this document claims playback is fixed; the device verdict on APK 45 is still
unknown.

---

## 1. The status bar collision (the "separator")

**Cause.** The app draws edge-to-edge (transparent bars in `styles.xml`), which moves the job of
staying clear of the system bars onto CSS. Two things were missing: nothing reserved the top inset,
and `env(safe-area-inset-top)` reports **0** in Capacitor's WebView, so a CSS-only fix would have
looked right in a desktop browser and stayed broken on the phone.

**Fix, in three layers:**

| layer | file | what it does |
|---|---|---|
| fallback | `styles/tokens.css` | `--safe-t: max(env(safe-area-inset-top, 0px), 28px)` — never zero, even before measurement |
| measurement | `lib/safe-area.ts` + `shell/UiPlugin.kt` | the shell reports the **real** status bar, cutout and gesture insets in dp; written to `--safe-t`/`--safe-b`/`--safe-l`/`--safe-r` |
| consumption | `lib/layout.ts` | `statusBarTop()/screenTop()/stickyTop()`; every screen pads with them |

`App.tsx` draws the visible **separator**. The first version filled the band with the theme ground
(`--color-void`), which on a dark theme is a black strip above the content — reported as looking
"very weird" and out of place, and it was: an opaque slab in the ground colour is a letterbox, not
chrome. The separator is now a **layer** rather than a block:

- the tint is mixed from `--accent` over `--color-void` at 14% → 8%, so it belongs to the theme in
  every palette and cannot disappear into an all-black (amoled) theme the way a ground-colour fill
  does;
- `backdrop-filter: blur(18px) saturate(150%)` makes content scroll *under* it, which is what makes
  it read as part of the interface;
- it fades to `transparent` at the bottom instead of ending on a hard edge — there is no seam to
  call out of place;
- the hairline is a soft accent gradient that dies at both ends, matching the dock and the song card.

Still `fixed`, still `pointer-events-none`, still no layout cost. Six assertions in
`src/test/separator.test.ts` pin those properties, because the failure mode is theme-specific and
easy to skip past.

`values/styles.xml` sets `windowLayoutInDisplayCutoutMode=shortEdges` (stops some OEM skins from
letterboxing the WebView under a punch-hole). `values-v29/styles.xml` is new: it turns off Android 10+'s
enforced translucent-bar scrim, which otherwise paints a grey band *over* the separator.

---

## 2. Search: centred, then pinned to the top

One input, not two. It sits at `38dvh` above the fold with the invitation above it and springs to the
top under the status bar on focus. Because the element never remounts, the caret, the selection and
the on-screen keyboard survive the transition. Filters and the link-paste banner appear only in the
engaged state.

---

## 3. Notifications

Before this round the app had exactly **two** notifications, both side effects of other features (the
download foreground service and the Media3 session). Every user-facing message was a four-second toast
inside the WebView — invisible if the app was backgrounded or the screen was off.

**New: `MashupNotify`** (`notify/NotifyPlugin.kt`) + `lib/notifications.ts`.

- `store.notify()` now mirrors to the shade. Failures and results ("Saved", "Downloaded N tracks",
  "Moved to…") always notify; micro-confirmations ("Added to likes") stay toasts on purpose.
- The downloader keeps **one standing progress row** (id 6010, updated in place, cleared when the queue
  drains) that covers jobs the native service never saw.
- Tapping a notification opens the screen it is about: the route is parked in `NotifyPlugin.pendingRoute`
  by `MainActivity` and pulled by the page at boot and on resume.
- Permission: asked lazily on the first real post, not at boot. `DownloadSheet` says so honestly when
  the shade is off; Settings → Diagnostics has a **Notifications** row.

**Channels** now live in one object, `notify/NotifyChannels.kt`, because Android silently drops a post
to a channel that was never created and the two services used to create their own copies:

| id | importance | why |
|---|---|---|
| `mashup_alerts` | DEFAULT | failures and results |
| `app.themashup.music.playback.v2` | DEFAULT | **was LOW** — filed under "Silent" on the user's OEM. `v2` because Android freezes importance at creation. Old id deleted. |
| `mashup_downloads` | LOW, **badged** | progress must not buzz; `setShowBadge(false)` made the whole feature invisible |

The download **result** row posts to `mashup_alerts` (failures) / `mashup_downloads` (success), so a
finished transfer leaves a mark.

---

## 4. Downloads — what was verified and what was not

Traced end to end: `DownloadSheet.start()` → `startDownload()` (headers forwarded) → `nativeDownload` →
`DownloadPlugin.enqueue` → `resolveDir`/`sanitize` → `startForegroundService` → `DownloadService`
(chunked GET with `Range` + resolver headers, `.part` → atomic rename) → `DownloadEvents.complete` →
JS `downloadComplete` → job `done`, toast + notification.

**Verification:** the contract is exercised by tests (`download-lifecycle`, `downloader`). The APK is
the first device test. **Not verified in the sandbox:** no Android SDK, and release assets cannot be
downloaded here.

Known limits, stated rather than hidden: files go to app-private `files/Music` by default (no public
`Music/` opt-in is exposed in the UI yet), and `.mp3` targets need a transcoder that this build does not
bundle.

---

## 4b. Downloads play policy — autoplay + shuffle, Downloads only

The user's rule: **only in Downloads**, songs play back to back with no delay, and there is a shuffle
button. Three pieces, none of which touch the transport:

1. **`queueOrigin`** (`'library' | 'downloads'`) is stored with the queue. The player reads it when a
   track *ends*, several screens away from where the queue was filled, so the decision has to live in
   state rather than in the screen.
2. **End of a downloads queue never reaches for radio.** That network resolve was the delay: the last
   track finished, the app silently started resolving something, and the next song took seconds or
   never came. A downloads queue now wraps to track one and starts immediately. Every other surface
   keeps the existing radio extension.
3. **Shuffle is scoped.** The Downloads toggle records the previous global value in
   `shuffleBeforeDownloads`; `playTrack()` restores it the first time something that did not come from
   Downloads is played. Toggling twice cannot lose the user's real preference.
4. **Prefetch.** Ten seconds before a downloads track ends, the next file URL is resolved into a ref, so
   the hand-off at end-of-track is a `play()` rather than a lookup. Only local files — a remote URL is
   signed and short-lived, so pre-registering it for a track that may never play is a leak.

UI: `Play N` and a shuffle toggle above the folder list, both disabled when nothing is stored, with one
line of copy saying the folder loops and needs no network.

Tests: `downloads-autoplay.test.tsx` (9) — origin is passed, play-all passes the whole list, shuffle
starts at a different track, the preference is remembered and not overwritten.

---

## 5. Other UI fixes

- Toast sat at a hardcoded `safe-area + 148px`, which cleared the dock but **not** the song card. It is
  now computed from `toastBottom(hasCard)`.
- `overflow-x: clip` on `html`/`body`: full-bleed animation used to make the page horizontally
  pannable for a frame.
- `theme-color` follows the active theme instead of a hardcoded black, and `body` pads by `--safe-l/-r`.
- Player motion: artwork lift on track change, a breathing halo on the play button while audio is
  playing, a springier face pill. Transform/opacity only. **No transport logic touched.**
- NavPill, AddToSheet, DownloadSheet, primitives all read `--safe-b` instead of `env()`.

---

## 5b. The five reports from apk.49

### The separator looked like a black bar
Fixed as described in §1. The point is not the blur: it is that the band no longer derives its colour
from the *page ground* but from the *accent*, so it reads as chrome in every theme.

### The notification only appeared when downloading
This was a real structural bug, not a styling one. `MediaSessionService` registers a session with its
notification manager **only** from `onGetSession()`, i.e. when a `MediaController` connects. This app
never creates one — playback goes `PlaybackBridge` → `player.setMediaItem()` directly. So no controller
ever connected, `getConnectedControllerForSession()` returned null, and `shouldShowNotification()` was
therefore always false. `DownloadService` posts its own notification by hand, which is precisely the
asymmetry reported.

Three changes, all in the native layer:

1. `addSession(mediaSession)` after the session is built, so Media3 attaches its own controller.
2. `refreshNotification(...)` after `prepare()` and on `resume()`, so the entry appears on *play*
   rather than waiting for a convenient state change.
3. `NowPlayingNotification`, the LibreTube-shaped provider: owns the notification id, channel, a real
   single-colour small icon (`ic_stat_music` — the library default dot is dropped by several OEM
   skins), and forces `FLAG_ONGOING_EVENT`, which the stock provider hard-codes off.

Copied from LibreTube `util/NowPlayingNotification.kt` and `services/AbstractPlayerService.kt`;
not copied: per-build re-creation of the session activity intent, which exists there for a
`singleTask` player activity this app does not have.

### Sign-in opened the YT Music site
Now: `accounts` enumerates the device's Google identities via `AccountManager`
(`getAccountsByTypeAndFeatures("com.google", ["service_yt"])`, permission-guarded, empty-list
tolerant), the Settings screen renders them as a picker, and `signInAs(email)` threads the chosen
identity into Google's `passive=true` endpoint so no login page appears. The old WebView flow is the
**fallback**, reached when there is nothing to pick or via "Use a different account…".

Backing out now posts `signInDismissed`, so the button stops saying "Waiting for Google…" the moment
the dialog goes away — that was the "press back and it does not sign up" complaint.

**What this does not do.** It does not implement OAuth. A real Google Sign-In needs a Web client ID
and this build's SHA-1 registered in a Cloud project; neither exists and neither can be created on
the device. Rather than fake it, the app offers the mechanism that actually yields what it needs: a
`music.youtube.com` session cookie.

### "Find anything" twice
The hero heading is now **"Search it, listen it, repeat it"**. The empty state keeps "Find anything",
which is the only place it belongs. Three assertions pin the pair.

### Dock text
Labels removed from both the expanded row and the compact active pill. Icons 21 → 26px, slots now
square at 52px so no dead space sits where a word used to be. `aria-label` survives — an icon-only
dock would otherwise be five unnamed buttons — and the detent maths is untouched because it divides
the container by `ITEMS.length` rather than a fixed width.

---

## 5c. The apk.51 reports

### Sign-in: the previous design could not work, and the screenshots proved it

The user's two screenshots are the whole diagnosis. One shows **Permissions → "Contacts"** with no
account row anywhere; the other lists "Contacts — Not allowed" under Permissions. That "Contacts" row
*is* `GET_ACCOUNTS` — Android files it under the Contacts permission group — so the instruction "allow
accounts on this device" pointed at a row that does not exist under that name.

Worse, granting it would not have helped. Since Android 8, `AccountManager.getAccountsByType("com.google")`
**returns an empty array** to ordinary apps even with the permission: Google gates enumeration behind
its own consent flow (`GoogleAuthUtil.requestGoogleAccountsAccess`, or the Play Services picker). The
apk.50 code would have shown an empty list on a phone with three Google accounts on it.

So `GET_ACCOUNTS` is gone from the manifest, `getAccountsByTypeAndFeatures` is gone from the plugin,
and the hand-drawn list is gone from Settings. In their place: `pickAccount` launches the **system**
account picker (`AccountManager.newChooseAccountIntent`), which already knows every signed-in Google
account, needs no permission, and returns the tapped address through `@ActivityCallback`.

The second half of the complaint — *"it should instantly open TheMashup when sign in is complete
instead of opening YT music"* — was a separate bug in the same flow. The cookie harvest only *acted* on
a `music.youtube.com` page, so the dialog waited for YouTube's entire web app to boot before closing.
SAPISID is minted by Google's own consent page, long before that, so the harvest now fires on whichever
page set it. The user closes the dialog where they clicked "Allow", not after a detour through a music
site they did not ask for.

### Seeking restarted the song

Two writers, no arbitration:
- `seek()` wrote the target into the store and told Media3;
- a 1 Hz poll asked Media3 for its position and wrote *that* back.

A poll's answer describes the player as it was when the question was asked, and Media3 answers before
it has necessarily processed the seek — a seek into unbuffered audio is itself a network request. So the
poll kept reverting the playhead, and the next `load()` used the reverted value as the resume point.
From the outside: "I can't skip into the middle, it starts from 0:00."

Fixed on both sides: `seek()` records its target and suppresses the *position* write for 1.2 s (duration
still updates — it never depends on the playhead), then releases so the bar cannot freeze; and the native
`seekTo()` snapshots *after* seeking, so `getState()`'s `refreshCache()` agrees with the target instead
of reverting it.

### Sleep timer removed

Requested. Gone from the store, the shell, the song card, the player sheet — and the 1 Hz countdown
interval that existed only to drive it.

### Responsiveness

Three structural costs, each individually reasonable and all three paid per interaction:

| what | why it was expensive | change |
|---|---|---|
| `App` subscribed to `positionSec` | every second of playback re-rendered the route tree, dock and every screen | subscription moved into the one element that draws the progress hairline |
| `AnimatePresence mode="wait"` | exit and enter run **in series**, so each tab press paid both before showing anything | `popLayout` + 170 ms tween, overlapping the two |
| `backdrop-filter: blur(18px)` on the status bar | fixed, full-width, over scrolling content → per-frame re-sample of everything beneath | removed; the gradient is opaque enough where the icons sit |

Plus `useRecommendations` rebuilt and sorted the whole play history on every Home render; it is now
memoised on `[history, affinity]`.

---

## 6. Verification

`tsc` clean · **342 tests / 35 files** green · `npm run build` OK.
Android run `43176761724` **success** (apk.51, first attempt — no Kotlin round lost).
Every CI step green, including "Verify APK integrity".

New in apk.51: `account-picker.test.ts` (6), `seek-arbitration.test.ts` (5),
`responsiveness.test.ts` (5).
apk.50: `separator.test.ts` (6), `search-slogan.test.ts` (3), `dock-icon-only.test.ts` (4).

New: `src/test/safe-area.test.ts` (9), `src/test/notifications.test.ts` (13),
`src/test/downloads-autoplay.test.tsx` (9).

Two CI rounds were burned on defects that a local Kotlin/`aapt2` pass would have caught, because this
sandbox has no Android SDK:

- `values/styles.xml`: a `--` inside an XML comment is a **resource-compile error**, not a warning. A
  comment that quoted `--safe-t` killed the whole build.
- `NotifyPlugin`: `try { … } catch { null }` as an entire expression body is rejected with "Expecting
  exception variable declaration". Needs `catch (t: Throwable)`.

Both fixed in `7229afe` and `b307df0`. **The rule for the next round: never put `--` in an XML comment,
and always bind a catch variable in Kotlin.**

## 7. What is still unverified

- Device verdict on playback from apk.45 onward: **unknown**. Nothing in this round changes the
  transport, so it neither helps nor hurts; do not describe it as fixed.
- The notification shade behaviour, the status-bar separator, and Downloads autoplay were first device
  tests on apk.49.
- **apk.50**: whether the playback notification now appears on play is the key unverified claim. The
  cause was identified from Media3 1.3.1's own source, not guessed, and `addSession` is provably the
  missing registration — but no device has run it yet.
- **Account enumeration was abandoned as an approach** (see §5c): it cannot work on Android 8+ without
  Google's own consent flow. The system picker that replaced it is untested on a device, but it is a
  documented public intent with no permission requirement, so the risk is the UI, not the plumbing.
- **The seek fix is reasoning, not observation.** The two-writer race explains the symptom exactly and
  both writers are now arbitrated, but no device has confirmed that scrubbing mid-song lands where the
  thumb was dropped.
- **The responsiveness work is measurable but unmeasured here** — this sandbox has no Android device and
  no Playwright browser binary, so the numbers quoted are structural (removed per-frame work, halved
  transition latency), not profiled frame times.
- Install over an older TheMashup will fail with "App not installed" (per-runner debug key). Uninstall
  first, or add `MASHUP_KEYSTORE_BASE64`.
