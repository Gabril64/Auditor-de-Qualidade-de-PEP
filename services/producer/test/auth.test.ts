import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness, type Session } from "./helpers/harness.js";

const harness = await startHarness();
const { getDb } = await import("../src/db/connection.js");

const AUDITOR = { email: "auditor@test.local", password: "password-auditor" };
const ADMIN = { email: "admin@test.local", password: "password-admin" };

await harness.addUser(AUDITOR.email, AUDITOR.password, "auditor");
await harness.addUser(ADMIN.email, ADMIN.password, "admin");

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function accessEvents(): string[] {
  const rows = getDb()?.prepare("SELECT event FROM access_log ORDER BY id").all() as Array<{ event: string }>;
  return rows.map((row) => row.event);
}

test("every route but /health and the login answers 401 without a session", async () => {
  const routes: Array<[string, string]> = [
    ["GET", "/api/audits"],
    ["GET", "/api/audits/1"],
    ["GET", "/api/dashboard/stats"],
    ["GET", "/jobs/abc/status"],
    ["GET", "/records/1/status"],
    ["POST", "/batches"],
    ["GET", "/api/users"],
    ["GET", "/api/auth/me"],
  ];
  for (const [method, route] of routes) {
    const response = await harness.fetchAs(null, route, { method });
    assert.equal(response.status, 401, `${method} ${route}`);
  }
  assert.equal((await harness.fetchAs(null, "/health")).status, 200);
});

test("login opens a session in an HttpOnly cookie and never returns the password hash", async () => {
  const response = await fetch(`${harness.base}/api/auth/login`, json(AUDITOR));
  assert.equal(response.status, 200);

  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  const text = await response.text();
  assert.doesNotMatch(text, /password_hash/);
  const body = JSON.parse(text) as { user: { email: string; role: string }; csrf_token: string };
  assert.equal(body.user.email, AUDITOR.email);
  assert.equal(body.user.role, "auditor");
  assert.ok(body.csrf_token.length > 20);
});

test("a wrong password and an unknown e-mail get the same answer", async () => {
  const wrongPassword = await fetch(`${harness.base}/api/auth/login`, json({ email: AUDITOR.email, password: "nope" }));
  const unknown = await fetch(`${harness.base}/api/auth/login`, json({ email: "ghost@test.local", password: "nope" }));

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrongPassword.json(), await unknown.json());
});

