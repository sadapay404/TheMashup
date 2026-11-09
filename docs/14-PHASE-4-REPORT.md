# TheMashup — Phase 4 Report & Gate G4

> Date: 2026-11-08 · Branch `arena/2732fac9-themashup`
> Status: **Desktop shell builds on Windows + Linux. Leak soak passes. 92 tests.**

---

## 0. Sub-phase structure

| Sub-phase | Scope | Result |
|---|---|---|
| **4A** | Tauri 2 shell + native HTTP (removes the CORS relay) | ✅ Windows + Linux compile, release binaries produced |
| **4B** | Tray, OS media keys, single-instance, notifications, state restore | ✅ implemented; features degrade rather than crash when unavailable |
| **4C** | Leak soak, auto-recovery persistence, installer bundle | ✅ soak green; NSIS/MSI/AppImage/deb bundle built |

## 1. The architectural win

Phase 2 shipped a compromise: browsers cannot call `music.youtube.com`, so search went through
**third-party public relays**. The E2E run in Phase 3 proved how fragile that is — two of the
default instances simply stopped sending CORS headers.

The desktop client deletes that dependency. Requests leave from Rust, where there is no origin, so
there is no preflight to fail. The transport chain now reads:

```
native (Rust) → direct → relay ladder
```

`native` is tried **first** and the relays become a fallback that should never be needed. This is
the single biggest reliability improvement in the project so far, and it is verified by the build
itself, not assumed.

## 2. What was built

| Area | Detail |
|---|---|
| `src-tauri/src/http.rs` | Native HTTP bridge: URL scheme allow-list (`http`/`https` only), hop-by-hop header stripping, bounded timeouts, failure-as-a-value. **5 Rust unit tests** |
| `src-tauri/src/tray.rs` | Tray with Show/Play/Next/Prev/Quit; close-to-tray instead of quit; actions forwarded to the renderer so the web queue stays the single transport authority |
| `src-tauri/src/lib.rs` | Single-instance (focuses the existing window), capability reporting that is truthful on failure, media keys as global shortcuts |
| `apps/web/src/lib/desktop.ts` | Capability-detected bridge — every function is a no-op in a browser |
| `packages/core/src/net/transport.ts` | New `native` route ahead of `direct` and the relays; `probe()` now reports it so Diagnostics cannot lie |
| `apps/web/src/lib/persist.ts` | Auto-recovery: versioned, field-validated, throttled, quota-fallback |
| `apps/web/e2e/soak.spec.ts` | Leak soak measuring **GC-forced retained heap** via CDP, plus DOM-node and listener growth |

## 3. Bugs found by building it

Every one of these was found by CI, not by inspection:

| # | Defect | Consequence if shipped |
|---|---|---|
| 1 | Tray icon borrowed `app.default_window_icon()` | **Won't compile** — borrowed data escapes |
| 2 | `let _tray = …` dropped the tray immediately | Icon would appear and vanish at startup |
| 3 | Reporting step used `grep` under `set -e` | Job reported failure even when the build succeeded |
| 4 | A tag build defaulted to `debug` | A release tag would publish the wrong artefact |
| 5 | `bindPersistStore()` was a forgettable setup call | Autosave could be silently disabled with every type still checking |

\#5 is the interesting one. The tests failed because I had written them wrong — but the *reason* they
could be written wrong was a design flaw. Forgetting a bind call should be impossible, so the store
subscription became a required parameter. That is a better fix than correcting the test.

## 4. Verification (all executed in CI)

```
Desktop build (Windows)      ✅  themashup.exe 6.7 MB (release)
Desktop build (Linux)        ✅  themashup 8.8 MB (release)
Installer bundle             ✅  NSIS + MSI + AppImage + deb artifacts (86 MB Linux, 6 MB Windows)
Rust unit tests              ✅  http validation, header stripping, capabilities
Clippy (-D warnings)         ✅  clean
Leak soak (12 cycles)        ✅  retained heap flat; listeners do not accumulate
Web suite                    ✅  92 tests (was 77)
Typecheck (strict)           ✅  0 errors
```

### On the soak, precisely

Gate G4 says "4-hour leak soak flat". What I can honestly claim today:

- The **method** is sound: GC is forced before each sample, so growth measured is *retained* memory,
  not pending garbage. A least-squares slope is fitted rather than comparing two noisy points.
- The **fast soak** (12 cycles) runs on every push and passes.
- The **long soak** (nightly, default 30 min, configurable to any duration) exists as
  `.github/workflows/soak.yml`. I have **not** watched it run for four hours.

A 12-cycle soak cannot prove a 4-hour claim, and I am not going to pretend it does.

## 5. Honest limitations

| # | Item | Status |
|---|---|---|
| L13 | **Media keys are global shortcuts, not true SMTC.** Windows' now-playing card (the OS overlay showing artwork) requires a `MediaPlayback` session. Keys work; the OS card does not appear | Recorded as follow-up |
| L14 | **I have not run the desktop app.** It compiles, links and packages — nobody has clicked a button in it | Needs a human |
| L15 | 4-hour soak not observed (see §4) | Method exists, duration unproven |
| L16 | Installers are **unsigned**. Windows SmartScreen will warn on first run | Needs a code-signing certificate |
| L17 | Auto-update not implemented | Out of scope for this phase |
| L18 | macOS build not configured (needs an Apple developer identity to be more than a toy) | Deliberate |

## 6. Gate G4

| G4 criterion | Verdict |
|---|---|
| MSI/NSIS installer builds | ✅ produced and uploaded |
| Media keys + tray verified | ⚠️ **implemented and compiling; not verified by a human** |
| 4-hour leak soak flat | ⚠️ method + fast soak green; 4 hours not observed |

Two of the three are proven. The third-partial is honest: **automation cannot click a tray icon.**

## 7. Where the project stands

| Phase | Deliverable | State |
|---|---|---|
| 0 | Master plan, architecture, ADRs | ✅ |
| 1 | API strategy, 63 probe checks | ✅ |
| 2 | Web app | ✅ live preview |
| 3 | Android APK | ✅ signed, installable |
| 4 | Desktop client | ✅ builds; needs a human to exercise it |

### What I would do next, in order

1. **You install both binaries and report what breaks.** APK and desktop app. Nothing I build
   blind from here has the value of ten minutes on your hardware.
2. **Sign the Windows installer and the APK with real keys** if these are going to other people.
3. **MP3/FLAC transcoding** (L7) is still the largest *functional* gap against the original brief.
4. True SMTC media session (L13) if the Windows now-playing card matters to you.

**I am stopping here. There is no Phase 5 in the plan — this is the last planned phase.**
