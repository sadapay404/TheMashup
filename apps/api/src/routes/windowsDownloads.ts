/** Private download routes for the Windows-owned local host.
 * Browser clients only see local file URLs with short-lived tokens. No account
 * cookies are accepted or forwarded, and upstream redirects stay inside the
 * resolver's own download endpoint.
 */
import { Router } from "express";
import { z } from "zod";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";
import { badRequest, upstream as upstreamError } from "../errors.js";

const OWNER = "windows-local";
const tokenStore = new Map<string, string>();

const QUALITY_BY_CONTAINER: Record<string, number[]> = {
  mp3: [128, 192, 256, 320],
  m4a: [96, 128, 192],
  opus: [48, 96, 128, 160],
  flac: [],
  webm: [],
  mp4: [240, 360, 480, 720, 1080],
};

const containerSchema = z.enum(["mp3", "m4a", "opus", "flac", "webm", "mp4"]);
const trackSchema = z.object({
  video_id: z.string().regex(/^[A-Za-z0-9_-]{6,24}$/),
  title: z.string().min(1).max(300).optional(),
});
const batchSchema = z.object({
  tracks: z.array(trackSchema).min(1).max(100),
  container: containerSchema,
  quality: z.string().min(1).max(12),
});

export function windowsDownloadsRouter(resolver: ResolverClient): Router {
  const router = Router();

  router.post("/start", ah(async (req, res) => {
    const body = batchSchema.parse(req.body ?? {});
    const qualities = QUALITY_BY_CONTAINER[body.container] ?? [];
    if (qualities.length && !body.quality.endsWith("k") && !body.quality.endsWith("p")) {
      throw badRequest("Use a numeric quality such as 320k or 720p.");
    }
    if (qualities.length && !qualities.some((q) => String(q).endsWith(body.quality))) {
      throw badRequest("Quality is not available for this container.");
    }

    const jobs = [];
    for (const track of body.tracks) {
      const job = await resolver.startDownload({
        video_id: track.video_id,
        container: body.container,
        quality: body.quality,
        title: track.title,
        owner: OWNER,
      });
      const token = randomBytes(12).toString("base64url");
      tokenStore.set(token, job.id);
      jobs.push({ ...job, file_token: token } as unknown as typeof job);
    }
    res.status(201).json({ jobs });
  }));

  router.get("/", ah(async (_req, res) => {
    const jobs = await resolver.listDownloads(OWNER);
    res.json({ jobs });
  }));

  router.get("/:id/file", ah(async (req, res) => {
    const id = String(req.params.id);
    const token = String(req.query.token ?? "");
    if (!token || tokenStore.get(token) !== id) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid download file token." } });
      return;
    }
    const job = await resolver.getDownload(id);
    if (job.status !== "completed") {
      res.status(409).json({ error: { code: "NOT_READY", message: "This download is not ready yet." } });
      return;
    }

    const upstream = await fetch(resolver.downloadFileUrl(id), { redirect: "follow" });
    if (!upstream.ok || !upstream.body) {
      throw upstreamError("The resolver could not prepare this file.");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${job.filename || `${job.video_id}.${job.container}`}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-TheMashup-Source", "private-windows-download");
    await pipeline(Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream), res);
  }));

  router.get("/:id", ah(async (req, res) => {
    const id = String(req.params.id);
    const job = await resolver.getDownload(id);
    res.json({ job });
  }));

  router.delete("/:id", ah(async (req, res) => {
    const id = String(req.params.id);
    const job = await resolver.cancelDownload(id, OWNER);
    res.json({ job });
  }));

  return router;
}
