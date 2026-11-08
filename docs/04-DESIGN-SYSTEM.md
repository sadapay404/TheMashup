# TheMashup — Design System & Motion Specification

> **Document 4 of 5 — Phase 0 deliverable**
> Written before any code so the UI is designed, not improvised. "Gorgeous" is a spec here, with
> numbers.

---

## 1. Design Concept — "Liquid Obsidian"

A dark, ink-black canvas that behaves like a fluid. Colour is *extracted from the art*, never applied
on top of it. Surfaces are glass that refracts the album art beneath them. Motion is spring-based,
carries momentum, and always resolves to rest.

**Three signature ideas (the app's identity):**

1. **Art-derived palette.** Every album colour in the UI is sampled from the current artwork
   (median-cut → 5-colour palette → mapped to `--accent-*` tokens at 78 % saturation, 62 % lightness).
   Change track → the whole app re-tints over 600 ms.
2. **The Melt.** The mini-player is a rounded bar that *melts* upward: as the user drags, the bar's
   border-radius and height interpolate into the full player sheet; album art scales with a
   counter-parallax so it appears to stay still in space while the sheet grows around it.
3. **Elastic lists.** Rows overscroll with rubber-banding and settle with a spring (stiffness 320,
   damping 30); queue rows can be flung off-screen to remove, and they arc, not slide.

---

## 2. Design Tokens

### 2.1 Colour (dark-first; light theme derived, not hand-picked)

| Token | Dark value | Purpose |
|---|---|---|
| `--bg-void` | `#07070A` | App background (OLED-true black option: `#000`) |
| `--bg-base` | `#0C0C11` | Screen background |
| `--surface-1` | `rgba(255,255,255,.045)` | Cards, sheets |
| `--surface-2` | `rgba(255,255,255,.075)` | Hover / pressed |
| `--stroke-hairline` | `rgba(255,255,255,.09)` | 1px borders (`0.5px` on mdpi) |
| `--text-primary` | `#F4F4F6` | 15.6:1 on `--bg-base` |
| `--text-secondary` | `#A6A6B2` | 6.1:1 |
| `--text-muted` | `#6E6E7C` | 3.4:1 — non-text only, or disabled |
| `--accent` | *from artwork* | Primary action, progress fill |
| `--accent-soft` | `accent @ 18 %` | Glows, chips |
| `--danger` `--ok` `--warn` | `#FF5C5C` `#3DDC97` `#FFC24B` | Semantic states |
| `--glass` | `blur(28px) saturate(160%)` + `--surface-1` | Sheets, mini-player, headers |

**Contrast rule:** any text on glass must pass 4.5:1 against the *worst-case* art beneath it — enforced
by a runtime check that darkens `--glass` toward `--bg-void` at 0–40 % when sampled luminance > 0.5.

### 2.2 Type

| Role | Face | Size / leading / tracking |
|---|---|---|
| Display (now-playing title) | **Instrument Serif** | 34 / 38 / −1 % |
| Title | **Inter Tight** 600 | 20 / 26 / −1 % |
| Body | **Inter** 400/500 | 15 / 22 / 0 |
| Caption / meta | Inter 500 | 12 / 16 / +2 % — uppercase for section labels |
| Numeric (timers, bitrates) | **JetBrains Mono** 500 | tabular figures, no jitter on the timer |

System-font fallback stack for the first paint (`font-display: swap`), variable fonts self-hosted
(no Google Fonts request — privacy + C2).

### 2.3 Space, radius, elevation

- 4 pt base grid; component padding 8/12/16/20/24; screen gutter 20.
- Radii: `8` (chips) · `16` (rows) · `24` (cards) · `32` (sheets) · `999` (pills).
- Elevation is *light*, not shadow: `--glow-1: 0 12px 40px -12px accent/.35`.

### 2.4 Iconography
Custom 1.75 px stroke set, 24 px grid, rounded caps; aligned to the optical centre, not the box.
Playback glyphs are drawn as filled shapes at rest, stroke on press (a 90 ms state change).

---

## 3. Motion Language

### 3.1 Springs (no linear easing anywhere except progress bars)

| Name | Config (stiffness, damping, mass) | Used for |
|---|---|---|
| `snap` | 420, 34, 1 | Buttons, toggles, chips |
| `settle` | 320, 30, 1 | Sheets, list settle, drag release |
| `glide` | 180, 26, 1 | Route transitions |
| `melt` | 260, 28, 1 | Mini-player → full player |
| `float` | 120, 18, 1 | Ambient art bloom, background parallax |

### 3.2 Choreography rules

1. **Stagger = 18 ms per index, cap 6 items.** Lists animate on mount only when ≤ 12 rows.
2. **Shared element:** album art uses `layoutId` across mini-player → full player → queue. During the
   transition, art both scales and *cross-fades to a higher-res source* at the 40 % mark (avoids the
   "blurry expansion" tell).
3. **Route transition:** outgoing screen scales to 0.985 and fades to 0 over 180 ms; incoming
   translates 12 px up on `glide`. No slide-left/right carousel — it fights Android's predictive back.
4. **Press feedback ≤ 100 ms**, always `scale .97` + `--surface-2`, even if the action is async.
5. **Optimistic everything:** queue add, like, download start all mutate local state instantly and
   reconcile later; failures reverse with a haptic + inline toast, never a modal.
6. **`prefers-reduced-motion`:** springs become 120 ms fades, the Melt becomes a cross-fade, parallax
   is removed. All features remain reachable.

### 3.3 Signature interactions

| Interaction | Spec |
|---|---|
| **The Melt** (mini → full player) | Drag up: sheet tracks finger 1:1 with 0.92 rubber-band past 70 %; art counter-parallax = `translateY(-0.35 × dragY)`; release past 35 % commits with `melt`. Downward drag dismisses; velocity > 800 px/s always commits. |
| **Swipe a queue row** | Horizontal drag reveals a 72 px action well; past 45 % the row detaches with velocity inheritance and a slight rotation (`±2°`), then the gap closes with `settle`. Undo snackbar 10 s. |
| **Seek** | Scrubbing shows a "liquid" progress fill that leads the thumb by 6 px (an optical illusion that reads as fluid); waveform scrubber in the full player uses cached peak data. |
| **Like** | Heart bursts with 6 particles on a 900 ms `float`, then settles into a filled state; haptic `selection`. |
| **Pull-to-refresh** | The logo's three stacked bars compress and release like a spring; refresh only triggers if pulled > 64 px with < 800 px/s velocity. |
| **Search focus** | The search bar expands to full width over 220 ms while the header's blur radius animates 0 → 28 px; results stagger in at 18 ms. |

---

## 4. Layout System

- **Mobile-first**, single column, bottom-anchored navigation: `Home · Search · Library · Settings`
  in a floating glass pill (not a full-width bar) — 56 px tall, 12 px from the bottom edge, safe-area
  aware.
- **Mini-player** floats above the nav pill, 64 px, glass, art 44 px.
- **Now Playing**: full-bleed art with a blurred, art-tinted backdrop; controls in the lower third
  (thumb zone); lyrics as a swipeable third face of the same card.
- **Tablet / desktop (≥ 768 px)**: two-pane — persistent rail (72 px icons) + content; now-playing
  becomes a right dock (360 px) at ≥ 1100 px.
- **Every screen** ships four states: `loading (skeleton) · empty (illustration + action) ·
  error (retry, explained) · offline (cached content, banner)`.

---

## 5. Accessibility Targets

- Contrast ≥ 4.5:1 body / 3:1 large; focus ring 2 px `--accent` with 2 px offset, always visible on
  keyboard nav.
- Everything reachable by keyboard; the player sheet traps focus correctly and restores it on close.
- Touch targets ≥ 44×44 dp, ≥ 8 dp apart.
- Screen reader: the player announces `Now playing: {title} by {artist}. {position} of {duration}` on
  seek-end only (not every second). Queue changes use `aria-live="polite"`.
- Captions/lyrics are text, resizable to 200 % without layout break.

---

## 6. The Design Contract

No component may ship unless it satisfies: tokens only (no hex literals in components) · one of the
five springs · all four states · keyboard + screen-reader paths · reduced-motion path · ≤ 16.6 ms frame
time. This is checked in review against `04-DESIGN-SYSTEM.md`, not by vibes.
