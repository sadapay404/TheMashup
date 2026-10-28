import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, ShieldCheck, HardDrive, Loader2, Sparkles } from "lucide-react";
import { useUIStore } from "../../stores/uiStore";
import { useSessionStore } from "../../stores/sessionStore";
import { supabaseConfigured } from "../../lib/supabase";
import { useLibraryStore } from "../../stores/libraryStore";

export function SignInModal() {
  const open = useUIStore((s) => s.authModalOpen);
  const setOpen = useUIStore((s) => s.setAuthModalOpen);
  const signInDemo = useSessionStore((s) => s.signInDemo);
  const signInWithGoogle = useSessionStore((s) => s.signInWithGoogle);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const [busy, setBusy] = useState<"google" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const onGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      await signInWithGoogle();
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onDemo = () => {
    setBusy("demo");
    signInDemo();
    void hydrate(true);
    setBusy(null);
    close();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={close}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            role="dialog"
            aria-modal="true"
            aria-label="Sign in"
            className="glass relative w-full max-w-md rounded-3xl border border-line p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-2 text-faint transition hover:bg-surface hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>

            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-contrast">
              <Sparkles className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-display text-xl font-extrabold tracking-tight">
              Save your music
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-dim">
              Likes, playlists, history and follows — stored per account and synced across
              devices.
            </p>

            <div className="mt-5 space-y-2.5">
              <button
                type="button"
                onClick={() => void onGoogle()}
                disabled={!supabaseConfigured || busy !== null}
                className={`flex w-full items-center justify-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  supabaseConfigured
                    ? "border-line bg-surface-2 text-ink hover:border-accent/50"
                    : "cursor-not-allowed border-line bg-surface text-faint"
                }`}
                title={supabaseConfigured ? "Sign in with Google" : "Requires Supabase keys"}
              >
                {busy === "google" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" />
                  </svg>
                )}
                Continue with Google
                {!supabaseConfigured && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                    needs setup
                  </span>
                )}
              </button>

              <div className="flex items-center gap-3 px-1 text-[10px] uppercase tracking-widest text-faint">
                <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
              </div>

              <button
                type="button"
                onClick={onDemo}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-bold text-accent-contrast transition hover:brightness-110 disabled:opacity-60"
              >
                {busy === "demo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
                Continue in Demo Mode
              </button>
            </div>

            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

            <div className="mt-5 flex items-start gap-2 rounded-2xl border border-line bg-surface/60 p-3 text-[11px] leading-relaxed text-faint">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>
                {supabaseConfigured
                  ? "Google sign-in runs through Supabase Auth; profiles get row-level security."
                  : "Demo mode keeps everything on this device (local JSON via the gateway). Add free Supabase keys later to unlock Google sign-in — see docs/SETUP_AUTH.md. Your demo library migrates untouched because you stay signed in the same way."}
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
