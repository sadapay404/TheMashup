import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import type { StreamResponse, StreamCandidate } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { streamStore } from "../services/streamStore.js";
import { ah } from "../middleware/error.js";
import { streamLimiter } from "../middleware/rateLimit.js";
import { badRequest } from "../errors.js";
import { log } from "../logger.js";

const videoIdSchema = z.string().trim().min(6).max(20);

/** POST /api/streams — resolve + register proxy tokens for playable candidates. */
export function streamsRouter(resolver: ResolverClient): Router {
  const r = Router();

  r.post(
    "/",
    streamLimiter,
    ah(async (req, res) => {
      const { video_id } = z
        .object({ video_id: videoIdSchema })
        .parse(req.body ?? {});
      const sr = await resolver.streams(video_id);
      if (!sr.candidates?.length) {
        throw badRequest(`No playable streams for ${video_id}`, sr.warnings);
      }
      const candidates: StreamCandidate[] = sr.candidates.map((c, i) => {
        const token = streamStore.put(c.url, c.http_headers ?? {}, video_id);
        return {
          ...c,
          id: c.id ?? `${video_id}:${i}`,
          play_url: `/api/stream/${token}`,
        };
      });
      const response: StreamResponse = { ...sr, video_id, candidates };
      res.json(response);
    }),
  );

  return r;
}

/**
 * GET /api/stream/:token — same-origin Range-preserving proxy.
 * Hides ephemeral upstream URLs from the browser, attaches CDN headers
 * (user-agent / referer) and enables Web Audio analysis (CORS-clean).
 */
export function streamProxyRouter(): Router {
  const r = Router();

  r.get(
    "/:token",
    ah(async (req, res) => {
      const token = z.string().min(10).max(64).parse(req.params.token);
      const entry = streamStore.get(token);
      if (!entry) {
        res.status(410).json({
          error: { code: "TOKEN_EXPIRED", message: "Stream token expired — request new streams" },
        });
        return;
      }

      const fwd: Record<string, string> = { ...entry.headers };
      if (typeof req.headers.range === "string") fwd.range = req.headers.range;

      // Abort only if response *headers* never arrive; the body streams unbounded.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      let upstream: Response;
      try {
        upstream = await fetch(entry.url, { headers: fwd, signal: ctrl.signal });
      } catch {
        clearTimeout(timer);
        res.status(410).json({
          error: { code: "CANDIDATE_DEAD", message: "Upstream stream unreachable — try next candidate" },
        });
        return;
      }
      clearTimeout(timer);

      // Expired/forbidden CDN URLs → 410 so the player fails over immediately.
      if (upstream.status === 403 || upstream.status === 404) {
        res.status(410).json({
          error: { code: "CANDIDATE_DEAD", message: `Upstream refused (${upstream.status})` },
        });
        return;
      }
      if (!upstream.ok && upstream.status !== 206) {
        res.status(502).json({
          error: { code: "UPSTREAM_ERROR", message: `Upstream returned ${upstream.status}` },
        });
        return;
      }

      res.status(upstream.status);
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.setHeader("cache-control", "no-store");

      if (!upstream.body) {
        res.end();
        return;
      }
      const nodeStream = Readable.fromWeb(
        upstream.body as unknown as import("node:stream/web").ReadableStream,
      );
      nodeStream.on("error", (err) => {
        log.warn(`stream proxy broke for ${entry.videoId}`, err.message);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      res.on("close", () => nodeStream.destroy());
      nodeStream.pipe(res);
    }),
  );

  // HEAD support with explicit handling (audio elements sometimes probe).
  r.head("/:token", (req, res) => {
    const entry = streamStore.get(String(req.params.token));
    res.status(entry ? 200 : 410).end();
  });

  return r;
}
