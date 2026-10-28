import { Router } from "express";
import { config } from "../config.js";
import { lyricsService } from "../services/lyrics.js";
import type { ResolverClient } from "../services/resolverClient.js";
import { ah } from "../middleware/error.js";

export function healthRouter(resolver: ResolverClient): Router {
  const r = Router();
  r.get(
    "/",
    ah(async (_req, res) => {
      const resolverHealth = await resolver.health();
      res.json({
        ok: true,
        version: config.version,
        resolver: resolverHealth,
        lyrics_provider: lyricsService.provider(),
        mock_upstream: config.mockUpstream,
        uptime_sec: Math.round(process.uptime()),
      });
    }),
  );
  return r;
}
