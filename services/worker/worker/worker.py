"""Consumes `fila:prontuarios`, audits each patient record and publishes the result.

MAX_ATTEMPTS = 2: one retry, only for infrastructure failures (the subprocess crashed or timed
out). An AI failure does NOT retry the job — it becomes a partial result instead, since the AI
client (llm_client) already retries 3 times per call on its own.

The Worker holds no database: it sets the `resultado:*` keys the polling routes read, and pushes
the finished job onto `fila:resultados`, where the Producer's results consumer persists it (F2.5).
"""
import json
import os
import subprocess
import sys
import time

import redis

r = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=6379,
    decode_responses=True,
)

QUEUE_KEY = "fila:prontuarios"
DLQ_KEY = "fila:prontuarios:falhas"
RESULT_KEY_PREFIX = "resultado:"
RESULTS_QUEUE_KEY = "fila:resultados"
MAX_ATTEMPTS = int(os.getenv("WORKER_MAX_ATTEMPTS", "2"))
SUBPROCESS_TIMEOUT = int(os.getenv("WORKER_SUBPROCESS_TIMEOUT", "3600"))


def process_patient_record(job: dict) -> dict:
    """
    Calls data_extract/main.py as a subprocess, with cwd set to /app (this file's own directory)
    so the module resolves the same way in and out of Docker, passing the raw records via stdin
    (JSON array) and reading the audited result from stdout. The contract returns a list; since
    the job carries a single patient's records, this takes that list's one and only item.
    """
    records = job["records"]
    model_name = job.get("model_name")

    env = os.environ.copy()
    if model_name:
        env["LLM_MODEL"] = model_name
    if job.get("seed") is not None:
        env["LLM_SEED"] = str(job["seed"])

    proc = subprocess.run(
        ["python", "-m", "data_extract.main"],
        input=json.dumps(records),
        capture_output=True,
        text=True,
        cwd=os.path.dirname(__file__),
        env=env,
        timeout=SUBPROCESS_TIMEOUT,
    )

    if proc.returncode != 0:
        raise RuntimeError(f"data_extract failed (code {proc.returncode}): {proc.stderr.strip()}")

    if proc.stderr:
        sys.stderr.write(proc.stderr)

    try:
        output = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"data_extract returned invalid JSON: {e}\nstdout: {proc.stdout[:500]}") from e

    if not output:
        raise RuntimeError("data_extract returned an empty result")

    result = output[0]

    audit_data = result.get("audit_data", {})
    if audit_data.get("ia_incompleta"):
        print(f"[PARTIAL] patient record {job.get('record_number')}: {audit_data.get('observacao_ia')}")

    return result


def save_result(job: dict, result: dict):
    """Sets the `resultado:*` keys the polling routes read, and queues the result for the
    Producer's results consumer to persist in `audit_results`."""
    patient_key = f"{RESULT_KEY_PREFIX}{job['record_number']}"
    job_key = f"{RESULT_KEY_PREFIX}{job['job_id']}"

    data = json.dumps(result)
    r.set(patient_key, data)
    r.set(job_key, data)

    r.lpush(RESULTS_QUEUE_KEY, json.dumps({
        "batch_id": job.get("batch_id", "unknown"),
        "job_id": job.get("job_id", "unknown"),
        "record_number": job.get("record_number", "unknown"),
        "record_number_display": job.get("record_number_display", job.get("record_number", "")),
        "encounter": job.get("encounter", ""),
        "result": result,
    }))


def main():
    """Main loop: pop a job, audit it, save the result; after MAX_ATTEMPTS, push it to the DLQ
    and still set its result key so a client polling the job never waits forever."""
    print("Worker started, waiting for jobs...")
    while True:
        try:
            item = r.brpop(QUEUE_KEY, timeout=5)
        except redis.exceptions.TimeoutError:
            continue
        except redis.exceptions.ConnectionError as e:
            print(f"[REDIS CONNECTION ERROR] {e} — retrying in 2s")
            time.sleep(2)
            continue

        if item is None:
            continue

        _, raw = item
        job = json.loads(raw)

        try:
            result = process_patient_record(job)
            save_result(job, result)
            print(f"[OK] patient record {job['record_number']}")

        except Exception as e:
            job["attempts"] = job.get("attempts", 0) + 1
            error_msg = str(e)
            if isinstance(e, subprocess.TimeoutExpired) or isinstance(e, subprocess.CalledProcessError):
                if e.stderr:
                    stderr = e.stderr.decode(errors="replace") if isinstance(e.stderr, bytes) else e.stderr
                    error_msg += f"\nStderr: {stderr}"

            print(f"[ERROR] patient record {job.get('record_number')}: {error_msg} (attempt {job['attempts']})")

            if job["attempts"] < MAX_ATTEMPTS:
                time.sleep(1)
                r.lpush(QUEUE_KEY, json.dumps(job))
            else:
                job["final_error"] = str(e)
                r.lpush(DLQ_KEY, json.dumps(job))
                r.set(
                    f"{RESULT_KEY_PREFIX}{job['job_id']}",
                    json.dumps({"_job_failed": True, "error": error_msg, "attempts": job["attempts"]}),
                )


if __name__ == "__main__":
    main()
