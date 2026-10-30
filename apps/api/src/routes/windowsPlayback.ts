/** Private playback routes for the Windows-owned local host.
 * Browser clients only see short-lived same-origin tokens, never signed CDN
 * URLs or provider headers. No account cookies are accepted or forwarded.
 */
import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import type { ResolverClient, UpstreamCandidate } from "../services/resolverClient.js";
import { streamStore } from "../services/streamStore.js";
import { ah } from "../middleware/error.js";
import { badRequest, unavailable } from "../errors.js";

const DEFAULT_MIRRORS = [
  "pipedapi.kavin.rocks", "pipedapi.adminforge.de", "api.piped.yt",
  "inv.nadeko.net", "yewtu.be", "invidious.nerdvpn.de",
  "pipedproxy.kavin.rocks", "pipedproxy.adminforge.de",
];

function configuredHosts(): Set<string> {
  const names = new Set(DEFAULT_MIRRORS);
  for (const value of [process.env.PIPED_INSTANCES, process.env.INVIDIOUS_INSTANCES, process.env.THEMASHUP_STREAM_HOSTS]) {
    for (const entry of (value ?? "").split(",")) {
      try {
        const url = new URL(entry.includes("://") ? entry : `https://${entry}`);
        if (url.protocol === "https:" && !url.username && !url.password) names.add(url.hostname.toLowerCase());
      } catch { /* ignore invalid configuration */ }
    }
  }
  return names;
}

/** Strict host allowlist prevents a malicious mirror from proxying LAN/localhost.
 * The sole loopback exception is the explicitly enabled fixture resolver. */
export function allowedWindowsStream(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (raw.length > 8192 || url.username || url.password || url.hash) return false;
  if (process.env.RESOLVER_MOCK === "1" && process.env.RESOLVER_URL) {
    try {
      const resolver = new URL(process.env.RESOLVER_URL);
      if (url.origin === resolver.origin && url.hostname === "127.0.0.1" && url.pathname.startsWith("/mock/audio/")) return true;
    } catch { /* no fixture exception */ }
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port) return false;
  return host === "googlevideo.com" || host.endsWith(".googlevideo.com") || configuredHosts().has(host);
}

function safeHeaders(candidate: UpstreamCandidate): Record<string, string> {
  // Never propagate cookies, Authorization, X-Goog-* or arbitrary headers.
  const agent = Object.entries(candidate.http_headers ?? {}).find(([key]) => key.toLowerCase() === "user-agent")?.[1];
  return {
    "user-agent": typeof agent === "string" && agent.length <= 512 && !/[\r\n]/.test(agent)
      ? agent : "Mozilla/5.0 (TheMashup)",
    "referer": "https://www.youtube.com/",
  };
}

const requestSchema = z.object({
  video_id: z.string().regex(/^[A-Za-z0-9_-]{6,24}$/),
  mode: z.enum(["audio", "video"]).default("audio"),
  after: z.enum(["", "ytdlp", "piped", "invidious"]).default(""),
  refresh: z.boolean().default(false),
}).strict();

export function windowsPlaybackRouter(resolver: ResolverClient): Router {
  const router = Router();
  router.post("/resolve", ah(async (req, res) => {
    const body = requestSchema.parse(req.body ?? {});
    const response = await resolver.streams(body.video_id, body);
    const candidates = (response.candidates ?? [])
      .filter(c => ["ytdlp", "piped", "invidious"].includes(c.source) && allowedWindowsStream(c.url))
      .filter(c => body.mode !== "video" || c.has_video === true)
      .slice(0, 8)
      .map((c, i) => ({
        id: `${i}`, source: c.source,
        play_url: `/api/playback/stream/${streamStore.put(c.url, safeHeaders(c), body.video_id)}`,
        mime: String(c.mime ?? "application/octet-stream").slice(0, 160),
        quality: String(c.quality ?? "").slice(0, 100), has_video: !!c.has_video,
      }));
    if (!candidates.length) throw unavailable("No safe playable streams are available from this source.");
    // The upstream URL, related provider payloads, and request headers are not
    // sent to either the browser or untrusted pages on the preview origin.
    res.setHeader("Cache-Control", "no-store");
    res.json({ video_id: body.video_id, candidates, degraded: !!response.degraded });
  }));

  const send = ah(async (req, res) => {
    const token = z.string().regex(/^[A-Za-z0-9_-]{24}$/).parse(req.params.token);
    const entry = streamStore.get(token);
    if (!entry || !allowedWindowsStream(entry.url)) {
      res.status(410).end();
      return;
    }
    const range = req.headers.range;
    if (range && (range.length > 80 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) {
      throw badRequest("Only one byte range is supported.");
    }
    const headers: Record<string, string> = { ...entry.headers };
    if (range) headers.range = range;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    res.on("close", () => controller.abort());
    let upstream: Response | undefined;
    let target = entry.url;
    try {
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (!allowedWindowsStream(target)) break;
        upstream = await fetch(target, { method: req.method === "HEAD" ? "HEAD" : "GET", headers,
          redirect: "manual", signal: controller.signal });
        if (upstream.status < 300 || upstream.status >= 400) break;
        const location = upstream.headers.get("location");
        await upstream.body?.cancel();
        upstream = undefined;
        if (!location) break;
        target = new URL(location, target).href;
      }
    } catch { upstream = undefined; }
    finally { clearTimeout(timer); }
    if (!upstream || !allowedWindowsStream(target)) {
      if (!res.destroyed) res.status(410).end();
      return;
    }
    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel();
      res.status(upstream.status === 416 ? 416 : 410).end();
      return;
    }
    res.status(upstream.status);
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD" || !upstream.body) { res.end(); return; }
    const stream = Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream);
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
  router.head("/stream/:token", send);
  router.get("/stream/:token", send);
  return router;
}
