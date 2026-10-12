import cors from "cors";
import express from "express";
import { auditsRouter } from "./routes/audits.js";
import { batchesRouter } from "./routes/batches.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { jobsRouter } from "./routes/jobs.js";

const ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"];

/** Builds the Express application without listening, so it can be started or tested separately. */
export function createApp() {
  const app = express();

  app.use(cors({ origin: ALLOWED_ORIGINS, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
  app.use(express.text({ limit: "20mb", type: "text/*" }));
  app.use(express.json({ limit: "20mb" }));

  app.use(batchesRouter, jobsRouter, auditsRouter, dashboardRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
