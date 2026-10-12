import cors from "cors";
import express, { type Response } from "express";
import { getAllAudits, getAuditById, getDashboardStats, type AuditRecord } from "./db.js";
import { errorMessage } from "./errorMessage.js";
import { getJobResult, getResult, jobStatusOf, publishBatch } from "./producer.js";
import { startResultsConsumer } from "./queue/resultsConsumer.js";
import { getRawPatientRecordByJobId, type RecordSource } from "./repositories/rawRecords.js";
import { runSeed } from "./seed.js";
import { transformAuditResult } from "./transformer.js";

const PORT = Number(process.env.PORT) || 3001;
const ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"];
const INTEGER_PATTERN = /^-?\d+$/;
const RECORD_SOURCES: readonly RecordSource[] = ["upload", "api"];

const app = express();

app.use(cors({ origin: ALLOWED_ORIGINS, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.text({ limit: "20mb", type: "text/*" }));
app.use(express.json({ limit: "20mb" }));

function fail(res: Response, status: number, context: string, error: unknown): void {
  console.error(`Error ${context}:`, error);
  res.status(status).json({ error: errorMessage(error) });
}

function toAuditSummary(audit: AuditRecord) {
  const summary = {
    id: audit.id,
    record_number: audit.record_number,
    record_number_display: audit.record_number_display,
    conformity_percent: audit.conformity_percent,
    created_at: audit.created_at,
    status: audit.status,
  };

  try {
    return {
      ...summary,
      batch_id: audit.batch_id,
      job_id: audit.job_id,
      encounter: audit.encounter,
      audit: transformAuditResult(audit.audit_data),
    };
  } catch (error) {
    console.error(`Error transforming audit ${audit.id}:`, errorMessage(error));
    return { ...summary, audit: null, error: "Transform failed" };
  }
}

app.post("/batches", async (req, res) => {
  try {
    const rawText = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const modelName = typeof req.query.model === "string" ? req.query.model : undefined;
    const rawSeed = req.query.seed;
    const source = RECORD_SOURCES.find((candidate) => candidate === req.query.source) ?? "api";

    let seed: number | undefined;
    if (rawSeed !== undefined && rawSeed !== "") {
      if (!INTEGER_PATTERN.test(String(rawSeed))) {
        res.status(400).json({ error: "Invalid 'seed': must be an integer" });
        return;
      }
      seed = parseInt(String(rawSeed), 10);
    }

    if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
      res.status(400).json({ error: "Empty or invalid request body" });
      return;
    }

    const result = await publishBatch(rawText, modelName, seed, source);

    res.status(202).json({
      message: "Batch received and queued",
      batch_id: result.batchId,
      total_records: result.publishedJobs.length,
      jobs: result.publishedJobs,
    });
  } catch (error) {
    fail(res, 400, "publishing batch", error);
  }
});

app.get("/records/:number/status", async (req, res) => {
  try {
    const recordNumber = req.params.number.replace(/\./g, "").trim();
    const result = await getResult(recordNumber);

    if (!result) {
      res.status(202).json({ status: "processing", record_number: recordNumber });
      return;
    }

    res.json({ status: "done", result: transformAuditResult(result), raw: result });
  } catch (error) {
    fail(res, 500, "fetching result", error);
  }
});

app.get("/jobs/:id/status", async (req, res) => {
  try {
    const jobId = req.params.id.trim();
    const result = await getJobResult(jobId);

    if (!result) {
      res.status(202).json({ status: "processing", job_id: jobId });
      return;
    }

    if (result._job_failed) {
      res.json({ status: "failed", job_id: jobId, error: result.error, attempts: result.attempts });
      return;
    }

    res.json({ status: jobStatusOf(result), result: transformAuditResult(result), raw: result });
  } catch (error) {
    fail(res, 500, "fetching job result", error);
  }
});

app.get("/api/audits", (_req, res) => {
  try {
    const audits = getAllAudits().map(toAuditSummary);
    res.json({ audits, total: audits.length });
  } catch (error) {
    fail(res, 500, "fetching audits", error);
  }
});

app.get("/api/audits/:id", (req, res) => {
  try {
    const audit = getAuditById(parseInt(req.params.id, 10));

    if (!audit) {
      res.status(404).json({ error: "Audit not found" });
      return;
    }

    res.json({
      id: audit.id,
      record_number: audit.record_number,
      record_number_display: audit.record_number_display,
      encounter: audit.encounter,
      conformity_percent: audit.conformity_percent,
      created_at: audit.created_at,
      audit: transformAuditResult(audit.audit_data),
      raw: audit.audit_data,
      raw_patient_record: getRawPatientRecordByJobId(audit.job_id),
    });
  } catch (error) {
    fail(res, 500, "fetching audit", error);
  }
});

app.get("/api/dashboard/stats", (_req, res) => {
  try {
    res.json(getDashboardStats());
  } catch (error) {
    fail(res, 500, "fetching dashboard stats", error);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Producer API listening on port ${PORT}`);
});

if (process.env.DISABLE_BACKGROUND_JOBS !== "1") {
  await runSeed();
  void startResultsConsumer(process.env.REDIS_URL || "redis://localhost:6379");
}
