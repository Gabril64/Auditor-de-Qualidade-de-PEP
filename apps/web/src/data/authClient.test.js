// Sessão e login do front. Roda com:  npm test   (Node >= 22; sem dependência nova)
//
// O que estes testes protegem: o token do CSRF sai do login e vai em toda chamada que muda estado,
// um 401 no meio do uso devolve a pessoa ao login, e as mensagens da tela ficam em português.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { changePassword, fetchSession, login, logout } from "./authClient.js";
import { apiFetch, onUnauthorized, setCsrfToken } from "./session.js";

const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  setCsrfToken(null);
  onUnauthorized(null);
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const resposta = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

/** Troca o fetch por uma função e registra as chamadas (url, método e cabeçalhos). */
function mockFetch(responder) {
  const chamadas = [];
  globalThis.fetch = async (url, opts = {}) => {
    chamadas.push({ url: String(url), method: opts.method, headers: opts.headers || {}, body: opts.body });
    return responder(String(url), opts);
  };
  return chamadas;
}

const USUARIO = { id: 1, email: "maria@teste.local", name: "Maria", role: "auditor", must_change_password: false };

test("login: keeps the CSRF token and sends it on state-changing calls, not on reads", async () => {
  const chamadas = mockFetch((url) =>
    url.endsWith("/api/auth/login") ? resposta(200, { user: USUARIO, csrf_token: "tok-1" }) : resposta(200, {}),
  );

  assert.deepEqual(await login("maria@teste.local", "senha-longa-123"), USUARIO);
  await apiFetch("/batches", { method: "POST", body: "[]" });
  await apiFetch("/api/audits");

  assert.equal(chamadas[1].headers["X-CSRF-Token"], "tok-1");
  assert.equal(chamadas[2].headers["X-CSRF-Token"], undefined);
});

test("login: the body goes as JSON and the session cookie travels with the request", async () => {
  let enviado;
  globalThis.fetch = async (url, opts) => {
    enviado = opts;
    return resposta(200, { user: USUARIO, csrf_token: "t" });
  };
  await login("maria@teste.local", "senha-longa-123");

  assert.deepEqual(JSON.parse(enviado.body), { email: "maria@teste.local", password: "senha-longa-123" });
  assert.equal(enviado.credentials, "same-origin");
});

test("login with a wrong password: message in Portuguese, no token stored and no 'session expired' trigger'", async () => {
  let expirou = 0;
  onUnauthorized(() => expirou++);
  mockFetch(() => resposta(401, { error: "Invalid e-mail or password" }));

  await assert.rejects(login("a@b.c", "x"), { message: "E-mail ou senha incorretos.", status: 401 });
  assert.equal(expirou, 0);
});

test("locked login (429): returns the wait time from the Retry-After header", async () => {
  mockFetch(() => resposta(429, { error: "Too many attempts" }, { "retry-after": "540" }));

  await assert.rejects(login("a@b.c", "x"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 540);
    return true;
  });
});

test("fetchSession: 401 means 'no session' (null), 200 returns the user and recovers the token", async () => {
  mockFetch(() => resposta(401, { error: "Authentication required" }));
  assert.equal(await fetchSession(), null);

  const chamadas = mockFetch((url) =>
    url.endsWith("/api/auth/me") ? resposta(200, { user: USUARIO, csrf_token: "tok-2" }) : resposta(204, null),
  );
  assert.deepEqual(await fetchSession(), USUARIO);
  await apiFetch("/api/auth/logout", { method: "POST" });
  assert.equal(chamadas[1].headers["X-CSRF-Token"], "tok-2");
});

test("401 in the middle of use: clears the token and notifies once, to return to login", async () => {
  let expirou = 0;
  onUnauthorized(() => expirou++);
  setCsrfToken("tok-3");
  const chamadas = mockFetch(() => resposta(401, { error: "Authentication required" }));

  await apiFetch("/api/audits");
  await apiFetch("/batches", { method: "POST", body: "[]" });

  assert.equal(expirou, 2);
  assert.equal(chamadas[1].headers["X-CSRF-Token"], undefined, "o token antigo não pode ficar valendo");
});

test("changePassword: sends both passwords, and translates the wrong-current-password error", async () => {
  const chamadas = mockFetch(() => resposta(204, null));
  await changePassword("provisoria-123", "uma-senha-nova-longa");
  assert.deepEqual(JSON.parse(chamadas[0].body), {
    current_password: "provisoria-123",
    new_password: "uma-senha-nova-longa",
  });

  mockFetch(() => resposta(400, { error: "Current password is incorrect" }));
  await assert.rejects(changePassword("errada", "uma-senha-nova-longa"), {
    message: "A senha atual está incorreta.",
  });
});

test("changePassword: an unknown server error becomes a generic message, without leaking its text", async () => {
  mockFetch(() => resposta(500, { error: "SQLITE_ERROR: no such table" }));
  await assert.rejects(changePassword("a", "b"), { message: "Não foi possível trocar a senha." });
});

test("logout: clears the token even if the server fails", async () => {
  setCsrfToken("tok-4");
  const chamadas = mockFetch(() => resposta(500, {}));
  await logout();
  await apiFetch("/batches", { method: "POST", body: "[]" });

  assert.equal(chamadas[1].headers["X-CSRF-Token"], undefined);
});
