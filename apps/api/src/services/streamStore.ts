import crypto from "node:crypto";
import { STREAM_TOKEN_TTL_MS } from "@themashup/shared";

interface Entry {
  url: string;
  headers: Record<string, string>;
  expiresAt: number;
  videoId: string;
}

/**
 * Short-lived token → upstream stream URL map.
 * The browser never sees ephemeral YouTube URLs: it plays `/api/stream/:token`,
 * which the gateway proxies (Range-preserving) with required CDN headers.
 */
class StreamStore {
  private map = new Map<string, Entry>();

  constructor() {
    const t = setInterval(() => this.sweep(), 60_000);
    t.unref();
  }

  put(url: string, headers: Record<string, string>, videoId: string): string {
    const token = crypto.randomBytes(18).toString("base64url");
    this.map.set(token, { url, headers, expiresAt: Date.now() + STREAM_TOKEN_TTL_MS, videoId });
    return token;
  }

  get(token: string): Entry | null {
    const e = this.map.get(token);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.map.delete(token);
      return null;
    }
    return e;
  }

  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expiresAt < now) this.map.delete(k);
    // Hard cap so the store can never grow unbounded.
    while (this.map.size > 4096) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

export const streamStore = new StreamStore();
