import express, { type Express } from "express";
import cors from "cors";
import { config } from "./config.js";
import { httpResolver, type ResolverClient } from "./services/resolverClient.js";
import { apiRouter } from "./routes/index.js";
import { libraryRouter } from "./routes/library.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { defaultLimiter } from "./middleware/rateLimit.js";
import { log } from "./logger.js";

export interface AppDeps {
  /** Injected in tests; defaults to the real HTTP resolver client. */
  resolver?: ResolverClient;
}

export function createApp(deps: AppDeps = {}): Express {
  const resolver = deps.resolver ?? httpResolver;
  const app = express();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
      // Let the desktop shell read attachment filenames off cross-origin files.
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "256kb" }));

  // Access log (method, path, status, ms) via a tiny middleware.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path === "/api/health") return; // keep health probes quiet
      log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  app.use("/api", defaultLimiter);
  app.set("resolverClient", resolver); // for event → history persistence
  app.use("/api", apiRouter(resolver));
  app.use("/api/library", libraryRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
