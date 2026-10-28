import { Router } from "express";
import { z } from "zod";
import { buildRadioQueue, listenAgainWithLikes, discoverMix } from "@themashup/shared";
import type { RadioResponse, RecShelf, Track } from "@themashup/shared";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";
import { identify, requireIdentity } from "../middleware/auth.js";
import { libraryDb } from "../services/libraryDb.js";
import { searchLimiter, streamLimiter } from "../middleware/rateLimit.js";
import { unavailable } from "../errors.js";

/** POST /api/radio — endless-Radio engine: seed track or free query → diversified queue. */
export function radioRouter(resolver: ResolverClient): Router {
  const r = Router();

  const radioBody = z
    .object({
      seed_video_id: z.string().trim().min(6).max(20).optional(),
      query: z.string().trim().min(2).max(200).optional(),
      limit: z.number().int().min(5).max(50).optional(),
    })
    .refine((b) => Boolean(b.seed_video_id ?? b.query), {
      message: "Provide seed_video_id or query",
    });

  r.post(
    "/",
    streamLimiter,
    ah(async (req, res) => {
      const { seed_video_id, query, limit } = radioBody.parse(req.body ?? {});
      const target = limit ?? 30;
      let response: RadioResponse;

      if (seed_video_id) {
        const seed = await resolver.meta(seed_video_id);
        const [relatedRes, sameArtistRes] = await Promise.allSettled([
          resolver.related(seed_video_id),
          // Depth: pull same-artist catalogue so short related lists still fill the queue.
          resolver.search(seed.artist_names, 15),
        ]);
        const pool: Track[] = [
          ...(relatedRes.status === "fulfilled" ? relatedRes.value : []),
          ...(sameArtistRes.status === "fulfilled" ? sameArtistRes.value.tracks : []),
        ];
        if (pool.length === 0) {
          throw unavailable("Could not build radio pool for seed", { seed_video_id });
        }
        response = {
          seed,
          tracks: buildRadioQueue(seed, pool, { limit: target }),
          mode: "seed",
          generated_at: new Date().toISOString(),
        };
      } else {
        const search = await resolver.search(query!, Math.max(target * 2, 20));
        if (search.tracks.length === 0) throw unavailable("No tracks found for radio query");
        let queue = buildRadioQueue(search.tracks[0], search.tracks, { limit: target });
        // Single-result search: play the hits we found rather than an empty queue.
        if (queue.length === 0) queue = search.tracks.slice(0, target);
        response = {
          seed: search.tracks[0],
          tracks: queue,
          mode: "query",
          generated_at: new Date().toISOString(),
        };
      }
      res.json(response);
    }),
  );

  return r;
}

/** GET /api/recommendations — shelves.
 *  - listen_again: personal (identity + history/likes) — Phase 5 personalization
 *  - discover: taste-vector mix when identity present, charts radio otherwise
 *  - quick/trending: chart-based (stateless) */
export function recommendationsRouter(resolver: ResolverClient): Router {
  const r = Router();

  const personalData = async (userId: string) => {
    const db = libraryDb();
    const [history, likes] = await Promise.all([
      db.listHistory(userId, 120),
      db.listLikes(userId),
    ]);
    return { history, likes, likedIds: new Set(likes.map((t) => t.id)) };
  };

  r.get(
    "/",
    searchLimiter,
    ah(async (req, res) => {
      const kind = z
        .enum(["quick", "discover", "trending", "listen_again"])
        .default("quick")
        .parse(req.query.kind);

      /* ── Listen again: pure library signal, requires identity ── */
      if (kind === "listen_again") {
        const idd = await requireIdentity(req);
        const { history, likes } = await personalData(idd.userId);
        const tracks = listenAgainWithLikes(
          history.map((h) => ({ track: h.track, at: h.at, context: h.context })),
          likes,
          24,
        );
        res.json({
          kind,
          title: "Listen again",
          tracks,
          personalized: true,
          warnings: [],
        } satisfies RecShelf & { warnings: string[] });
        return;
      }

      const identity = await identify(req);
      const charts = await resolver.charts();
      if (charts.tracks.length === 0) {
        throw unavailable("No recommendation data available", charts.warnings);
      }

      let tracks = charts.tracks;
      let personalized = false;

      if (kind === "quick") {
        tracks = tracks.slice(0, 24);
      } else if (kind === "discover" && identity) {
        const { history, likedIds } = await personalData(identity.userId);
        if (history.length > 0 || likedIds.size > 0) {
          tracks = discoverMix({
            history: history.map((h) => ({ track: h.track, at: h.at, context: h.context })),
            likedIds,
            candidates: charts.tracks,
            limit: 24,
          });
          personalized = tracks.length > 0;
        }
        if (!personalized) {
          tracks = buildRadioQueue(charts.tracks[0], charts.tracks, { limit: 24, lambda: 0.5 });
        }
      } else if (kind === "discover") {
        tracks = buildRadioQueue(charts.tracks[0], charts.tracks, { limit: 24, lambda: 0.5 });
      }

      const shelf: RecShelf & { warnings: string[] } = {
        kind,
        title:
          kind === "quick"
            ? "Quick picks"
            : kind === "discover"
              ? personalized
                ? "Discover weekly"
                : "Discover"
              : "Trending now",
        tracks,
        personalized,
        warnings: charts.warnings,
      };
      res.json(shelf);
    }),
  );

  return r;
}
