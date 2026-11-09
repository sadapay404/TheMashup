/**
 * The dock.
 *
 * Two states, and the transition between them is the whole interaction:
 *
 *   **Full** (nothing playing) — every page is visible and tappable, normal bottom navigation.
 *   **Collapsed** (a track is playing) — only the current page stays solid, with the others hinted at
 *   low opacity so it is obvious the dock can still do more. Playback is the focus, so navigation
 *   gets out of the way instead of competing with the song card underneath it.
 *
 * Holding the dock springs it back open (a bouncy, overshooting animation), and while the thumb stays
 * down, sliding left and right switches pages with a detent per item. Releasing schedules the collapse:
 * 3 s if the page did not change, 1.8 s if it did — because after a deliberate switch the user has
 * already made their choice and should not be made to wait.
 *
 * Everything here is deliberately pointer-driven rather than scroll/touch events: `pointerdown/move/up`
 * give one code path for finger, mouse and stylus, and support cancellation (a system gesture taking
 * over mid-drag must not leave the dock stuck open).
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { store, useApp, type Route } from '@/state/store';
import { DownloadIcon, HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from '@/components/ui/icons';
import { haptic } from '@/lib/haptics';

const ITEMS: Array<{ id: Route; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'search', label: 'Search', Icon: SearchIcon },
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  // Downloads sits before Settings because it is content, not configuration.
  { id: 'downloads', label: 'Downloads', Icon: DownloadIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/** Hold this long before the dock springs open. Short enough to feel instant, long enough not to
 *  fire on a normal tap. */
const LONG_PRESS_MS = 320;
/** Collapse delay when the user ended on the page they started on. */
const HOLD_SAME_PAGE_MS = 3000;
/** Collapse delay after actually switching page — the choice is made, so release sooner. */
const HOLD_CHANGED_PAGE_MS = 1800;

export function SmartDock() {
  const route = useApp((s) => s.route);
  const track = useApp((s) => s.queue[s.index] ?? null);

  /** True while a track is loaded: the dock's compact mode is tied to playback, not to route. */
  const compact = Boolean(track);
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [slideIndex, setSlideIndex] = useState<number | null>(null);

  const pressTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const startedOn = useRef<Route>(route);
  const suppressClick = useRef(false);

  const clearTimers = useCallback(() => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    pressTimer.current = null;
    collapseTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Leaving the collapsed state is not a thing the user asks for: the dock is only compact while
  // something is playing. Opening it must never outlive that.
  useEffect(() => {
    if (!compact) {
      setOpen(false);
      setHolding(false);
      setSlideIndex(null);
    }
  }, [compact]);

  const scheduleCollapse = useCallback(() => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
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
    store.set({ route: id });
  }, []);

  /** Map a horizontal position to the dock item under the thumb. */
  const indexAt = useCallback((clientX: number): number | null => {
    const el = navRef.current;
    if (!el) return null;
    const buttons = Array.from(el.querySelectorAll<HTMLElement>('[data-dock-item]'));
    if (!buttons.length) return null;
    let best = 0;
    let bestDist = Infinity;
    buttons.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      const d = Math.abs(clientX - mid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!compact) return;
    startedOn.current = store.getState().route;
    suppressClick.current = false;
    // Capture so the gesture survives the finger leaving the pill's bounds.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      setOpen(true);
      setHolding(true);
      suppressClick.current = true;
      haptic('longPress');
      setSlideIndex(ITEMS.findIndex((i) => i.id === store.getState().route));
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!holding) return;
    const idx = indexAt(e.clientX);
    if (idx === null || idx === slideIndex) return;
    setSlideIndex(idx);
    const target = ITEMS[idx];
    if (target) go(target.id);
  };

  const endGesture = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (holding) {
      setHolding(false);
      scheduleCollapse();
    }
    setSlideIndex(null);
  };

  const onPointerUp = () => {
    endGesture();
    // A long press must not also navigate on release; clear the flag after the click would fire.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  const onPointerCancel = () => {
    // System gesture or interrupted drag: abandon cleanly rather than staying expanded forever.
    endGesture();
  };

  /** Long-press preview on hover-capable devices, so the gesture is discoverable with a mouse. */
  const onContextMenu = (e: React.MouseEvent) => {
    if (compact) {
      e.preventDefault();
      setOpen((v) => !v);
      if (!open) setHolding(true);
    }
  };

  const springy = { type: 'spring' as const, stiffness: 420, damping: 22, mass: 0.7 };

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenu}
      className="fixed inset-x-0 z-50 mx-auto flex w-fit touch-none select-none items-center gap-1 rounded-full p-1.5"
      style={{
        // Above the song card. The dock floats; the card sits underneath it.
        bottom: `calc(env(safe-area-inset-bottom) + ${compact ? 92 : 10}px)`,
        background: 'var(--dock-bg)',
        backdropFilter: 'blur(28px) saturate(160%)',
        WebkitBackdropFilter: 'blur(28px) saturate(160%)',
        border: '1px solid var(--hairline)',
        // The shadow is what makes the dock read as a separate floating layer above the card.
        boxShadow: compact
          ? '0 18px 40px -18px rgba(0,0,0,0.85), 0 2px 10px -4px rgba(0,0,0,0.6)'
          : '0 16px 40px -18px rgba(0,0,0,0.9)',
      }}
    >
      <AnimatePresence initial={false}>
        {ITEMS.map(({ id, label, Icon }) => {
          const active = route === id;
          // In compact mode the current page is solid and the rest are hinted, not hidden: the dock
          // still shows there is somewhere else to go without competing with the song card.
          const hinted = compact && !open && !active;
          if (compact && !open && !active) {
            return (
              <motion.button
                key={id}
                type="button"
                data-dock-item
                aria-label={label}
                aria-hidden={hinted}
                tabIndex={-1}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 12, opacity: 0.28 }}
                exit={{ width: 0, opacity: 0 }}
                transition={springy}
                onClick={() => {
                  if (suppressClick.current) return;
                  go(id);
                }}
                className="relative flex h-12 items-center justify-center overflow-hidden"
              >
                <motion.span
                  animate={{ scale: 0.55 }}
                  className="grid h-12 w-12 shrink-0 place-items-center text-[var(--color-text)]"
                >
                  <Icon width={20} height={20} />
                </motion.span>
              </motion.button>
            );
          }
          return (
            <motion.button
              key={id}
              type="button"
              data-dock-item
              layout
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              transition={springy}
              initial={{ width: 0, opacity: 0 }}
              animate={{
                width: 68,
                opacity: 1,
                scale: holding && slideIndex !== null && ITEMS[slideIndex]?.id === id ? 1.06 : 1,
              }}
              exit={{ width: 0, opacity: 0 }}
              onClick={() => {
                if (suppressClick.current) return;
                go(id);
              }}
              className="relative flex h-12 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full"
            >
              {active ? (
                <motion.span
                  layoutId="dock-active"
                  transition={springy}
                  className="absolute inset-0 rounded-full bg-[var(--accent)]/16"
                />
              ) : null}
              <span className={`relative z-10 ${active ? 'text-[var(--accent)]' : 'text-[var(--color-text-2)]'}`}>
                <Icon width={21} height={21} />
              </span>
              <span
                className={`relative z-10 text-[9.5px] font-semibold ${
                  active ? 'text-[var(--accent)]' : 'text-[var(--color-text-3)]'
                }`}
              >
                {label}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </nav>
  );
}
