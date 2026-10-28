import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { THEME_IDS, type ThemeId } from "@themashup/shared";
import { useUIStore } from "../../stores/uiStore";

const THEME_META: Record<ThemeId, { label: string; swatch: string[]; hint: string }> = {
  frosted: { label: "Frosted Glass", swatch: ["#0a0a0f", "#8b6cff", "#4dd0ff"], hint: "dark · glass" },
  "paper-ink": { label: "Paper & Ink", swatch: ["#f4efe4", "#b3441f", "#211c14"], hint: "light · type" },
  neon: { label: "Neon Cyber", swatch: ["#04060b", "#00ffc8", "#ff3ec8"], hint: "dark · glow" },
  aurora: { label: "Aurora", swatch: ["#0a1022", "#6ee7ff", "#b490ff"], hint: "dark · mesh" },
  vinyl: { label: "Vinyl", swatch: ["#16110d", "#e8a33d", "#a03b3b"], hint: "warm · retro" },
};

/** 5-theme picker — selection persists across restarts (zustand → localStorage). */
export function ThemeSwitcher() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  return (
    <div className="grid grid-cols-1 gap-1.5">
      {THEME_IDS.map((id) => {
        const meta = THEME_META[id];
        const active = theme === id;
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.98 }}
            aria-pressed={active}
            className={`group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
              active ? "bg-surface-2 ring-1 ring-accent" : "hover:bg-surface"
            }`}
            style={active ? { boxShadow: "var(--ring)" } : undefined}
          >
            <span className="flex shrink-0 -space-x-1.5">
              {meta.swatch.map((c) => (
                <span
                  key={c}
                  className="h-4 w-4 rounded-full border border-black/25"
                  style={{ background: c }}
                />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-ink">{meta.label}</span>
              <span className="block truncate text-[10px] uppercase tracking-wider text-faint">
                {meta.hint}
              </span>
            </span>
            {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
          </motion.button>
        );
      })}
    </div>
  );
}
