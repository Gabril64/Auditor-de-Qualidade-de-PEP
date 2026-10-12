import { Router } from "express";
import { InvalidSubmissionError, submitBatch } from "../services/submission.js";
import { fail } from "./respond.js";

export const batchesRouter = Router();

batchesRouter.post("/batches", async (req, res) => {
  try {
    const rawText = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const result = await submitBatch(rawText, req.query);

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
