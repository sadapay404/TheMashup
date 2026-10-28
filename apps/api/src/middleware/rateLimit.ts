import { rateLimit } from "express-rate-limit";
import { RATE_LIMITS } from "@themashup/shared";
import type { ApiErrorBody } from "@themashup/shared";

function limiter(max: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: "RATE_LIMITED", message: "Too many requests — slow down a little" },
      };
      res.status(429).json(body);
    },
  });
}

export const searchLimiter = limiter(RATE_LIMITS.search);
export const streamLimiter = limiter(RATE_LIMITS.streams);
export const defaultLimiter = limiter(RATE_LIMITS.default);
