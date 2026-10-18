// Polling de jobs do apiClient. Roda com:  npm test   (Node >= 22; sem dependência nova)
//
// O ponto que estes testes protegem: `partial` e `failed` são desfechos normais do servidor, e o front
// precisa reagir a eles na hora. Antes, só `done` encerrava o polling; o resto esperava o timeout de 5 min.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { approveAudit, deleteAudit, fetchDeletedAudits, pollJobStatus, restoreAudit, revokeAuditApproval, submitAndPollBatch } from "./apiClient.js";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const resposta = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Troca o fetch. `rotas` mapeia um pedaço da URL para uma resposta (ou uma função que a devolve). */
function mockFetch(rotas) {
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push(String(url));
    const chave = Object.keys(rotas).find((k) => String(url).includes(k));
    assert.ok(chave, `chamada inesperada: ${url}`);
    const r = rotas[chave];
    return typeof r === "function" ? r(url, opts) : r;
  };
  return chamadas;
}

const RAPIDO = { intervalMs: 1, timeoutMs: 500 };

test("done: returns the result and does not mark it as partial", async () => {
  mockFetch({ "/jobs/j1/status": resposta(200, { status: "done", result: { prontuario: "1" } }) });
  const r = await pollJobStatus("j1", RAPIDO);
  assert.deepEqual(r, { prontuario: "1" });
});

test("processing -> done: keeps polling until it finishes", async () => {
  let n = 0;
  const chamadas = mockFetch({
    "/jobs/j1/status": () =>
      ++n < 3 ? resposta(202, { status: "processing", job_id: "j1" }) : resposta(200, { status: "done", result: { ok: 1 } }),
  });
  assert.deepEqual(await pollJobStatus("j1", RAPIDO), { ok: 1 });
  assert.equal(chamadas.length, 3);
});

test("partial: hands over the result on the first poll, with the AI warning", async () => {
  const chamadas = mockFetch({
    "/jobs/j1/status": resposta(200, {
      status: "partial",
      result: { prontuario: "1", conformidade_geral: 80 },
      raw: { audit_data: { ia_incompleta: true, observacao_ia: "IA falhou em 2 campos" } },
    }),
  });
  const r = await pollJobStatus("j1", RAPIDO);
  assert.equal(r._parcial, true);
  assert.equal(r._aviso_ia, "IA falhou em 2 campos");
  assert.equal(r.conformidade_geral, 80);
  assert.equal(chamadas.length, 1, "não pode esperar o timeout");
});

test("partial without an AI note: the warning is null, without breaking", async () => {
  mockFetch({ "/jobs/j1/status": resposta(200, { status: "partial", result: { prontuario: "1" }, raw: {} }) });
  const r = await pollJobStatus("j1", RAPIDO);
  assert.equal(r._parcial, true);
  assert.equal(r._aviso_ia, null);
});

test("failed: rejects at once with the server reason", async () => {
  const chamadas = mockFetch({
    "/jobs/j1/status": resposta(200, { status: "failed", job_id: "j1", error: "boom", attempts: 2 }),
  });
  await assert.rejects(pollJobStatus("j1", RAPIDO), /O processamento falhou: boom/);
  assert.equal(chamadas.length, 1, "não pode esperar o timeout");
});

test("failed without a reason: generic message, no 'undefined'", async () => {
  mockFetch({ "/jobs/j1/status": resposta(200, { status: "failed", job_id: "j1" }) });
  await assert.rejects(pollJobStatus("j1", RAPIDO), (err) => {
    assert.match(err.message, /falhou/);
    assert.doesNotMatch(err.message, /undefined/);
    return true;
  });
});

test("server HTTP error: rejects with its message instead of polling until the timeout", async () => {
  const chamadas = mockFetch({ "/jobs/j1/status": resposta(500, { error: "Erro interno" }) });
  await assert.rejects(pollJobStatus("j1", RAPIDO), /Erro interno/);
  assert.equal(chamadas.length, 1);
});

test("a job that never finishes: times out", async () => {
  mockFetch({ "/jobs/j1/status": resposta(202, { status: "processing" }) });
  await assert.rejects(pollJobStatus("j1", { intervalMs: 2, timeoutMs: 30 }), /timed out/);
});

test("mixed batch: each job ends its own way, and one failure does not take down the others", async () => {
  mockFetch({
    "/batches": resposta(202, {
      batch_id: "b1",
      total_records: 3,
      jobs: [
        { job_id: "j1", record_number: "1" },
        { job_id: "j2", record_number: "2" },
        { job_id: "j3", record_number: "3" },
      ],
    }),
    "/jobs/j1/status": resposta(200, { status: "done", result: { prontuario: "1" } }),
    "/jobs/j2/status": resposta(200, { status: "partial", result: { prontuario: "2" }, raw: {} }),
    "/jobs/j3/status": resposta(200, { status: "failed", job_id: "j3", error: "boom", attempts: 2 }),
  });

  const resultados = await submitAndPollBatch("[]");

  assert.equal(resultados.length, 3);
  assert.equal(resultados[0].prontuario, "1");
  assert.equal(resultados[0]._parcial, undefined);
  assert.equal(resultados[1].prontuario, "2");
  assert.equal(resultados[1]._parcial, true);
  assert.equal(resultados[2].error, true);
  assert.match(resultados[2].message, /boom/);
});

test("deleteAudit: sends DELETE for the audit and accepts the 204", async () => {
  let metodo;
  const chamadas = mockFetch({
    "/api/audits/7": (url, opts) => {
      metodo = opts.method;
      return resposta(204, null);
    },
  });
  await deleteAudit(7);
  assert.equal(metodo, "DELETE");
  assert.equal(chamadas.length, 1);
});

test("deleteAudit: 403 becomes an ApiError with the status and the server message", async () => {
  mockFetch({ "/api/audits/7": resposta(403, { error: "Forbidden" }) });
  await assert.rejects(deleteAudit(7), (err) => err.status === 403 && /Forbidden/.test(err.message));
});

test("approveAudit and revokeAuditApproval: POST and DELETE on the same approval route", async () => {
  const metodos = [];
  mockFetch({
    "/api/audits/7/approve": (url, opts) => {
      metodos.push(opts.method);
      return resposta(204, null);
    },
  });
  await approveAudit(7);
  await revokeAuditApproval(7);
  assert.deepEqual(metodos, ["POST", "DELETE"]);
});

test("restoreAudit and fetchDeletedAudits: restores by POST and lists the deleted ones with ?deleted=1", async () => {
  const chamadas = mockFetch({
    "/api/audits/7/restore": resposta(204, null),
    "/api/audits?deleted=1": resposta(200, { audits: [{ id: 7 }], total: 1 }),
  });
  await restoreAudit(7);
  const { audits } = await fetchDeletedAudits();
  assert.equal(audits[0].id, 7);
  assert.equal(chamadas.length, 2);
});
