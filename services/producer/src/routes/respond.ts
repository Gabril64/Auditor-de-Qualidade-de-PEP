import type { Response } from "express";
import { errorMessage } from "../errorMessage.js";
import { HttpError } from "../errors.js";

/** Answers an HttpError as it is; any other error is logged and answered with its message. Kept in one place so a central error middleware can replace it. */
export function fail(res: Response, status: number, context: string, error: unknown): void {
  if (error instanceof HttpError) {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error(`Error ${context}:`, error);
  res.status(status).json({ error: errorMessage(error) });
}

/** The parsed JSON body as an object, or an empty one when the body is missing or not an object. */
export function bodyOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
