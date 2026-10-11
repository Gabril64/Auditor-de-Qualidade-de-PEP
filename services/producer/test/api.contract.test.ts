import assert from "node:assert/strict";
import net from "node:net";
import { before, mock, test } from "node:test";

interface PushedMessage {
  key: string;
  value: string;
}

interface ErrorBody {
  error: string;
}

interface BatchBody {
  message: string;
  batch_id: string;
  total_records: number;
  jobs: { record_number: string; job_id: string }[];
}

interface QueuedJobPayload {
  job_id: string;
  batch_id: string;
  record_number: string;
  record_number_display: string;
  total_entries: number;
  records: unknown[];
  model_name?: string;
  seed?: number;
  attempts: number;
}

interface StatusResponse {
  status: number;
  body: { status?: string; raw?: { audit_data?: { observacao_ia?: string } } };
}

const store = new Map<string, string>();
const pushed: PushedMessage[] = [];

const fakeClient = {
  on() {},
  async connect() {},
  async lPush(key: string, value: string) {
    pushed.push({ key, value });
    return pushed.length;
  },
  async get(key: string) {
    return store.has(key) ? store.get(key) : null;
  },
};

mock.module("redis", { namedExports: { createClient: () => fakeClient } });

const port = await new Promise<number>((resolve) => {
  const probe = net.createServer().listen(0, () => {
    const { port: freePort } = probe.address() as net.AddressInfo;
    probe.close(() => resolve(freePort));
  });
});
process.env.PORT = String(port);
const BASE = `http://127.0.0.1:${port}`;

await import("../src/server.js");

