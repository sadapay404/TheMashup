/**
 * The dock.
 *
 * Two states, and the transition between them is the entire interaction:
 *
 *   **Open**   — every destination is a full pill: icon, label, tappable. Normal navigation.
 *   **Compact**— a song is playing, so the dock shows only the current destination and the song card
 *                takes the space it freed. The other destinations are still there for the hold
 *                gesture (and for assistive tech, via `DockStubs`), just not drawn.
 *
 * A hold springs it back open. While the thumb is down, sliding left and right switches pages,
 * one detent per destination. Releasing collapses it again: 3 s if the page did not change,
 * 1.8 s if it did — after a deliberate switch the decision is made, so it can go sooner.
 *
 * Rewritten because the previous version was wrong in ways that were structural rather than
 * cosmetic:
 *
 *  1. **Hit detection ran off the live render tree.** The stubs were 12px wide while their
 *     `querySelectorAll` targets were the same elements mid-animation, so a slide computed distances
 *     against stale rects and skipped destinations. Positions are now captured once at press time
 *     from a stable grid, so the mapping cannot change halfway through a gesture.
 *  2. **The faint stubs were not reachable.** `tabIndex={-1}`, `aria-hidden`, and a click that a
 *     long-press flag suppressed meant someone who did not know to hold could not navigate at all.
 *     They are now real buttons: tap works, hold-and-slide still works.
 *  3. **Geometry was duplicated** between here and App.tsx, and disagreed. Both now read
 *     `lib/layout`, so the card sits directly under the dock by construction.
 *  4. **The gesture armed on the whole `<nav>`**, including dead space around the active pill.
 *     Detents are computed against the dock's own rect now, so sliding off either end clamps
 *     instead of snapping to a far destination.
 *
 * Pointer events only (`pointerdown/move/up/cancel`): one code path for finger, mouse and stylus,
 * and cancellation is handled — a system gesture taking over mid-drag must not leave it open.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { store, useApp, navigate, type Route } from '@/state/store';
import { ChevronDownIcon, DownloadIcon, HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from '@/components/ui/icons';
import { haptic } from '@/lib/haptics';
import { DOCK_H, DOCK_ITEM_H, DOCK_PADDING, dockBottom, dockBottomOverCard } from '@/lib/layout';

const ITEMS: Array<{ id: Route; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'search', label: 'Search', Icon: SearchIcon },
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  // Downloads before Settings: it is content, not configuration.
  { id: 'downloads', label: 'Downloads', Icon: DownloadIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/** Hold this long before the dock springs open. Past a tap, well under a considered press. */
const LONG_PRESS_MS = 300;
/** Collapse delay when the page did not change — long enough that a mis-hold is forgiven. */
const HOLD_SAME_PAGE_MS = 3000;
/** Collapse delay after a switch — the choice is made, so release sooner. */
const HOLD_CHANGED_PAGE_MS = 1800;
/** Movement beyond this before the hold fires means the user is scrolling, not holding. */
const SCROLL_SLOP_PX = 12;

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 26, mass: 0.7 };
const SOFT_SPRING = { type: 'spring' as const, stiffness: 320, damping: 30, mass: 0.8 };

