import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { RawAuditResult } from "../src/transformer.js";

interface AuditSummary {
  id: number;
  record_number: string;
  record_number_display: string;
  conformity_percent: number;
  status: string;
  job_id: string;
  batch_id: string;
  audit: { prontuario: string; conformidade_geral: number } | null;
}

interface JsonResponse<T> {
  status: number;
  body: T;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(path.resolve(here, "../../../tests/snapshots/audit_ok_mix.json"), "utf8"),
) as RawAuditResult[];

const LOWEST = fixture[7];
const HIGHEST = fixture[11];
const MIDDLE = fixture[0];

function percentOf(result: RawAuditResult): number {
  return result.audit_data?.conformity_global?.percent ?? 0;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

process.env.SQLITE_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "producer-api-test-")), "auditor.db");

mock.module("redis", {
  namedExports: {
    createClient: () => ({
      on() {},
      async connect() {},
      async lPush() {},
      async get() {
        return null;
      },
    }),
  },
});

const port = await new Promise<number>((resolve) => {
  const probe = net.createServer().listen(0, () => {
    const { port: freePort } = probe.address() as net.AddressInfo;
    probe.close(() => resolve(freePort));
  });
});
process.env.PORT = String(port);
process.env.DISABLE_BACKGROUND_JOBS = "1";
const BASE = `http://127.0.0.1:${port}`;

await import("../src/server.js");
const { upsertAuditResult } = await import("../src/repositories/audits.js");

async function getJson<T>(route: string): Promise<JsonResponse<T>> {
  const response = await fetch(`${BASE}${route}`);
  return { status: response.status, body: (await response.json()) as T };
}

before(async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Producer did not start");
});

function save(jobId: string, result: RawAuditResult): void {
  const saved = upsertAuditResult({
    batch_id: "batch-api",
    job_id: jobId,
    record_number: result.record_id?.replace(/\./g, ""),
    record_number_display: result.record_id,
    encounter: "7",
    result,
  });
  assert.equal(saved, true);
}

test("empty database: /api/audits and /api/dashboard/stats answer with empty values", async () => {
  assert.deepEqual(await getJson("/api/audits"), { status: 200, body: { audits: [], total: 0 } });
  assert.deepEqual(await getJson("/api/dashboard/stats"), {
    status: 200,
    body: {
      total_audits: 0,
      avg_conformity: 0,
      min_conformity: { record_number: "", value: 0 },
      max_conformity: { record_number: "", value: 0 },
    },
  });
});

test("GET /api/audits lists every stored audit with the transformed result", async () => {
  save("job-low", LOWEST);
  save("job-high", HIGHEST);
  save("job-mid", MIDDLE);

  const { status, body } = await getJson<{ audits: AuditSummary[]; total: number }>("/api/audits");
  assert.equal(status, 200);
  assert.equal(body.total, 3);

  const low = body.audits.find((audit) => audit.job_id === "job-low");
  assert.ok(low);
  assert.equal(low.batch_id, "batch-api");
  assert.equal(low.status, "done");
  assert.equal(low.record_number_display, LOWEST.record_id);
  assert.equal(low.conformity_percent, percentOf(LOWEST));
  assert.equal(low.audit?.prontuario, LOWEST.record_id);
});

test("GET /api/audits/:id returns the transformed audit and the raw result", async () => {
  const { body: list } = await getJson<{ audits: AuditSummary[] }>("/api/audits");
  const high = list.audits.find((audit) => audit.job_id === "job-high");
  assert.ok(high);

  const { status, body } = await getJson<{
    id: number;
    record_number_display: string;
    conformity_percent: number;
    audit: { prontuario: string };
    raw: RawAuditResult;
    fields: { section: string; field: string }[];
  }>(`/api/audits/${high.id}`);

  assert.equal(status, 200);
  assert.equal(body.id, high.id);
  assert.equal(body.record_number_display, HIGHEST.record_id);
  assert.equal(body.conformity_percent, percentOf(HIGHEST));
  assert.equal(body.audit.prontuario, HIGHEST.record_id);
  assert.deepEqual(body.raw, HIGHEST);
  assert.ok(body.fields.length > 0);
  assert.ok(body.fields.some((field) => field.section === "A" && field.field === "prontuario"));
});

test("a batch posted to /batches is stored raw and shows up in the audit detail", async () => {
  const response = await fetch(`${BASE}/batches?source=upload`, {
    method: "POST",
    body: JSON.stringify([{ Prontuário: "11.222", Atendimento: "5", Sexo: "F" }]),
  });
  assert.equal(response.status, 202);
  const { jobs } = (await response.json()) as { jobs: { job_id: string }[] };

  save(jobs[0].job_id, { ...MIDDLE, record_id: "11.222" });
  const { body: list } = await getJson<{ audits: AuditSummary[] }>("/api/audits");
  const audit = list.audits.find((candidate) => candidate.job_id === jobs[0].job_id);
  assert.ok(audit);

  const { body } = await getJson<{
    raw_patient_record: { source: string; record_number: string; entries: { fields: Record<string, string> }[] } | null;
  }>(`/api/audits/${audit.id}`);
  assert.equal(body.raw_patient_record?.source, "upload");
  assert.equal(body.raw_patient_record?.record_number, "11222");
  assert.equal(body.raw_patient_record?.entries[0].fields.sex, "F");
});

test("an audit with no stored submission has raw_patient_record null", async () => {
  const { body: list } = await getJson<{ audits: AuditSummary[] }>("/api/audits");
  const audit = list.audits.find((candidate) => candidate.job_id === "job-low");
  assert.ok(audit);
  const { body } = await getJson<{ raw_patient_record: unknown }>(`/api/audits/${audit.id}`);
  assert.equal(body.raw_patient_record, null);
});

test("GET /api/audits/:id for an unknown id -> 404", async () => {
  assert.deepEqual(await getJson("/api/audits/999999"), { status: 404, body: { error: "Audit not found" } });
});

test("GET /api/dashboard/stats: total, rounded average and the lowest and highest audit", async () => {
  const percents = [LOWEST, HIGHEST, MIDDLE, MIDDLE].map(percentOf);
  const average = roundToTenth(percents.reduce((sum, value) => sum + value, 0) / percents.length);

  assert.deepEqual(await getJson("/api/dashboard/stats"), {
    status: 200,
    body: {
      total_audits: 4,
      avg_conformity: average,
      min_conformity: { record_number: LOWEST.record_id, value: roundToTenth(percentOf(LOWEST)) },
      max_conformity: { record_number: HIGHEST.record_id, value: roundToTenth(percentOf(HIGHEST)) },
    },
  });
});
