import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { RawAuditResult } from "../src/transformer.js";
import { startHarness, type Session } from "./helpers/harness.js";

interface Detail {
  id: number;
  conformity_percent: number;
  original_conformity_percent: number;
  updated_at: string | null;
  deleted_at: string | null;
  raw: { audit_data: { secao_d_evolucao: Record<string, string> } };
  revised_audit: { audit_data: { secao_d_evolucao: Record<string, string> } } | null;
  fields: Array<{ field: string; section: string; record_type: string | null; status: string; source: string }>;
  revised_fields: Array<{ field: string; section: string; record_type: string | null; status: string; source: string }>;
  approval_status: string;
  approved_by: string[];
  approved_before_edit_by: string[];
  approved_by_me: boolean;
  history: Array<{ action: string; field: string | null; old_value: string | null; new_value: string | null }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const records = JSON.parse(
  readFileSync(path.resolve(here, "../../../tests/snapshots/audit_ok_mix.json"), "utf8"),
) as RawAuditResult[];

const harness = await startHarness();
const { upsertAuditResult } = await import("../src/repositories/audits.js");

const MARIA = { email: "maria@test.local", password: "password-maria" };
const JOAO = { email: "joao@test.local", password: "password-joao" };
const ADMIN = { email: "admin@test.local", password: "password-admin" };
await harness.addUser(MARIA.email, MARIA.password, "auditor");
await harness.addUser(JOAO.email, JOAO.password, "auditor");
await harness.addUser(ADMIN.email, ADMIN.password, "admin");

const maria = await harness.login(MARIA.email, MARIA.password);
const joao = await harness.login(JOAO.email, JOAO.password);
const admin = await harness.login(ADMIN.email, ADMIN.password);

let nextRecord = 0;

/** Stores a fresh audit (one fixture record each) and returns its id. */
async function newAudit(): Promise<{ id: number; record: RawAuditResult }> {
  const record = records[nextRecord++];
  upsertAuditResult({
    batch_id: "b",
    job_id: `job-${nextRecord}`,
    record_number: record.record_id?.replace(/\./g, ""),
    record_number_display: record.record_id,
    result: record,
  });
  const list = (await (await harness.fetchAs(maria, "/api/audits")).json()) as {
    audits: Array<{ id: number; job_id: string }>;
  };
  const found = list.audits.find((audit) => audit.job_id === `job-${nextRecord}`);
  assert.ok(found);
  return { id: found.id, record };
}

function send(session: Session, method: string, route: string, body?: unknown): Promise<Response> {
  return harness.fetchAs(session, route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function detailOf(session: Session, id: number): Promise<Detail> {
  const response = await harness.fetchAs(session, `/api/audits/${id}`);
  assert.equal(response.status, 200);
  return (await response.json()) as Detail;
}

const CONDUTAS = { section: "D", record_type: "evolution", field: "condutas" };

test("an edit goes to the current version and never to the original", async () => {
  const { id, record } = await newAudit();
  const global = record.audit_data?.conformity_global;
  assert.ok(global?.valid !== undefined && global.total);

  const saved = await send(maria, "PATCH", `/api/audits/${id}/revision`, {
    updated_at: null,
    changes: [{ ...CONDUTAS, status: "conforme", comment: "corrigido pelo auditor" }],
  });
  assert.equal(saved.status, 200);
  const { updated_at: version } = (await saved.json()) as { updated_at: string };

  const detail = await detailOf(joao, id);
  assert.equal(detail.updated_at, version);
  assert.equal(detail.revised_audit?.audit_data.secao_d_evolucao.condutas, "conforme (corrigido pelo auditor)");
  assert.match(detail.raw.audit_data.secao_d_evolucao.condutas, /^não conforme/);

  const original = detail.fields.find((row) => row.field === "condutas" && row.section === "D");
  const current = detail.revised_fields.find((row) => row.field === "condutas" && row.section === "D");
  assert.equal(original?.status, "nao_conforme");
  assert.equal(current?.status, "conforme");
  assert.equal(current?.source, "human");

  assert.equal(detail.original_conformity_percent, global.percent);
  assert.ok(Math.abs(detail.conformity_percent - ((global.valid ?? 0) + 1) / (global.total ?? 1) * 100) < 1e-9);

  const edit = detail.history.find((entry) => entry.action === "field_edit");
  assert.equal(edit?.field, "condutas");
  assert.match(edit?.old_value ?? "", /^não conforme/);
  assert.equal(edit?.new_value, "conforme (corrigido pelo auditor)");
});

test("saving over a version somebody else already changed is refused with 409", async () => {
  const { id } = await newAudit();
  const change = { ...CONDUTAS, status: "conforme" };

  const first = await send(maria, "PATCH", `/api/audits/${id}/revision`, { updated_at: null, changes: [change] });
  const { updated_at: version } = (await first.json()) as { updated_at: string };

  const stale = await send(joao, "PATCH", `/api/audits/${id}/revision`, { updated_at: null, changes: [change] });
  assert.equal(stale.status, 409);

  const fresh = await send(joao, "PATCH", `/api/audits/${id}/revision`, { updated_at: version, changes: [change] });
  assert.equal(fresh.status, 200);
  assert.ok(((await fresh.json()) as { updated_at: string }).updated_at > version);
});

test("an edit with an unknown field or a status that is not conforme/nao_conforme is a 400", async () => {
  const { id } = await newAudit();

  const unknown = await send(maria, "PATCH", `/api/audits/${id}/revision`, {
    updated_at: null,
    changes: [{ section: "D", record_type: "evolution", field: "nao_existe", status: "conforme" }],
  });
  assert.equal(unknown.status, 400);

  const badStatus = await send(maria, "PATCH", `/api/audits/${id}/revision`, {
    updated_at: null,
    changes: [{ ...CONDUTAS, status: "nao_se_aplica" }],
  });
  assert.equal(badStatus.status, 400);

  assert.equal((await detailOf(maria, id)).updated_at, null);
});

test("approval is per person and tied to the version they saw", async () => {
  const { id } = await newAudit();
  assert.equal((await detailOf(maria, id)).approval_status, "pending");

  assert.equal((await send(maria, "POST", `/api/audits/${id}/approve`)).status, 204);
  assert.equal((await send(maria, "POST", `/api/audits/${id}/approve`)).status, 204);

  const afterMaria = await detailOf(joao, id);
  assert.equal(afterMaria.approval_status, "approved");
  assert.deepEqual(afterMaria.approved_by, [MARIA.email]);
  assert.equal(afterMaria.approved_by_me, false);
  assert.equal((await detailOf(maria, id)).approved_by_me, true);
  assert.equal(afterMaria.history.filter((entry) => entry.action === "approve").length, 1);

  await send(joao, "PATCH", `/api/audits/${id}/revision`, { updated_at: null, changes: [{ ...CONDUTAS, status: "conforme" }] });
  const afterEdit = await detailOf(maria, id);
  assert.equal(afterEdit.approval_status, "approved_before_edit");
  assert.deepEqual(afterEdit.approved_before_edit_by, [MARIA.email]);
  assert.equal(afterEdit.approved_by_me, false);

  await send(joao, "POST", `/api/audits/${id}/approve`);
  assert.deepEqual((await detailOf(maria, id)).approved_by, [JOAO.email]);
});

test("a person can withdraw only their own approval", async () => {
  const { id } = await newAudit();
  await send(maria, "POST", `/api/audits/${id}/approve`);
  await send(joao, "POST", `/api/audits/${id}/approve`);

  assert.equal((await send(joao, "DELETE", `/api/audits/${id}/approve`)).status, 204);
  const detail = await detailOf(maria, id);
  assert.deepEqual(detail.approved_by, [MARIA.email]);
  assert.equal(detail.history.filter((entry) => entry.action === "revoke_approval").length, 1);
});

test("the list shows the current conformity, the edit flag and the approval", async () => {
  const { id } = await newAudit();
  await send(maria, "PATCH", `/api/audits/${id}/revision`, { updated_at: null, changes: [{ ...CONDUTAS, status: "conforme" }] });
  await send(maria, "POST", `/api/audits/${id}/approve`);

  const list = (await (await harness.fetchAs(joao, "/api/audits")).json()) as {
    audits: Array<{ id: number; edited: boolean; approval_status: string; approved_by: string[]; conformity_percent: number }>;
  };
  const row = list.audits.find((audit) => audit.id === id);
  const detail = await detailOf(joao, id);
  assert.equal(row?.edited, true);
  assert.equal(row?.approval_status, "approved");
  assert.deepEqual(row?.approved_by, [MARIA.email]);
  assert.equal(row?.conformity_percent, detail.conformity_percent);
});

test("only an administrator deletes and restores, and nothing is removed from the database", async () => {
  const { id } = await newAudit();
  await send(maria, "POST", `/api/audits/${id}/approve`);

  assert.equal((await send(maria, "DELETE", `/api/audits/${id}`)).status, 403);
  assert.equal((await send(admin, "DELETE", `/api/audits/${id}`)).status, 204);

  const visible = (await (await harness.fetchAs(maria, "/api/audits")).json()) as { audits: Array<{ id: number }> };
  assert.ok(!visible.audits.some((audit) => audit.id === id));
  assert.equal((await harness.fetchAs(maria, `/api/audits/${id}`)).status, 404);

  const deleted = (await (await harness.fetchAs(admin, "/api/audits?deleted=1")).json()) as {
    audits: Array<{ id: number }>;
  };
  assert.ok(deleted.audits.some((audit) => audit.id === id));
  assert.ok((await detailOf(admin, id)).deleted_at);

  assert.equal((await send(maria, "POST", `/api/audits/${id}/restore`)).status, 403);
  assert.equal((await send(admin, "POST", `/api/audits/${id}/restore`)).status, 204);

  const restored = await detailOf(maria, id);
  assert.equal(restored.deleted_at, null);
  assert.equal(restored.approval_status, "approved");
  assert.deepEqual(
    restored.history.map((entry) => entry.action).filter((action) => action === "delete" || action === "restore"),
    ["delete", "restore"],
  );
});

test("the dashboard counts the current conformity and leaves deleted audits out", async () => {
  const { id } = await newAudit();
  const before = (await (await harness.fetchAs(maria, "/api/dashboard/stats")).json()) as { total_audits: number };

  await send(admin, "DELETE", `/api/audits/${id}`);
  const after = (await (await harness.fetchAs(maria, "/api/dashboard/stats")).json()) as { total_audits: number };
  assert.equal(after.total_audits, before.total_audits - 1);
});
