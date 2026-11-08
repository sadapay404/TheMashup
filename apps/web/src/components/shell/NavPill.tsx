/** Floating glass nav pill (design system §4) — not a full-width bar, and safe-area aware. */

import { motion } from 'framer-motion';
import { useApp, store, type Route } from '@/state/store';
import { HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from '@/components/ui/icons';
import { snap } from '@/components/ui/primitives';

const ITEMS: Array<{ id: Route; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'search', label: 'Search', Icon: SearchIcon },
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export function NavPill() {
  const route = useApp((s) => s.route);

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-[max(10px,env(safe-area-inset-bottom))] z-50 mx-auto flex w-fit items-center gap-1 rounded-full p-1.5 shadow-[0_16px_40px_-18px_rgba(0,0,0,0.9)]"
    >
      {ITEMS.map(({ id, label, Icon }) => {
        const active = route === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => store.set({ route: id })}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className="relative flex h-12 w-[68px] flex-col items-center justify-center gap-0.5 rounded-full"
          >
            {active ? (
              <motion.span
                layoutId="nav-active"
                transition={snap}
                className="absolute inset-0 rounded-full bg-[var(--accent)]/16"
              />
            ) : null}
            <motion.span whileTap={{ scale: 0.88 }} transition={snap} className="relative z-10">
              <Icon
                width={21}
                height={21}
                className={active ? 'text-[var(--accent)]' : 'text-[var(--color-text-3)]'}
              />
            </motion.span>
            <span
              className={`relative z-10 text-[9px] font-semibold uppercase tracking-wider ${
                active ? 'text-[var(--accent)]' : 'text-[var(--color-text-3)]'
              }`}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
