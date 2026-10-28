import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo-root .env first, then an optional apps/api/.env override.
dotenv.config({ path: path.resolve(here, "../../../.env") });
dotenv.config();

const bool = (v: string | undefined, dflt = false) =>
  v === undefined ? dflt : v === "1" || v.toLowerCase() === "true";
const num = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

export const config = {
  port: num(process.env.API_PORT, 4000),
  host: process.env.API_HOST ?? "0.0.0.0",
  resolverUrl: (process.env.RESOLVER_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
  lyricsBase: (process.env.LYRICS_BASE ?? "https://lrclib.net").replace(/\/$/, ""),
  /** Serve lyrics (and related fixtures) locally instead of hitting lrclib.net. */
  mockUpstream: bool(process.env.MOCK_UPSTREAM),
  // ── Phase 4: auth + library ─────────────────────────────────────
  supabaseUrl: process.env.SUPABASE_URL?.trim() || undefined,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  /** Local demo identities allowed. Defaults ON when Supabase isn't configured. */
  allowDevAuth:
    process.env.ALLOW_DEV_AUTH !== undefined
      ? bool(process.env.ALLOW_DEV_AUTH)
      : !process.env.SUPABASE_URL,
  /** Local JSON library store path (fallback when Supabase is absent). */
  libraryDbPath: process.env.LIBRARY_DB_PATH || "data/library.json",
  corsOrigins: (() => {
    // Desktop (Tauri) and Android (Capacitor WebView) origins are always
    // allowed so the bundled shells can call the gateway directly — even when
    // CORS_ORIGIN is explicit. https://localhost is the Capacitor default
    // WebView origin (androidScheme: https in capacitor.config.json).
    const shells = [
      "tauri://localhost",
      "http://tauri.localhost",
      "https://localhost",
    ];
    const list = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
    return list ? [...list, ...shells] : ["*"];
  })(),
  version: "0.1.0",
} as const;

export type Config = typeof config;
