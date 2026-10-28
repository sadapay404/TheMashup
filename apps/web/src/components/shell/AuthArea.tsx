import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, User, Library, FlaskConical } from "lucide-react";
import { useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";
import { useLibraryStore } from "../../stores/libraryStore";

/** Top-right account area: sign-in pill or avatar dropdown. */
export function AuthArea() {
  const mode = useSessionStore((s) => s.mode);
  const user = useSessionStore((s) => s.user);
  const signOut = useSessionStore((s) => s.signOut);
  const setAuthModalOpen = useUIStore((s) => s.setAuthModalOpen);
  const setPage = useUIStore((s) => s.setPage);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const [menu, setMenu] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  if (mode === "none" || !user) {
    return (
      <motion.button
        type="button"
        whileTap={{ scale: 0.96 }}
        onClick={() => setAuthModalOpen(true)}
        className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-xs font-bold text-ink transition hover:border-accent/60 hover:bg-surface-2"
      >
        <User className="h-3.5 w-3.5 text-accent" /> Sign in
      </motion.button>
    );
  }

  const initial = (user.name ?? "L").trim()[0]?.toUpperCase() ?? "L";

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full border border-line bg-surface p-1 pr-3 transition hover:border-accent/50"
      >
        {user.avatar ? (
          <img src={user.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black text-accent-contrast"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
          >
            {initial}
          </span>
        )}
        <span className="hidden max-w-28 truncate text-xs font-semibold text-ink sm:block">
          {user.name}
        </span>
      </button>

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="glass absolute right-0 top-[calc(100%+8px)] z-50 w-60 rounded-2xl border border-line p-2 shadow-2xl"
          >
            <div className="border-b border-line px-2 pb-2.5 pt-1.5">
              <p className="truncate text-sm font-bold text-ink">{user.name}</p>
              <p className="truncate text-xs text-faint">{user.email}</p>
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                {mode === "supabase" ? (
                  <>
                    <FlaskConical className="h-2.5 w-2.5" /> google account
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-2.5 w-2.5" /> demo mode · local
                  </>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPage("library");
                setMenu(false);
              }}
              className="mt-1.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-dim transition hover:bg-surface hover:text-ink"
            >
              <Library className="h-4 w-4" /> Your library
            </button>
            <button
              type="button"
              onClick={() => {
                void signOut();
                void hydrate(true);
                setMenu(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-dim transition hover:bg-surface hover:text-red-400"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
