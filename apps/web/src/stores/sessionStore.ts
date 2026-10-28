import { create } from "zustand";
import { persist } from "zustand/middleware";
// Supabase loads lazily: keeps the SDK out of the critical path (and out of
// node-based test graphs, which run without Vite's import.meta.env shim).
type SupabaseModule = typeof import("../lib/supabase");
let supabaseModule: Promise<SupabaseModule> | null = null;
const loadSupabase = (): Promise<SupabaseModule> =>
  (supabaseModule ??= import("../lib/supabase"));

export type SessionMode = "none" | "demo" | "supabase";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

interface SessionState {
  mode: SessionMode;
  user: SessionUser | null;
  /** In-memory only (never persisted): Bearer token for the gateway. */
  accessToken?: string;
  initialized: boolean;

  init: () => Promise<void>;
  signInDemo: () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      mode: "none",
      user: null,
      accessToken: undefined,
      initialized: false,

      init: async () => {
        if (get().initialized) return;
        // Supabase path: restore session + subscribe to changes.
        const { supabase } = await loadSupabase();
        if (supabase) {
          try {
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              set({
                mode: "supabase",
                accessToken: data.session.access_token,
                user: {
                  id: data.session.user.id,
                  name:
                    (data.session.user.user_metadata?.full_name as string) ??
                    (data.session.user.email ?? "Listener"),
                  email: data.session.user.email ?? "",
                  avatar: data.session.user.user_metadata?.avatar_url as string | undefined,
                },
              });
            } else if (get().mode === "supabase") {
              // persisted supabase mode but dead session
              set({ mode: "none", user: null, accessToken: undefined });
            }
            supabase.auth.onAuthStateChange((_event, session) => {
              if (session) {
                set({
                  mode: "supabase",
                  accessToken: session.access_token,
                  user: {
                    id: session.user.id,
                    name:
                      (session.user.user_metadata?.full_name as string) ??
                      (session.user.email ?? "Listener"),
                    email: session.user.email ?? "",
                    avatar: session.user.user_metadata?.avatar_url as string | undefined,
                  },
                });
              } else if (get().mode === "supabase") {
                set({ mode: "none", user: null, accessToken: undefined });
              }
            });
          } catch (err) {
            console.warn("[auth] supabase init failed", err);
          }
        } else if (get().mode === "supabase") {
          set({ mode: "none", user: null, accessToken: undefined });
        }
        set({ initialized: true });
      },

      signInDemo: () => {
        const existing = get().user;
        const id = existing?.id.startsWith("dev:") ? existing.id : `dev:${crypto.randomUUID()}`;
        set({
          mode: "demo",
          user: {
            id,
            name: "Local Listener",
            email: "you@themashup.local",
          },
          accessToken: undefined,
        });
      },

      signInWithGoogle: async () => {
        const { supabase } = await loadSupabase();
        if (!supabase) throw new Error("Supabase is not configured yet");
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
        if (error) throw error;
      },

      signOut: async () => {
        const { supabase } = await loadSupabase();
        if (supabase && get().mode === "supabase") {
          try {
            await supabase.auth.signOut();
          } catch {
            /* ignore */
          }
        }
        set({ mode: "none", user: null, accessToken: undefined });
      },
    }),
    {
      name: "themashup.auth",
      partialize: (s) => ({ mode: s.mode, user: s.user }),
    },
  ),
);

export function hasIdentity(): boolean {
  const s = useSessionStore.getState();
  return s.mode !== "none" && Boolean(s.user);
}
