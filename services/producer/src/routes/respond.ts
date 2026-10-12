import type { Response } from "express";
import { errorMessage } from "../errorMessage.js";

/** Logs the error and answers with its message. Kept in one place so a central error middleware can replace it. */
export function fail(res: Response, status: number, context: string, error: unknown): void {
  console.error(`Error ${context}:`, error);
  res.status(status).json({ error: errorMessage(error) });
}
