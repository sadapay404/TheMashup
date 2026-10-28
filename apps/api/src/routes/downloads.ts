import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import type { DownloadJob } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";
import { identify, requireIdentity } from "../middleware/auth.js";
import { streamLimiter, defaultLimiter } from "../middleware/rateLimit.js";
import { ApiError, notFound, badRequest, upstream } from "../errors.js";
import { log } from "../logger.js";

const createBody = z.object({
  video_id: z.string().trim().min(6).max(24),
  container: z.enum(["mp3", "flac", "opus", "mp4"]),
  quality: z.string().trim().min(1).max(12),
  title: z.string().max(300).optional(),
});

const QUALITY_BY_CONTAINER: Record<string, string[]> = {
  mp3: ["128k", "320k"],
  flac: ["best"],
  opus: ["best"],
  mp4: ["360p", "720p", "1080p", "4k"],
};

/** /api/downloads — job control + file delivery + SSE progress. */
export function downloadsRouter(resolver: ResolverClient): Router {
  const r = Router();

  const own = (job: DownloadJob, userId: string): boolean =>
    !job.owner || job.owner === userId;

  /* SSE progress (client uses fetch-streaming so identity travels in headers) */
  r.get(
    "/stream",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      let last = "";
      let ticks = 0;
      const emit = (jobs: DownloadJob[]) => {
        const payload = JSON.stringify({ jobs });
        if (payload === last) return;
        last = payload;
        res.write(`data: ${payload}\n\n`);
      };

      const poll = async () => {
        ticks += 1;
        if (ticks % 17 === 0) res.write(`: ping\n\n`); // ~15s keep-alive
        try {
          const jobs = (await resolver.listDownloads(idd.userId)).filter((j) => own(j, idd.userId));
          emit(jobs);
        } catch {
          if (ticks === 1 || ticks % 33 === 0) {
            res.write(`data: ${JSON.stringify({ error: "resolver_unreachable" })}\n\n`);
          }
        }
      };
      await poll();
      const iv = setInterval(() => void poll(), 900);
      req.on("close", () => clearInterval(iv));
    }),
  );

  /* create a download job */
  r.post(
    "/",
    streamLimiter,
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const body = createBody.parse(req.body ?? {});
      const allowed = QUALITY_BY_CONTAINER[body.container];
      if (!allowed || !allowed.includes(body.quality)) {
        throw badRequest(
          `quality '${body.quality}' invalid for ${body.container} (allowed: ${allowed?.join(", ")})`,
        );
      }
      const job = await resolver.startDownload({
        video_id: body.video_id,
        container: body.container,
        quality: body.quality,
        title: body.title,
        owner: idd.userId,
      });
      res.status(201).json({ job });
    }),
  );

  /* list my jobs */
  r.get(
    "/",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const jobs = (await resolver.listDownloads(idd.userId)).filter((j) => own(j, idd.userId));
      res.json({ jobs });
    }),
  );

  /* single job */
  r.get(
    "/:id",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().regex(/^[0-9a-f]{10,64}$/i, "invalid job id").parse(req.params.id);
      const job = await resolver.getDownload(id);
      if (!own(job, idd.userId)) throw notFound("job not found");
      res.json({ job });
    }),
  );

  /* cancel */
  r.delete(
    "/:id",
    ah(async (req, res) => {
      const idd = await requireIdentity(req);
      const id = z.string().regex(/^[0-9a-f]{10,64}$/i, "invalid job id").parse(req.params.id);
      const job = await resolver.cancelDownload(id, idd.userId);
      if (!own(job, idd.userId)) throw notFound("job not found");
      res.json({ job });
    }),
  );

  /* file delivery (streams from resolver with attachment headers) */
  r.get(
    "/:id/file",
    defaultLimiter,
    ah(async (req, res) => {
      const idd = await identify(req);
      if (!idd) {
        throw new ApiError(401, "AUTH_REQUIRED", "Sign in to download files");
      }
      const id = z.string().regex(/^[0-9a-f]{10,64}$/i, "invalid job id").parse(req.params.id);
      const job = await resolver.getDownload(id).catch(() => null);
      if (!job) throw notFound("job not found");
      if (!own(job, idd.userId)) throw notFound("job not found");
      if (job.status !== "completed") {
        throw badRequest(`job is ${job.status} — wait for completion`);
      }

      const url = resolver.downloadFileUrl(id);
      let upstreamRes: Response;
      try {
        upstreamRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        throw upstream("Download file unavailable", (err as Error).message);
      }
      if (!upstreamRes.ok) {
        throw upstream(`Download file unavailable (${upstreamRes.status})`);
      }
      res.status(upstreamRes.status);
      for (const h of ["content-type", "content-length", "content-disposition"]) {
        const v = upstreamRes.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.setHeader("cache-control", "no-store");
      if (!upstreamRes.body) {
        res.end();
        return;
      }
      const nodeStream = Readable.fromWeb(
        upstreamRes.body as unknown as import("node:stream/web").ReadableStream,
      );
      nodeStream.on("error", (err) => {
        log.warn(`file stream broke for ${id}`, err.message);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      res.on("close", () => nodeStream.destroy());
      nodeStream.pipe(res);
    }),
  );

  return r;
}

/** GET /api/formats/:trackId — format manifest for the quality picker. */
export function formatsRouter(resolver: ResolverClient): Router {
  const r = Router();
  r.get(
    "/:trackId",
    ah(async (req, res) => {
      const trackId = z.string().min(1).max(64).parse(req.params.trackId);
      res.json(await resolver.formats(trackId));
    }),
  );
  return r;
}
