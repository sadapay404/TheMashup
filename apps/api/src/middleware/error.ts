import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../errors.js";
import { log } from "../logger.js";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    if (err.status >= 500) log.error(`${req.method} ${req.path} → ${err.code}: ${err.message}`, err.detail);
    res.status(err.status).json(err.toBody());
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", detail: err.issues },
    });
    return;
  }
  log.error(`${req.method} ${req.path} → unhandled`, err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
  });
}

/** Wrap async (or sync) handlers so rejections reach the error middleware. */
export function ah<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Sync throws propagate to Express's own try/catch; async rejections go to next.
    void Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
