import { Router } from "express";
import type { ResolverClient } from "../services/resolverClient.js";
import { healthRouter } from "./health.js";
import { searchRouter } from "./search.js";
import { lyricsRouter } from "./lyrics.js";
import { streamsRouter, streamProxyRouter } from "./streams.js";
import { tracksRouter } from "./tracks.js";
import { radioRouter, recommendationsRouter } from "./radio.js";
import { eventsRouter } from "./events.js";
import { downloadsRouter, formatsRouter } from "./downloads.js";

/** All /api routes mounted here. */
export function apiRouter(resolver: ResolverClient): Router {
  const r = Router();
  r.use("/health", healthRouter(resolver));
  r.use("/search", searchRouter(resolver));
  r.use("/lyrics", lyricsRouter(resolver));
  r.use("/streams", streamsRouter(resolver));
  r.use("/stream", streamProxyRouter());
  r.use(tracksRouter(resolver));
  r.use("/radio", radioRouter(resolver));
  r.use("/recommendations", recommendationsRouter(resolver));
  r.use("/events", eventsRouter());
  r.use("/downloads", downloadsRouter(resolver));
  r.use("/formats", formatsRouter(resolver));
  return r;
}
