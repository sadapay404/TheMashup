import { Router } from "express";
import { z } from "zod";
import type { Lyrics, LyricMatch } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { lyricsService } from "../services/lyrics.js";
import { ah } from "../middleware/error.js";
import { searchLimiter } from "../middleware/rateLimit.js";
import { notFound } from "../errors.js";

export function lyricsRouter(resolver: ResolverClient): Router {
  const r = Router();

  // Hybrid-search half of the smart bar: resolve free text (partial lyrics,
  // "title artist", …) to concrete track + lyrics candidates.
  r.get(
    "/match",
    searchLimiter,
    ah(async (req, res) => {
      const q = z.string().trim().min(2, "q must be at least 2 chars").max(300).parse(req.query.q);
      const match: LyricMatch = await lyricsService.match(q);
      res.json(match);
    }),
  );

  // Full lyrics for a known track id: resolver gives metadata, LRCLIB gives text.
  r.get(
    "/:trackId",
    searchLimiter,
    ah(async (req, res) => {
      const trackId = z.string().min(1).max(64).parse(req.params.trackId);
      const meta = await resolver.meta(trackId);
      const lyrics: Lyrics | null = await lyricsService.forTrack({
        title: meta.title,
        artist_names: meta.artist_names,
        duration_sec: meta.duration_sec,
        id: meta.id,
      });
      if (!lyrics) throw notFound(`No lyrics found for ${trackId}`);
      res.json({ track_id: trackId, ...lyrics });
    }),
  );

  return r;
}
