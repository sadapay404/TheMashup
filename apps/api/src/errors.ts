import type { ApiErrorBody } from "@themashup/shared";

/** Uniform HTTP error carried through the error middleware. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.detail !== undefined ? { detail: this.detail } : {}) } };
  }
}

export const badRequest = (message: string, detail?: unknown) =>
  new ApiError(400, "VALIDATION_ERROR", message, detail);
export const notFound = (message: string) => new ApiError(404, "NOT_FOUND", message);
export const upstream = (message: string, detail?: unknown) =>
  new ApiError(502, "UPSTREAM_ERROR", message, detail);
export const unavailable = (message: string, detail?: unknown) =>
  new ApiError(503, "UNAVAILABLE", message, detail);
