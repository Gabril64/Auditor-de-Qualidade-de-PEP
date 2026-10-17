import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness } from "./helpers/harness.js";

const TOKEN = "token-de-avaliacao-para-teste";
process.env.EVAL_API_TOKEN = TOKEN;

const harness = await startHarness();
const { getDb } = await import("../src/db/connection.js");
const { serviceUserEmail } = await import("../src/auth/serviceToken.js");

// The harness never runs the seed, so the account `authenticate` looks up is created here.
const serviceUserId = await harness.addUser(serviceUserEmail(), "unused-password", "auditor");

const PAYLOAD = JSON.stringify([{ Prontuário: "12.345", Atendimento: "9", "Tipo do registro": "Anamnese" }]);

/** A request as the notebook makes it: the token header alone, with no cookie and no CSRF token. */
function withToken(route: string, init: RequestInit = {}, token = TOKEN): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-api-token", token);
  return fetch(`${harness.base}${route}`, { ...init, headers });
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

test("the service token submits a batch with no session and no CSRF token", async () => {
  harness.reset();
  const response = await withToken("/batches?model=qwen2.5-3b-instruct&seed=42", { method: "POST", body: PAYLOAD });

  assert.equal(response.status, 202);
  const body = (await response.json()) as { jobs: { job_id: string }[] };
  assert.equal(body.jobs.length, 1);
  assert.equal(harness.pushed.length, 1);

  // The batch still has an author, so the access log stays complete.
  const logged = getDb()
    ?.prepare("SELECT user_id, email FROM access_log WHERE event = 'batch_submitted' ORDER BY id DESC LIMIT 1")
    .get() as { user_id: number; email: string } | undefined;
  assert.equal(logged?.user_id, serviceUserId);
  assert.equal(logged?.email, serviceUserEmail());

  // And polling the job, which is what the notebook does next, works with the same header.
  const status = await withToken(`/jobs/${body.jobs[0].job_id}/status`);
  assert.equal(status.status, 202);
});

test("a wrong or empty token is rejected, and never falls back to the session path", async () => {
  const wrong = await withToken("/batches", { method: "POST", body: PAYLOAD }, "not-the-token");
  assert.equal(wrong.status, 401);
  assert.equal(await errorOf(wrong), "Invalid service token");

  const empty = await withToken("/batches", { method: "POST", body: PAYLOAD }, "");
  assert.equal(empty.status, 401);

  // A token of the right length but the wrong bytes must not pass the constant-time comparison.
  const sameLength = await withToken("/batches", { method: "POST", body: PAYLOAD }, "x".repeat(TOKEN.length));
  assert.equal(sameLength.status, 401);
});

test("the token carries the service account's rights: an auditor, so no admin-only route", async () => {
  const response = await withToken("/api/audits/1", { method: "DELETE" });
  assert.equal(response.status, 403);
  assert.equal(await errorOf(response), "Forbidden");
});

test("without EVAL_API_TOKEN the header authenticates nothing", async () => {
  delete process.env.EVAL_API_TOKEN;
  try {
    const response = await withToken("/batches", { method: "POST", body: PAYLOAD });
    assert.equal(response.status, 401);
    assert.equal(await errorOf(response), "Service token authentication is disabled");
  } finally {
    process.env.EVAL_API_TOKEN = TOKEN;
  }
});

test("a missing service account is reported instead of silently authenticating", async () => {
  getDb()?.prepare("UPDATE users SET active = 0 WHERE id = ?").run(serviceUserId);
  try {
    const response = await withToken("/batches", { method: "POST", body: PAYLOAD });
    assert.equal(response.status, 401);
    assert.match(await errorOf(response), /does not exist or is inactive/);
  } finally {
    getDb()?.prepare("UPDATE users SET active = 1 WHERE id = ?").run(serviceUserId);
  }
});
