import { Router } from "express";
import { getJobStatus, getRecordStatus } from "../services/jobs.js";
import { fail } from "./respond.js";

export const jobsRouter = Router();

jobsRouter.get("/records/:number/status", async (req, res) => {
  try {
    const recordNumber = req.params.number.replace(/\./g, "").trim();
    const reply = await getRecordStatus(recordNumber);
    res.status(reply.pending ? 202 : 200).json(reply.body);
  } catch (error) {
    fail(res, 500, "fetching result", error);
  }
});

jobsRouter.get("/jobs/:id/status", async (req, res) => {
  try {
    const reply = await getJobStatus(req.params.id.trim());
    res.status(reply.pending ? 202 : 200).json(reply.body);
  } catch (error) {
    fail(res, 500, "fetching job result", error);
  }
});
