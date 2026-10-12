/**
 * API Client — centralized HTTP communication with the backend.
 *
 * Handles batch submission, job polling, and dashboard data fetching.
 */

import { ApiError, apiFetch } from "./session.js";

/**
 * Submit a batch of raw medical records to be audited.
 * @param {string} rawText - Raw text payload (JSON records, comma-separated)
 * @returns {Promise<{batch_id: string, total_records: number, jobs: Array<{record_number: string, job_id: string}>}>}
 */
export async function submitBatch(rawText) {
  const res = await apiFetch("/batches", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawText,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

/**
 * Poll a specific job until it's done or times out.
 * @param {string} jobId - The job ID to poll
 * @param {object} opts - Options
 * @param {number} opts.intervalMs - Polling interval in ms (default: 2000)
 * @param {number} opts.timeoutMs - Max wait time in ms (default: 300000 = 5min)
 * @param {function} opts.onPoll - Callback on each poll attempt
 * @returns {Promise<object>} The transformed audit result
 */
export async function pollJobStatus(jobId, opts = {}) {
  const {
    intervalMs = 2000,
    timeoutMs = 300000,
    onPoll = null,
  } = opts;

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await apiFetch(`/jobs/${jobId}/status`);
    const data = await res.json();

    // Erro do servidor: falha na hora, em vez de repetir a consulta até o timeout.
    if (!res.ok) {
      throw new Error(data.error || `Erro ${res.status} ao consultar o job ${jobId}`);
    }

    if (onPoll) onPoll(data);

    if (data.status === "done") {
      return data.result;
    }

    // Parcial: a IA falhou em alguns campos, mas o resultado existe. Entrega com o aviso, em vez de esperar
    // até o timeout — é o desfecho normal quando o servidor de IA erra ou fica fora do ar por um instante.
    if (data.status === "partial") {
      return { ...data.result, _parcial: true, _aviso_ia: data.raw?.audit_data?.observacao_ia ?? null };
    }

    // O Worker esgotou as tentativas: falha com o motivo, sem esperar o timeout.
    if (data.status === "failed") {
      throw new Error(data.error ? `O processamento falhou: ${data.error}` : "O processamento do prontuário falhou");
    }

    // Wait before next poll
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Job ${jobId} timed out after ${timeoutMs / 1000}s`);
}

/**
 * Submit a batch and poll all jobs until complete.
 * Returns results in the order they complete.
 *
 * @param {string} rawText - Raw text payload
 * @param {object} opts - Options
 * @param {function} opts.onJobStarted - Called when batch is accepted: (batchInfo) => void
 * @param {function} opts.onJobComplete - Called when a single job completes: (result, index, total) => void
 * @param {function} opts.onProgress - Called on each poll: (completedCount, total) => void
 * @returns {Promise<Array<object>>} Array of transformed audit results
 */
export async function submitAndPollBatch(rawText, opts = {}) {
  const { onJobStarted, onJobComplete, onProgress } = opts;

  // 1. Submit the batch
  const batchInfo = await submitBatch(rawText);
  if (onJobStarted) onJobStarted(batchInfo);

  const jobs = batchInfo.jobs || [];
  const total = jobs.length;
  const results = [];
  let completed = 0;

  // 2. Poll all jobs in parallel
  const promises = jobs.map(async (job, index) => {
    const result = await pollJobStatus(job.job_id, {
      onPoll: () => {
        if (onProgress) onProgress(completed, total);
      },
    });

    completed++;
    if (onJobComplete) onJobComplete(result, index, total);
    if (onProgress) onProgress(completed, total);

    return { ...result, _jobId: job.job_id, _recordNumber: job.record_number };
  });

  const settled = await Promise.allSettled(promises);

  for (const s of settled) {
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      console.error("Job failed:", s.reason);
      results.push({
        error: true,
        message: s.reason?.message || "Erro desconhecido no processamento",
      });
    }
  }

  return results;
}

/**
 * Fetch all audit results from the database (for Dashboard).
 * @returns {Promise<{audits: Array, total: number}>}
 */
export async function fetchAllAudits() {
  const res = await apiFetch("/api/audits");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch aggregated dashboard statistics.
 * @returns {Promise<{total_audits: number, avg_conformity: number, min_conformity: object, max_conformity: object}>}
 */
export async function fetchDashboardStats() {
  const res = await apiFetch("/api/dashboard/stats");
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch a specific audit by database ID.
 * @param {number} id - Audit ID
 * @returns {Promise<object>}
 */
export async function fetchAuditById(id) {
  const res = await apiFetch(`/api/audits/${id}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Save the auditor's changes to an audit. The original the system produced is never touched.
 * @param {number} id - Audit ID
 * @param {string|null} seenVersion - The `updated_at` the detail screen was showing
 * @param {Array<{section: string, record_type: string|null, field: string, status: string, comment?: string}>} changes
 * @returns {Promise<{updated_at: string}>} The new version
 * @throws {ApiError} status 409 when someone else saved first
 */
export async function saveAuditRevision(id, seenVersion, changes) {
  const res = await apiFetch(`/api/audits/${id}/revision`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updated_at: seenVersion, changes }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(err.error || `HTTP ${res.status}`, { status: res.status });
  }

  return res.json();
}
