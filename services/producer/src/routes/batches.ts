import { Router } from "express";
import { authContext } from "../auth/middleware.js";
import { logAccess } from "../repositories/accessLog.js";
import { InvalidSubmissionError, submitBatch } from "../services/submission.js";
import { fail } from "./respond.js";

export const batchesRouter = Router();

batchesRouter.post("/batches", async (req, res) => {
  try {
    const rawText = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const { user } = authContext(res);
    const result = await submitBatch(rawText, req.query, user.id);
    logAccess({
      event: "batch_submitted",
      userId: user.id,
      email: user.email,
      detail: `batch ${result.batchId}: ${result.publishedJobs.length} record(s)`,
    });

    res.status(202).json({
      message: "Batch received and queued",
      batch_id: result.batchId,
      total_records: result.publishedJobs.length,
      jobs: result.publishedJobs,
    });
  } catch (error) {
    if (error instanceof InvalidSubmissionError) {
      res.status(400).json({ error: error.message });
      return;
    }
    fail(res, 400, "publishing batch", error);
  }
});
