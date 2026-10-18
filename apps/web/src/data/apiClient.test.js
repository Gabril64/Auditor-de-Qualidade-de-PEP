// Polling de jobs do apiClient. Roda com:  npm test   (Node >= 22; sem dependência nova)
//
// O ponto que estes testes protegem: `partial` e `failed` são desfechos normais do servidor, e o front
// precisa reagir a eles na hora. Antes, só `done` encerrava o polling; o resto esperava o timeout de 5 min.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { deleteAudit, pollJobStatus, submitAndPollBatch } from "./apiClient.js";

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

test("done: devolve o resultado e não marca como parcial", async () => {
  mockFetch({ "/jobs/j1/status": resposta(200, { status: "done", result: { prontuario: "1" } }) });
  const r = await pollJobStatus("j1", RAPIDO);
  assert.deepEqual(r, { prontuario: "1" });
});

test("processing -> done: continua consultando até terminar", async () => {
  let n = 0;
  const chamadas = mockFetch({
    "/jobs/j1/status": () =>
      ++n < 3 ? resposta(202, { status: "processing", job_id: "j1" }) : resposta(200, { status: "done", result: { ok: 1 } }),
  });
  assert.deepEqual(await pollJobStatus("j1", RAPIDO), { ok: 1 });
  assert.equal(chamadas.length, 3);
});

test("partial: entrega o resultado na primeira consulta, com o aviso da IA", async () => {
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

test("partial sem observação da IA: o aviso vem nulo, sem quebrar", async () => {
  mockFetch({ "/jobs/j1/status": resposta(200, { status: "partial", result: { prontuario: "1" }, raw: {} }) });
  const r = await pollJobStatus("j1", RAPIDO);
  assert.equal(r._parcial, true);
  assert.equal(r._aviso_ia, null);
});

test("failed: rejeita na hora com o motivo do servidor", async () => {
  const chamadas = mockFetch({
    "/jobs/j1/status": resposta(200, { status: "failed", job_id: "j1", error: "boom", attempts: 2 }),
  });
  await assert.rejects(pollJobStatus("j1", RAPIDO), /O processamento falhou: boom/);
  assert.equal(chamadas.length, 1, "não pode esperar o timeout");
});

test("failed sem motivo: mensagem genérica, sem 'undefined'", async () => {
  mockFetch({ "/jobs/j1/status": resposta(200, { status: "failed", job_id: "j1" }) });
  await assert.rejects(pollJobStatus("j1", RAPIDO), (err) => {
    assert.match(err.message, /falhou/);
    assert.doesNotMatch(err.message, /undefined/);
    return true;
  });
});

test("erro HTTP do servidor: rejeita com a mensagem dele em vez de consultar até o timeout", async () => {
  const chamadas = mockFetch({ "/jobs/j1/status": resposta(500, { error: "Erro interno" }) });
  await assert.rejects(pollJobStatus("j1", RAPIDO), /Erro interno/);
  assert.equal(chamadas.length, 1);
});

test("job que nunca termina: estoura o timeout", async () => {
  mockFetch({ "/jobs/j1/status": resposta(202, { status: "processing" }) });
  await assert.rejects(pollJobStatus("j1", { intervalMs: 2, timeoutMs: 30 }), /timed out/);
});

test("lote misto: cada job termina do seu jeito, e a falha de um não derruba os outros", async () => {
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

test("deleteAudit: manda DELETE para a auditoria e aceita o 204", async () => {
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

test("deleteAudit: 403 vira ApiError com o status e a mensagem do servidor", async () => {
  mockFetch({ "/api/audits/7": resposta(403, { error: "Forbidden" }) });
  await assert.rejects(deleteAudit(7), (err) => err.status === 403 && /Forbidden/.test(err.message));
});
