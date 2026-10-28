import { Router } from "express";
import { z } from "zod";
import type { ArtistRef, RecShelf, Track, TrackDetail } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";
import { searchLimiter } from "../middleware/rateLimit.js";
import { unavailable } from "../errors.js";

const idParam = (name: string) => z.string().trim().min(1).max(64).parse;

export function tracksRouter(resolver: ResolverClient): Router {
  const r = Router();

  // Rich track detail (metadata + related for the "up next / radio" panel).
  r.get(
    "/track/:trackId",
    searchLimiter,
    ah(async (req, res) => {
      const trackId = z.string().trim().min(1).max(64).parse(req.params.trackId);
      const [meta, related] = await Promise.allSettled([
        resolver.meta(trackId),
        resolver.related(trackId),
      ]);
      if (meta.status === "rejected") throw meta.reason;
      const detail: TrackDetail = {
        ...meta.value,
        related: related.status === "fulfilled" ? related.value : [],
      };
      res.json(detail);
    }),
  );

  // Related tracks (radio seeds).
  r.get(
    "/related/:trackId",
    searchLimiter,
    ah(async (req, res) => {
      const trackId = z.string().trim().min(1).max(64).parse(req.params.trackId);
      const related = await resolver.related(trackId);
      res.json({ track_id: trackId, related });
    }),
  );

  // Artist page: top songs by YouTube Music channel id.
  r.get(
    "/artist/:channelId",
    searchLimiter,
    ah(async (req, res) => {
      const channelId = z.string().trim().min(1).max(128).parse(req.params.channelId);
      const { artist, tracks } = await resolver.artist(channelId);
      const body: { artist: ArtistRef; tracks: Track[] } = { artist, tracks };
      res.json(body);
    }),
  );

  return r;
}