async function isHealthy(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/health`)).ok;
  } catch {
    return false;
  }
}

before(async () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await isHealthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Producer did not start");
});

const post = (path: string, body: string) => fetch(`${BASE}${path}`, { method: "POST", body });

async function getJson(path: string): Promise<StatusResponse> {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: (await response.json()) as StatusResponse["body"] };
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as ErrorBody).error;
}

function pushedJob(index: number): QueuedJobPayload {
  return JSON.parse(pushed[index].value);
}

function reset(): void {
  store.clear();
  pushed.length = 0;
}

test("GET /health", async () => {
  assert.deepEqual(await getJson("/health"), { status: 200, body: { ok: true } });
});

test("POST /batches: groups by record number (dots removed), publishes one job per record with model and seed", async () => {
  reset();
  const payload = JSON.stringify([
    { Prontuário: "12.345", Atendimento: "9", "Tipo do registro": "Anamnese" },
    { Prontuário: "12.345", Atendimento: "9", "Tipo do registro": "Evolução" },
    { Prontuário: "67.890", Atendimento: "7" },
  ]);
  const response = await post("/batches?model=phi-4&seed=42", payload);
  assert.equal(response.status, 202);
  const body = (await response.json()) as BatchBody;

  assert.equal(body.message, "Batch received and queued");
  assert.equal(body.total_records, 2);
  assert.deepEqual(
    body.jobs.map((job) => job.record_number),
    ["12345", "67890"],
  );

  assert.equal(pushed.length, 2);
  assert.ok(pushed.every((message) => message.key === "fila:prontuarios"));
  const job = pushedJob(0);
  assert.equal(job.job_id, body.jobs[0].job_id);
  assert.equal(job.batch_id, body.batch_id);
  assert.equal(job.record_number, "12345");
  assert.equal(job.record_number_display, "12.345");
  assert.equal(job.total_entries, 2);
  assert.equal(job.records.length, 2);
  assert.equal(job.model_name, "phi-4");
  assert.equal(job.seed, 42);
  assert.equal(job.attempts, 0);
});

test("POST /batches: without model and seed, the job carries neither key", async () => {
  reset();
  await post("/batches", JSON.stringify([{ Prontuário: "1" }]));
  const job = pushedJob(0);
  assert.equal("model_name" in job, false);
  assert.equal("seed" in job, false);
});

test("POST /batches: accepts the {...},{...} format (no brackets)", async () => {
  reset();
  const response = await post("/batches", '{"Prontuário":"1"},{"Prontuário":"2"}');
  assert.equal(response.status, 202);
  assert.equal(((await response.json()) as BatchBody).total_records, 2);
});

test("POST /batches: non-integer seed -> 400", async () => {
  reset();
  const response = await post("/batches?seed=abc", JSON.stringify([{ Prontuário: "1" }]));
  assert.equal(response.status, 400);
  assert.match(await errorOf(response), /seed/);
  assert.equal(pushed.length, 0);
});

test("POST /batches: empty body -> 400", async () => {
  reset();
  const response = await post("/batches", "");
  assert.equal(response.status, 400);
  assert.equal(await errorOf(response), "Empty or invalid request body");
});

test("POST /batches: body that is not JSON -> 400 'Invalid payload'", async () => {
  reset();
  const response = await post("/batches", "isto não é json {");
  assert.equal(response.status, 400);
  assert.match(await errorOf(response), /^Invalid payload/);
});

test("POST /batches: record without 'Prontuário' -> 400 and nothing is published", async () => {
  reset();
  const response = await post("/batches", JSON.stringify([{ x: 1 }]));
  assert.equal(response.status, 400);
  assert.match(await errorOf(response), /^Invalid payload.*Prontuário/);
  assert.equal(pushed.length, 0);
});

test("POST /batches: one record without 'Prontuário' rejects the whole batch (nothing is half-published)", async () => {
  reset();
  const response = await post("/batches", JSON.stringify([{ Prontuário: "12.345" }, { Atendimento: "9" }]));
  assert.equal(response.status, 400);
  assert.match(await errorOf(response), /record 2/);
  assert.equal(pushed.length, 0);
});

test("POST /batches: empty, blank or null 'Prontuário' is also rejected", async () => {
  reset();
  for (const value of ["", "   ", null]) {
    const response = await post("/batches", JSON.stringify([{ Prontuário: value }]));
    assert.equal(response.status, 400);
  }
  assert.equal(pushed.length, 0);
});

test("POST /batches: item that is not an object -> 400 without leaking an internal error", async () => {
  reset();
  const response = await post("/batches", JSON.stringify([null, "texto"]));
  assert.equal(response.status, 400);
  const error = await errorOf(response);
  assert.match(error, /^Invalid payload/);
  assert.doesNotMatch(error, /Cannot read|undefined|TypeError/);
  assert.equal(pushed.length, 0);
});

test("POST /batches: numeric 'Prontuário' is accepted and becomes text", async () => {
  reset();
  const response = await post("/batches", JSON.stringify([{ Prontuário: 12345 }]));
  assert.equal(response.status, 202);
  assert.deepEqual(
    ((await response.json()) as BatchBody).jobs.map((job) => job.record_number),
    ["12345"],
  );
});

test("GET /jobs/:id/status: processing | done | partial | failed (failure reason is explicit and bypasses the transformer)", async () => {
  reset();
  assert.deepEqual(await getJson("/jobs/abc/status"), { status: 202, body: { status: "processing", job_id: "abc" } });

  store.set("resultado:abc", JSON.stringify({ record_id: "1", audit_data: { ia_incompleta: false } }));
  let result = await getJson("/jobs/abc/status");
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "done");

  store.set("resultado:abc", JSON.stringify({ record_id: "1", audit_data: { ia_incompleta: true } }));
  result = await getJson("/jobs/abc/status");
  assert.equal(result.body.status, "partial");

  store.set("resultado:abc", JSON.stringify({ _job_failed: true, error: "boom", attempts: 3 }));
  result = await getJson("/jobs/abc/status");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: "failed", job_id: "abc", error: "boom", attempts: 3 });
});

test("GET /jobs/:id/status: partial result carries the AI warning in 'raw' so the front end can show it", async () => {
  reset();
  const partial = { record_id: "1", audit_data: { ia_incompleta: true, observacao_ia: "IA falhou em 2 campos" } };
  store.set("resultado:abc", JSON.stringify(partial));
  const result = await getJson("/jobs/abc/status");
  assert.equal(result.body.status, "partial");
  assert.equal(result.body.raw?.audit_data?.observacao_ia, "IA falhou em 2 campos");
});

test("GET /records/:number/status: strips dots and reads the latest result for the record", async () => {
  reset();
  assert.deepEqual(await getJson("/records/12.345/status"), {
    status: 202,
    body: { status: "processing", record_number: "12345" },
  });
  store.set("resultado:12345", JSON.stringify({ record_id: "12.345", audit_data: {} }));
  const result = await getJson("/records/12.345/status");
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "done");
});

test("KNOWN (item 13): jobs and records share the 'resultado:' prefix, so the same data shows up on both routes", async () => {
  reset();
  store.set("resultado:12345", JSON.stringify({ record_id: "12.345", audit_data: {} }));
  assert.equal((await getJson("/jobs/12345/status")).body.status, "done");
});
