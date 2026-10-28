import { Router } from "express";
import { z } from "zod";
import type { ListeningEvent } from "@themashup/shared";
import { ah } from "../middleware/error.js";
import { defaultLimiter } from "../middleware/rateLimit.js";
import { identify } from "../middleware/auth.js";
import { libraryDb, type LibraryBackend } from "../services/libraryDb.js";

interface StoredEvent extends ListeningEvent {
  received_at: string;
}

/**
 * POST /api/events — listening-event ingester.
 * Phase 2: in-memory ring buffer (observable at GET /api/events/recent).
 * Phase 4: persists to Supabase play_events for the personalization engine.
 */
const RING_CAP = 5_000;
const ring: StoredEvent[] = [];

const eventSchema = z.object({
  type: z.enum(["play", "skip", "complete", "repeat", "like", "dislike"]),
  track_id: z.string().min(1).max(64),
  listened_ms: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
  context: z.enum(["radio", "queue", "search", "playlist", "home", "library"]).optional(),
});

export function eventsRouter(db: () => LibraryBackend = libraryDb): Router {
  const r = Router();

  r.post(
    "/",
    defaultLimiter,
    ah(async (req, res) => {
      const ev = eventSchema.parse(req.body ?? {});
      ring.push({ ...ev, received_at: new Date().toISOString() });
      if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
      // Persist into per-user history when identified (best effort).
      const idd = await identify(req).catch(() => null);
      let persisted = false;
      if (idd && typeof ev.track_id === "string") {
        try {
          const resolver = req.app.get("resolverClient");
          const track = await resolver.meta(ev.track_id);
          await db().recordEvent(idd.userId, ev, track);
          persisted = true;
        } catch (err) {
          // missing metadata must not fail event ingestion
        }
      }
      res.status(202).json({ ok: true, buffered: ring.length, persisted });
    }),
  );

  r.get(
    "/recent",
    defaultLimiter,
    ah((req, res) => {
      const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
      res.json({ events: ring.slice(-limit).reverse() });
    }),
  );

  return r;
}
