# UI BRIEF 4 — status bar, search, notifications, downloads (APK 46)

**Date:** 2026-11-12 · **Branch:** `arena/0f8a3444-themashup`
**Base:** `a758235` (`v0.3.0-apk.45`) · **Target tag:** `v0.3.0-apk.46`

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

`App.tsx` also draws the visible **separator strip**: a fixed, pointer-transparent band of exactly
`--safe-t` in the theme ground, with a horizontal hairline at its bottom edge. That is the line the
user asked for between the app and the clock.

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

## 6. Verification

`tsc` clean · **304 tests / 28 files** green · `npm run build` OK.

New: `src/test/safe-area.test.ts` (7) and `src/test/notifications.test.ts` (13).

Kotlin has **not** been compiled locally — no Android SDK. The CI run for tag `v0.3.0-apk.46` is the
first compile of `NotifyPlugin`, `NotifyChannels`, `UiPlugin` and the channel-id changes. If it fails,
read the compile error and fix forward; do not revert the feature.
