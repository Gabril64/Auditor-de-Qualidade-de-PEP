import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { RawAuditResult } from "../src/transformer.js";
import { startHarness, type Session } from "./helpers/harness.js";

interface Notification {
  id: number;
  type: string;
  job_id: string;
  audit_id: number | null;
  record_number_display: string | null;
  detail: string | null;
  read_at: string | null;
}

interface Listing {
  notifications: Notification[];
  unread_count: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const record = (
  JSON.parse(readFileSync(path.resolve(here, "../../../tests/snapshots/audit_ok_mix.json"), "utf8")) as RawAuditResult[]
)[0];

const harness = await startHarness();
const { recordJobOutcome, purgeOldNotifications } = await import("../src/services/results.js");
const { getDb } = await import("../src/db/connection.js");

await harness.addUser("maria@test.local", "password-maria", "auditor");
await harness.addUser("joao@test.local", "password-joao", "auditor");
await harness.addUser("admin@test.local", "password-admin", "admin");
const maria = await harness.login("maria@test.local", "password-maria");
const joao = await harness.login("joao@test.local", "password-joao");
const admin = await harness.login("admin@test.local", "password-admin");

/** Submits one record as `session`, as the front end would, and returns the job id. */
async function submit(session: Session, number: string): Promise<{ jobId: string; batchId: string }> {
  const response = await harness.fetchAs(session, "/batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ Prontuário: number, "Descricao do registro": "texto clínico sigiloso" }]),
  });
  assert.equal(response.status, 202);
  const body = (await response.json()) as { batch_id: string; jobs: Array<{ job_id: string }> };
  return { jobId: body.jobs[0].job_id, batchId: body.batch_id };
}

async function listing(session: Session, query = ""): Promise<Listing> {
  const response = await harness.fetchAs(session, `/api/notifications${query}`);
  assert.equal(response.status, 200);
  return (await response.json()) as Listing;
}

function finished(jobId: string, batchId: string, result: unknown, number = "1") {
  return {
    batch_id: batchId,
    job_id: jobId,
    record_number: number.replace(/\./g, ""),
    record_number_display: number,
    result: result as RawAuditResult,
  };
}

test("a finished audit notifies who submitted it and the administrators, not the other auditors", async () => {
  const { jobId, batchId } = await submit(maria, "10.001");
  assert.equal(recordJobOutcome(finished(jobId, batchId, record, "10.001")), true);

  const own = (await listing(maria)).notifications.find((item) => item.job_id === jobId);
  assert.equal(own?.type, "audit_done");
  assert.equal(own?.record_number_display, "10.001");
  assert.ok(own?.audit_id);
  assert.equal(own?.read_at, null);

  assert.ok((await listing(admin)).notifications.some((item) => item.job_id === jobId));
  assert.ok(!(await listing(joao)).notifications.some((item) => item.job_id === jobId));
});

test("an administrator who submitted gets a single notification", async () => {
  const { jobId, batchId } = await submit(admin, "10.002");
  recordJobOutcome(finished(jobId, batchId, record, "10.002"));

  const matching = (await listing(admin)).notifications.filter((item) => item.job_id === jobId);
  assert.equal(matching.length, 1);
});

test("a partial result and a failed job each notify with their own type and a generic reason", async () => {
  const partial = await submit(maria, "10.003");
  const partialResult = { ...record, audit_data: { ...record.audit_data, ia_incompleta: true } };
  recordJobOutcome(finished(partial.jobId, partial.batchId, partialResult, "10.003"));

  const failed = await submit(maria, "10.004");
  recordJobOutcome(finished(failed.jobId, failed.batchId, { _job_failed: true, attempts: 2 }, "10.004"));

  const items = (await listing(maria)).notifications;
  assert.equal(items.find((item) => item.job_id === partial.jobId)?.type, "audit_partial");
  const failure = items.find((item) => item.job_id === failed.jobId);
  assert.equal(failure?.type, "audit_failed");
  assert.equal(failure?.audit_id, null);
  assert.doesNotMatch(failure?.detail ?? "", /sigiloso|Traceback|stderr/);

  const db = getDb();
  assert.ok(db);
  const stored = db.prepare("SELECT COUNT(*) AS n FROM audit_results WHERE job_id = ?").get(failed.jobId) as {
    n: number;
  };
  assert.equal(stored.n, 0);
});

test("delivering the same result again does not notify twice", async () => {
  const { jobId, batchId } = await submit(maria, "10.005");
  recordJobOutcome(finished(jobId, batchId, record, "10.005"));
  recordJobOutcome(finished(jobId, batchId, record, "10.005"));

  const matching = (await listing(maria)).notifications.filter((item) => item.job_id === jobId);
  assert.equal(matching.length, 1);
});

test("`after` returns only what is newer, and the unread count follows reading", async () => {
  const before = await listing(maria);
  const lastId = before.notifications.at(-1)?.id ?? 0;

  const { jobId, batchId } = await submit(maria, "10.006");
  recordJobOutcome(finished(jobId, batchId, record, "10.006"));

  const news = await listing(maria, `?after=${lastId}`);
  assert.deepEqual(
    news.notifications.map((item) => item.job_id),
    [jobId],
  );
  assert.equal(news.unread_count, before.unread_count + 1);

  const read = await harness.fetchAs(maria, `/api/notifications/${news.notifications[0].id}/read`, { method: "POST" });
  assert.equal(read.status, 200);
  assert.equal(((await read.json()) as { unread_count: number }).unread_count, before.unread_count);
});

test("a person cannot read the notification of another", async () => {
  const mine = (await listing(maria)).notifications[0];
  const attempt = await harness.fetchAs(joao, `/api/notifications/${mine.id}/read`, { method: "POST" });
  assert.equal(attempt.status, 404);
  assert.equal((await listing(maria)).notifications.find((item) => item.id === mine.id)?.read_at, null);
});

test("read-all clears the unread count", async () => {
  const response = await harness.fetchAs(admin, "/api/notifications/read-all", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal((await listing(admin)).unread_count, 0);
});

test("without a session, or with a bad `after`, the route refuses", async () => {
  assert.equal((await harness.fetchAs(null, "/api/notifications")).status, 401);
  assert.equal((await harness.fetchAs(maria, "/api/notifications?after=abc")).status, 400);
});

test("read notifications older than 30 days are purged and unread ones are kept", async () => {
  const db = getDb();
  assert.ok(db);
  const mariaId = (db.prepare("SELECT id FROM users WHERE email = 'maria@test.local'").get() as { id: number }).id;
  const insert = db.prepare(
    `INSERT INTO notifications (user_id, type, job_id, created_at, read_at) VALUES (?, 'audit_done', ?, ?, ?)`,
  );
  const old = "2020-01-01T00:00:00.000Z";
  insert.run(mariaId, "old-read", old, old);
  insert.run(mariaId, "old-unread", old, null);

  assert.ok(purgeOldNotifications() >= 1);
  const left = db.prepare("SELECT job_id FROM notifications WHERE job_id LIKE 'old-%'").all() as Array<{
    job_id: string;
  }>;
  assert.deepEqual(
    left.map((row) => row.job_id),
    ["old-unread"],
  );
});