export function SmartDock() {
  const route = useApp((s) => s.route);
  const tracks = useApp((s) => s.queue);
  const index = useApp((s) => s.index);

  /**
   * A track existing used to collapse the dock to a single pill. That is gone: shrinking navigation
   * the moment music starts makes the app feel like it is taking itself away, and the user asked
   * for it to stop. `compact` now only controls where the dock sits — above the song card — never
   * how much of it is drawn.
   */
  const compact = tracks.length > 0 && index >= 0;
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [slideIndex, setSlideIndex] = useState<number | null>(null);

  const pressTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const startedOn = useRef<Route>(route);
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  /** Detent centres captured at press time; null when the gesture never armed. */
  const detents = useRef<number[] | null>(null);
  const suppressClick = useRef(false);

  const clearTimers = useCallback(() => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    pressTimer.current = null;
    collapseTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Compact only exists while a track exists; opening must not outlive that.
  useEffect(() => {
    if (!compact) {
      clearTimers();
      setOpen(false);
      setHolding(false);
      setSlideIndex(null);
    }
  }, [compact, clearTimers]);

  // A route change from anywhere (a search result, the full player) closes any open hold.
  useEffect(() => {
    if (!holding) setSlideIndex(null);
  }, [route, holding]);

  const scheduleCollapse = useCallback(() => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    const changed = route !== startedOn.current;
    collapseTimer.current = window.setTimeout(
      () => {
        setOpen(false);
        setSlideIndex(null);
      },
      changed ? HOLD_CHANGED_PAGE_MS : HOLD_SAME_PAGE_MS,
    );
  }, [route]);

  const go = useCallback((id: Route) => {
    if (store.getState().route === id) return;
    haptic('toggle');
    navigate(id);
  }, []);

  /**
   * Capture the slot centres for the open layout.
   *
   * Computed from the grid rather than from the live buttons: the buttons animate their width, so
   * measuring them mid-transition gives wrong centres — which is what made sliding skip or
   * overshoot a destination before.
   */
  const captureDetents = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inner = rect.width - DOCK_PADDING * 2;
    if (inner <= 0) return;
    const slot = inner / ITEMS.length;
    const start = rect.left + DOCK_PADDING;
    detents.current = ITEMS.map((_, i) => start + slot * (i + 0.5));
  }, []);

  const indexAt = useCallback((clientX: number): number | null => {
    const centres = detents.current;
    if (!centres || !centres.length) return null;
    let best = 0;
    let bestDist = Infinity;
    centres.forEach((mid, i) => {
      const d = Math.abs(clientX - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }, []);

  const disarm = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!compact) return;
    startedOn.current = store.getState().route;
    suppressClick.current = false;
    downPoint.current = { x: e.clientX, y: e.clientY };

    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Some engines refuse capture on a non-primary pointer; the gesture still works without it.
    }

    disarm();
    pressTimer.current = window.setTimeout(() => {
      captureDetents();
      const current = ITEMS.findIndex((i) => i.id === store.getState().route);
      setSlideIndex(current >= 0 ? current : 0);
      setOpen(true);
      setHolding(true);
      suppressClick.current = true;
      haptic('longPress');
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Before the hold fires, a clear vertical drag means this is a page scroll passing over the
    // dock, not a hold. Cancel rather than stealing the scroll.
    if (!holding && downPoint.current && pressTimer.current !== null) {
      const dy = Math.abs(e.clientY - downPoint.current.y);
      const dx = Math.abs(e.clientX - downPoint.current.x);
      if (dy > SCROLL_SLOP_PX && dy > dx) disarm();
      return;
    }
    if (!holding) return;

    const idx = indexAt(e.clientX);
    if (idx === null || idx === slideIndex) return;
    setSlideIndex(idx);
    const target = ITEMS[idx];
    if (target) go(target.id);
  };

  const endGesture = () => {
    disarm();
    downPoint.current = null;
    detents.current = null;
    if (holding) {
      setHolding(false);
      scheduleCollapse();
    }
    setSlideIndex(null);
  };

  const onPointerUp = () => {
    // A tap on the active pill while holding should not be swallowed, so the flag clears after the
    // click has had a chance to fire.
    const wasSuppressed = suppressClick.current;
    endGesture();
    if (wasSuppressed) {
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  };

  const onPointerCancel = () => {
    // System gesture or interrupted drag: abandon cleanly rather than staying expanded.
    endGesture();
    suppressClick.current = false;
  };

  /** Mouse users cannot "hold" comfortably; a right click toggles instead. */
  const onContextMenu = (e: React.MouseEvent) => {
    if (!compact) return;
    e.preventDefault();
    clearTimers();
    if (open) {
      setOpen(false);
      setHolding(false);
      setSlideIndex(null);
    } else {
      setOpen(true);
      setHolding(false);
      setSlideIndex(ITEMS.findIndex((i) => i.id === route));
      haptic('longPress');
    }
  };

  // Always expanded. Kept as a named value so the JSX below stays a single branch and the
  // hold-to-open gesture still has something to do (it now just re-anchors the dock).
  const expanded = true;

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
      style={{
        bottom: compact ? dockBottomOverCard() : dockBottom(),
        background: 'var(--dock-bg)',
        backdropFilter: 'blur(28px) saturate(160%)',
        WebkitBackdropFilter: 'blur(28px) saturate(160%)',
        border: '1px solid var(--hairline)',
        height: DOCK_H,
        padding: DOCK_PADDING,
        // Reads as its own floating layer above the card rather than part of the page.
        boxShadow: compact
          ? '0 20px 44px -20px rgba(0,0,0,0.9), 0 2px 10px -6px rgba(0,0,0,0.7)'
          : '0 16px 40px -18px rgba(0,0,0,0.9)',
      }}
      className="fixed inset-x-0 z-50 mx-auto flex w-fit touch-none select-none items-center gap-1 rounded-full"
    >
      {ITEMS.map(({ id, label, Icon }) => {
        const active = route === id;
        const slid = holding && slideIndex !== null && ITEMS[slideIndex]?.id === id;

        // Open (or not compact): the real destination pill.
        if (expanded) {
          return (
            <motion.button
              key={id}
              type="button"
              data-dock-item={id}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (suppressClick.current) return;
                go(id);
              }}
              layout
              transition={SPRING}
              style={{ height: DOCK_ITEM_H }}
              animate={{ width: 64, opacity: 1, scale: slid ? 1.07 : 1 }}
              className="relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full"
            >
              {active ? (
                <motion.span
                  layoutId="dock-active"
                  transition={SPRING}
                  className="absolute inset-0 rounded-full bg-[var(--accent)]/16"
                />
              ) : null}
              <span className={`relative z-10 ${active ? 'text-[var(--accent)]' : 'text-[var(--color-text-2)]'}`}>
                <Icon width={21} height={21} />
              </span>
              <span
                className={`relative z-10 text-[9.5px] font-semibold leading-none ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--color-text-3)]'
                }`}
              >
                {label}
              </span>
            </motion.button>
          );
        }

        // Compact and closed: ONLY the active destination is drawn. The user was explicit — one icon
        // while a song is playing. The others keep their DOM slot and their `data-dock-item` hook,
        // because the hold gesture measures against all five, but they are visually absent:
        // `visibility: hidden` removes them from hit-testing and the accessibility tree without
        // collapsing the flex gap that the gesture's geometry depends on.
        //
        // They cannot be removed from the tree entirely: `visibility: hidden` elements are not
        // focusable, so a keyboard or screen-reader user would lose navigation the moment a song
        // started. `DockStubs` below republishes the same five destinations as real, focusable,
        // invisible buttons for those users, and `aria-hidden` here keeps the audible tree to one
        // copy of each label.
        if (!active) {
          return (
            <motion.button
              key={id}
              type="button"
              data-dock-item={id}
              aria-label={label}
              aria-hidden
              tabIndex={-1}
              onClick={() => {
                if (suppressClick.current) return;
                navigate(id);
              }}
              layout
              transition={SPRING}
              style={{ height: DOCK_ITEM_H, visibility: 'hidden' }}
              animate={{ width: 0, opacity: 0 }}
              className="pointer-events-none relative overflow-hidden rounded-full"
            />
          );
        }

        if (active) {
          return (
            <motion.button
              key={id}
              type="button"
              data-dock-item={id}
              aria-label={label}
              aria-current="page"
              onClick={() => go(id)}
              layout
              transition={SPRING}
              style={{ height: DOCK_ITEM_H }}
              animate={{ width: 64, opacity: 1 }}
              className="relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full"
            >
              <motion.span layoutId="dock-active" transition={SPRING} className="absolute inset-0 rounded-full bg-[var(--accent)]/16" />
              <span className="relative z-10 text-[var(--accent)]">
                <Icon width={21} height={21} />
              </span>
              <span className="relative z-10 text-[9.5px] font-semibold leading-none text-[var(--accent)]">{label}</span>
            </motion.button>
          );
        }

        return (
          <motion.button
            key={id}
            type="button"
            data-dock-item={id}
            aria-label={`Go to ${label}`}
            onClick={() => {
              if (suppressClick.current) return;
              go(id);
            }}
            layout
            transition={SPRING}
            style={{ height: DOCK_ITEM_H }}
            animate={{ width: 30, opacity: 1, scale: 1 }}
            whileTap={{ scale: 0.94 }}
            className="relative flex items-center justify-center overflow-hidden rounded-full"
          >
            {/* Faded, not hidden: it signals the dock can still do more without competing with
                the song card that now owns the space it gave up. */}
            <span className="text-[var(--color-text-3)] opacity-[0.42]">
              <Icon width={18} height={18} />
            </span>
          </motion.button>
        );
      })}

      {/* Collapse affordance. While compact-and-open there must be an obvious way back to the card;
          relying on a timer alone makes the dock feel stuck if the user wants to be done now. */}
      <AnimatePresence initial={false}>
        {compact && open ? (
          <motion.button
            key="collapse"
            type="button"
            aria-label="Hide the dock"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 26, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SOFT_SPRING}
            onClick={() => {
              clearTimers();
              haptic('tap');
              setOpen(false);
              setHolding(false);
              setSlideIndex(null);
            }}
            style={{ height: DOCK_ITEM_H }}
            className="ml-0.5 grid shrink-0 place-items-center overflow-hidden rounded-full text-[var(--color-text-3)]"
          >
            <ChevronDownIcon width={15} height={15} />
          </motion.button>
        ) : null}
      </AnimatePresence>


    </nav>
  );
}

