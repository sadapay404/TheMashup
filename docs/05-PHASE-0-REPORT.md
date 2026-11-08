# TheMashup — Phase 0 Report & Gate G0

> **Document 5 of 5 — Phase 0 deliverable**
> Date: 2026-11-08 · Branch: `arena/2732fac9-themashup`

---

## 1. Repository Reset — Completed

Per instruction, the linked repository was emptied before any work began.

| Step | Result |
|---|---|
| Read existing source | **None.** Only `git remote -v`, `git status`, `git log` (metadata). No file contents were read. |
| Deletion | All top-level entries except `.git` removed (`find … -exec rm -rf`). |
| Verified state before Phase 0 docs | `ls -A` → `.git` only. Staged deletion of the single pre-existing file (`README.md`). |
| Branch | `arena/2732fac9-themashup` — unchanged, no new branches, no force-push. |

The tree is now a clean stage. Everything below is new.

## 2. Phase 0 Artifacts

| File | Contents |
|---|---|
| `docs/00-MASTER-PLAN.md` | Vision, six hard constraints, honesty clause, phase roadmap with objective gates, risk register, definition-of-done, non-goals |
| `docs/01-ARCHITECTURE.md` | Layer spine, six port contracts, module map, end-to-end lyric→play flow, recommendation engine, download engine, performance budgets, four-ring reliability model, security posture |
| `docs/02-TECH-STACK-ADR.md` | Full stack matrix, six ADRs (no-backend transport, Capacitor, Result type, on-device recommender, optional GPL extractor, LRCLIB lyrics), rejected alternatives, compatibility matrix |
| `docs/03-OSS-HARVEST.md` | What is harvested from OuterTune / LibreTube / NewPipe, in what form (pattern vs. optional dependency), licence obligations per build flavor, CI guard |
| `docs/04-DESIGN-SYSTEM.md` | "Liquid Obsidian" concept, tokens, typography, five springs, choreography rules, signature interactions, responsive layout, accessibility targets |

## 3. Key Decisions Taken (summary)

1. **Order changed** to 0 → 1 → 2 (web foundation) → **3 (Android APK)** → 4 (Windows, deferred).
   Android is prioritised as instructed; Windows stays in the roadmap as Phase 4.
2. **Zero-server is enforced architecturally**: static bundle only, `packages/core` is shell-agnostic,
   boundaries lint fails any server-ish import. For the browser's CORS problem we use a **user-editable
   relay ladder** (ADR-001) — not a server we run. Native builds bypass relays entirely.
3. **"FLAC across bitrates" re-specified honestly**: the source ceiling is 256 kbps AAC / ~160 kbps
   Opus; FLAC is a lossless *container* for a transcoded stream and will be labelled as such in the UI.
   Bitrate tiers are the ones the upstream actually returns.
4. **Open-source harvest is a pattern harvest, not copy-paste** — GPL source is never merged into our
   tree; NewPipe Extractor is an *optional* build flavor behind `ExtractorPort`, disclosed in-app.

## 4. Things I Need From You (gate questions)

These four answers unblock Phase 1. Everything else I can decide myself.

| # | Question | My recommendation |
|---|---|---|
| Q1 | **App name / package id** — keep `TheMashup` and `app.themashup.music`? | Keep both; trivially changeable now, painful later. |
| Q2 | **Licence for our own code** — MIT, Apache-2.0, or GPLv3? Note: GPLv3 makes the optional NewPipe flavor trivially compatible; MIT/Apache keeps the standard flavor permissive and the GPL flavor stays opt-in. | **MIT** for our code + GPL-only in the optional flavor. |
| Q3 | **Relay list for browser mode** — OK to ship a default editable Piped/Invidious-style relay list, or should browser mode be "bring your own relay"? | Ship two defaults, editable, with a clear health indicator. |
| Q4 | **Auth scope** — do you want full account write access (like/playlist/edit) or read-only library sync? Write access needs the `SAPISID` cookie path (Android-only). | Read-only library sync in v1; write access behind an "Advanced" toggle. |

## 5. Gate G0

Phase 0 is complete: the system architecture, tech stack, harvest plan and design system exist as
reviewed documents, and the repository is clean.

**I am stopping here. I will not write any Phase 1 code or research artefacts until you say go.**

**→ Do you approve Phase 0 and grant permission to begin Phase 1 (Deep Technical Research & API
Strategy)?** Answering Q1–Q4 in the same message is ideal, but approval alone is enough — I'll proceed
with my recommendations as defaults.
