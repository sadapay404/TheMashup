import { Router } from "express";
import { z } from "zod";
import type { SearchResponse, SuggestResponse } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";
import { searchLimiter } from "../middleware/rateLimit.js";

const qSchema = z.string().trim().min(1, "q is required").max(200);
const typeSchema = z.enum(["auto", "tracks", "videos", "albums", "artists"]);
const limitSchema = z.coerce.number().int().min(1).max(50).default(20);

export function searchRouter(resolver: ResolverClient): Router {
  const r = Router();

  // Metadata search (songs/videos/artists/albums merged).
  r.get(
    "/",
    searchLimiter,
    ah(async (req, res) => {
      const q = qSchema.parse(req.query.q);
      const type = typeSchema.default("auto").parse(req.query.type);
      const limit = limitSchema.parse(req.query.limit);
      const started = Date.now();

      const [searchRes, suggestRes] = await Promise.allSettled([
        resolver.search(q, limit),
        resolver.suggest(q, 8),
      ]);
      if (searchRes.status === "rejected") throw searchRes.reason;

      const warnings = [...searchRes.value.warnings];
      if (suggestRes.status === "rejected") warnings.push("suggestions_unavailable");

      let tracks = searchRes.value.tracks;
      if (type === "tracks") tracks = tracks.filter((t) => t.category !== "video");
      if (type === "videos") tracks = tracks.filter((t) => t.category === "video");
      if (type === "artists" || type === "albums") tracks = [];

      const response: SearchResponse = {
        query: q,
        tracks,
        artists: searchRes.value.artists,
        albums: type === "auto" || type === "albums" ? searchRes.value.albums : [],
        took_ms: Date.now() - started,
        degraded: warnings.length > 0,
        warnings,
      };
      res.json(response);
    }),
  );

  // Autocomplete suggestions for the search dropdown.
  r.get(
    "/suggest",
    searchLimiter,
    ah(async (req, res) => {
      const q = qSchema.parse(req.query.q);
      const limit = z.coerce.number().int().min(1).max(15).default(8).parse(req.query.limit);
      const started = Date.now();
      const suggestions = await resolver.suggest(q, limit);
      const body: SuggestResponse = { query: q, suggestions, took_ms: Date.now() - started };
      res.json(body);
    }),
  );

  return r;
}
