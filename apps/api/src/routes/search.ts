import { Router } from "express";
import { z } from "zod";
import type { SearchResponse, SuggestResponse } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";
import { searchLimiter } from "../middleware/rateLimit.js";
import { searchLyrics, matchCatalogTrack } from "../services/lyricSearch.js";
import { config } from "../config.js";

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

      // Suggestions are fetched independently by /suggest. Waiting for them here
      // doubled upstream work and delayed otherwise-ready catalog results.
      const searchRes = await resolver.search(q, limit);
      const warnings = [...searchRes.warnings];
      let tracks = searchRes.tracks;
      if (type === "tracks") tracks = tracks.filter((t) => t.category !== "video");
      if (type === "videos") tracks = tracks.filter((t) => t.category === "video");
      if (type === "artists" || type === "albums") tracks = [];

      const response: SearchResponse = {
        query: q,
        tracks,
        artists: searchRes.artists,
        albums: type === "auto" || type === "albums" ? searchRes.albums : [],
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


  // Genius's lyric index returns title/artist candidates. Resolve at most four
  // through the normal YouTube-first catalog; never guess an unrelated track.
  // This is separate from metadata and suggestions so one outage cannot block them.
  r.get(
    "/lyrics",
    searchLimiter,
    ah(async (req, res) => {
      const q = z.string().trim().min(2).max(200).parse(req.query.q);
      const candidates = await searchLyrics(q, 4);
      const resolutions = await Promise.allSettled(candidates.map(async (hit) => {
        const found = await resolver.search(`${hit.title} ${hit.artist}`, 8);
        return matchCatalogTrack(hit, found.tracks);
      }));
      const hits = candidates.map((hit, index) => ({
        ...hit,
        track: resolutions[index].status === "fulfilled" ? resolutions[index].value : null,
      }));
      res.json({
        query: q,
        hits,
        source: config.mockUpstream ? "mock" : "genius",
        warnings: resolutions.some((entry) => entry.status === "rejected")
          ? ["catalog_resolution_unavailable"] : [],
      });
    }),
  );

  return r;
}