test("a request that changes state needs the CSRF token", async () => {
  const session = await harness.login(AUDITOR.email, AUDITOR.password);

  const without = await fetch(`${harness.base}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: session.cookie },
  });
  assert.equal(without.status, 403);

  const wrong = await harness.fetchAs({ ...session, csrfToken: "wrong" }, "/api/auth/logout", { method: "POST" });
  assert.equal(wrong.status, 403);

  assert.equal((await harness.fetchAs(session, "/api/auth/me")).status, 200);
});

test("logout ends the session on the server", async () => {
  const session = await harness.login(AUDITOR.email, AUDITOR.password);

  assert.equal((await harness.fetchAs(session, "/api/auth/logout", { method: "POST" })).status, 204);
  assert.equal((await harness.fetchAs(session, "/api/auth/me")).status, 401);
});

test("an expired session (gone from Redis) is refused", async () => {
  const session = await harness.login(AUDITOR.email, AUDITOR.password);
  for (const key of [...harness.store.keys()]) if (key.startsWith("sessao:")) harness.store.delete(key);

  assert.equal((await harness.fetchAs(session, "/api/audits")).status, 401);
});

test("only an administrator reaches the user routes", async () => {
  const auditor = await harness.login(AUDITOR.email, AUDITOR.password);
  const admin = await harness.login(ADMIN.email, ADMIN.password);

  assert.equal((await harness.fetchAs(auditor, "/api/users")).status, 403);
  const listed = await harness.fetchAs(admin, "/api/users");
  assert.equal(listed.status, 200);
  const { users } = (await listed.json()) as { users: Array<Record<string, unknown>> };
  assert.ok(users.length >= 2);
  assert.ok(users.every((user) => !("password_hash" in user)));
});

test("a new account must change its temporary password before using the system", async () => {
  const admin = await harness.login(ADMIN.email, ADMIN.password);

  const created = await harness.fetchAs(admin, "/api/users", {
    ...json({ email: "novo@test.local", name: "Novo", role: "auditor" }),
  });
  assert.equal(created.status, 201);
  const { temporary_password: temporary } = (await created.json()) as { temporary_password: string };
  assert.ok(temporary.length >= 10);

  const duplicate = await harness.fetchAs(admin, "/api/users", {
    ...json({ email: "novo@test.local", name: "Novo", role: "auditor" }),
  });
  assert.equal(duplicate.status, 409);

  const session = await harness.login("novo@test.local", temporary);
  const blocked = await harness.fetchAs(session, "/api/audits");
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "Password change required" });
  assert.equal((await harness.fetchAs(session, "/api/auth/me")).status, 200);

  const tooShort = await harness.fetchAs(session, "/api/auth/change-password", {
    ...json({ current_password: temporary, new_password: "short" }),
  });
  assert.equal(tooShort.status, 400);

  const changed = await harness.fetchAs(session, "/api/auth/change-password", {
    ...json({ current_password: temporary, new_password: "a-brand-new-password" }),
  });
  assert.equal(changed.status, 204);
  assert.equal((await harness.fetchAs(session, "/api/audits")).status, 200);
});

test("a deactivated user loses access at once, and the last administrator cannot be deactivated", async () => {
  const admin = await harness.login(ADMIN.email, ADMIN.password);
  const victimId = await harness.addUser("victim@test.local", "password-victim", "auditor");
  const victim: Session = await harness.login("victim@test.local", "password-victim");
  assert.equal((await harness.fetchAs(victim, "/api/audits")).status, 200);

  const deactivated = await harness.fetchAs(admin, `/api/users/${victimId}`, {
    ...json({ active: false }),
    method: "PATCH",
  });
  assert.equal(deactivated.status, 200);
  assert.equal((await harness.fetchAs(victim, "/api/audits")).status, 401);

  const users = (await (await harness.fetchAs(admin, "/api/users")).json()) as {
    users: Array<{ id: number; email: string }>;
  };
  const adminId = users.users.find((user) => user.email === ADMIN.email)?.id;
  const last = await harness.fetchAs(admin, `/api/users/${adminId}`, { ...json({ active: false }), method: "PATCH" });
  assert.equal(last.status, 409);
});

test("an administrator can reset a password, and the user must change it again", async () => {
  const admin = await harness.login(ADMIN.email, ADMIN.password);
  const id = await harness.addUser("reset@test.local", "password-reset", "auditor");

  const reset = await harness.fetchAs(admin, `/api/users/${id}/reset-password`, { method: "POST" });
  assert.equal(reset.status, 200);
  const { temporary_password: temporary } = (await reset.json()) as { temporary_password: string };

  assert.equal((await fetch(`${harness.base}/api/auth/login`, json({ email: "reset@test.local", password: "password-reset" }))).status, 401);
  const session = await harness.login("reset@test.local", temporary);
  assert.equal((await harness.fetchAs(session, "/api/audits")).status, 403);
});

test("five failed attempts for one e-mail block it, even with the right password", async () => {
  await harness.addUser("locked@test.local", "password-locked", "auditor");

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${harness.base}/api/auth/login`, json({ email: "locked@test.local", password: "x" }));
    assert.equal(response.status, 401);
  }

  const blocked = await fetch(
    `${harness.base}/api/auth/login`,
    json({ email: "locked@test.local", password: "password-locked" }),
  );
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("the access log records who did what, without clinical content", async () => {
  const session = await harness.login(AUDITOR.email, AUDITOR.password);
  const record = { Prontuário: "99.001", "Descricao do registro": "texto clínico sigiloso" };

  const submitted = await harness.fetchAs(session, "/batches", {
    ...json([record]),
  });
  assert.equal(submitted.status, 202);

  const events = accessEvents();
  for (const expected of ["login", "login_failed", "logout", "user_created", "batch_submitted"]) {
    assert.ok(events.includes(expected), `missing ${expected}`);
  }

  const details = getDb()?.prepare("SELECT detail FROM access_log WHERE detail IS NOT NULL").all() as Array<{
    detail: string;
  }>;
  assert.ok(details.every((row) => !row.detail.includes("sigiloso")));
});
