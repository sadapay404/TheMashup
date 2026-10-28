import type { Request } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

/** Who is making this request — Supabase OAuth user or local dev/demo identity. */
export interface Identity {
  userId: string;
  mode: "supabase" | "dev";
  name?: string;
  email?: string;
  avatar?: string;
}

let adminClient: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseServiceKey) return null;
  if (!adminClient) {
    adminClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

export function supabaseConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

const DEV_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * Resolve request identity.
 *  - Bearer <supabase JWT>  → verified via Supabase Auth (when configured)
 *  - Bearer dev:<uuid>      → local demo identity (only when ALLOW_DEV_AUTH)
 *  - x-dev-user: <uuid>     → same, convenient for the web client's demo mode
 */
async function verifySupabaseToken(token: string): Promise<Identity | null> {
  const admin = supabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    userId: data.user.id,
    mode: "supabase",
    email: data.user.email ?? undefined,
    name: (meta.full_name as string) ?? (meta.name as string) ?? undefined,
    avatar: (meta.avatar_url as string) ?? undefined,
  };
}

function devIdentity(raw: string): Identity | null {
  const value = raw.startsWith("dev:") ? raw.slice(4) : raw;
  if (!DEV_ID_RE.test(value)) return null;
  if (!config.allowDevAuth || supabaseConfigured()) return null;
  return {
    userId: `dev:${value}`,
    mode: "dev",
    name: "Local Listener",
    email: "you@themashup.local",
  };
}

export async function identify(req: Request): Promise<Identity | null> {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    const admin = supabaseAdmin();
    if (admin) return verifySupabaseToken(token);
    if (config.allowDevAuth && token.startsWith("dev:") && DEV_ID_RE.test(token.slice(4))) {
      return { userId: `dev:${token.slice(4)}`, mode: "dev" };
    }
    return null;
  }

  const dev = req.headers["x-dev-user"];
  if (typeof dev === "string" && DEV_ID_RE.test(dev)) {
    return devIdentity(dev);
  }

  // Query fallbacks for contexts that cannot set headers (<a download>,
  // EventSource): ?dev_user= / ?access_token=
  const q = req.query as Record<string, unknown>;
  if (typeof q.access_token === "string" && q.access_token) {
    const idd = await verifySupabaseToken(q.access_token);
    if (idd) return idd;
  }
  if (typeof q.dev_user === "string" && q.dev_user) {
    return devIdentity(q.dev_user);
  }
  return null;
}

/** Identity or401 — for protected routes (library, etc.). */
export async function requireIdentity(req: Request): Promise<Identity> {
  const idd = await identify(req);
  if (!idd) {
    throw new ApiError(
      401,
      "AUTH_REQUIRED",
      "Sign in to use your library (Google via Supabase, or local demo mode)",
    );
  }
  return idd;
}
