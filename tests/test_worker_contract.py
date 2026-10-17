"""Worker contract: Redis queue (fakeredis) + data_extract execution.

- `process_patient_record` is tested with the REAL subprocess (`python -m data_extract.main`)
  talking to a fake HTTP server in place of LM Studio: covers Worker -> auditor -> AI end to end.
- The `main()` loop is tested with `process_patient_record` swapped for a double, to cover only
  the queue.
"""
import json
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import fakeredis
import pytest

import worker.worker as worker
from tests.conftest import REPO_ROOT, records_of

QUEUE, DLQ, PREFIX, RESULTS_QUEUE = worker.QUEUE_KEY, worker.DLQ_KEY, worker.RESULT_KEY_PREFIX, worker.RESULTS_QUEUE_KEY


class _StopLoop(BaseException):
    """A BaseException on purpose: the Worker's `except Exception` does not catch it."""


class LoopBreaker:
    """Wraps FakeRedis: once the queue is empty, brpop breaks the Worker's `while True` loop."""

    def __init__(self, r):
        self._r = r

    def brpop(self, key, timeout=0):
        if self._r.llen(key) == 0:
            raise _StopLoop
        return self._r.brpop(key, timeout=1)

    def __getattr__(self, name):
        return getattr(self._r, name)


@pytest.fixture
def redis_fake(monkeypatch):
    raw = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(worker, "r", LoopBreaker(raw))
    monkeypatch.setattr(worker.time, "sleep", lambda s: None)
    return raw


def job(n=1, **extra):
    return {"job_id": f"job-{n}", "batch_id": "b", "record_number": f"{n}", "records": [{"x": 1}],
            "attempts": 0, **extra}


def run_loop():
    with pytest.raises(_StopLoop):
        worker.main()


def test_success_saves_result_under_record_and_job_keys(redis_fake, monkeypatch):
    """Saves the same result under both `resultado:<record_number>` and `resultado:<job_id>`,
    and queues it in `fila:resultados` for the Producer's results consumer to persist."""
    result = {"record_id": "1", "audit_data": {"ok": True}}
    monkeypatch.setattr(worker, "process_patient_record", lambda j: result)
    redis_fake.lpush(QUEUE, json.dumps(job(1)))
    run_loop()
    assert json.loads(redis_fake.get(f"{PREFIX}1")) == result
    assert json.loads(redis_fake.get(f"{PREFIX}job-1")) == result
    assert redis_fake.llen(QUEUE) == 0 and redis_fake.llen(DLQ) == 0
    queued = json.loads(redis_fake.lrange(RESULTS_QUEUE, 0, -1)[0])
    assert queued == {"batch_id": "b", "job_id": "job-1", "record_number": "1",
                       "record_number_display": "1", "encounter": "", "result": result}


def test_partial_result_is_saved_normally_not_sent_to_dlq(redis_fake, monkeypatch):
    partial = {"record_id": "1", "audit_data": {"ia_incompleta": True, "observacao_ia": "IA não rodou"}}
    monkeypatch.setattr(worker, "process_patient_record", lambda j: partial)
    redis_fake.lpush(QUEUE, json.dumps(job(1)))
    run_loop()
    assert json.loads(redis_fake.get(f"{PREFIX}job-1")) == partial
    assert redis_fake.llen(DLQ) == 0


def test_failing_job_is_retried_once_then_goes_to_dlq(redis_fake, monkeypatch):
    """2 runs total (1 retry). The failure is published under the job-id key, for whoever polls
    the job, but never under the record-number key — that one stays reserved for a real result.
    It is also announced in `fila:resultados` so the Producer can notify, but without the error
    text, which may carry clinical content."""
    attempts_seen = []

    def fail(j):
        attempts_seen.append(j["attempts"])
        raise RuntimeError("boom")

    monkeypatch.setattr(worker, "process_patient_record", fail)
    redis_fake.lpush(QUEUE, json.dumps(job(1)))
    run_loop()

    assert attempts_seen == [0, 1]
    assert redis_fake.llen(QUEUE) == 0 and redis_fake.llen(DLQ) == 1
    dead_job = json.loads(redis_fake.lrange(DLQ, 0, -1)[0])
    assert dead_job["attempts"] == 2 and dead_job["final_error"] == "boom"
    published_failure = json.loads(redis_fake.get(f"{PREFIX}job-1"))
    assert published_failure["_job_failed"] is True and published_failure["attempts"] == 2
    assert redis_fake.get(f"{PREFIX}1") is None
    announced = [json.loads(m) for m in redis_fake.lrange(RESULTS_QUEUE, 0, -1)]
    assert len(announced) == 1
    assert announced[0]["job_id"] == "job-1"
    assert announced[0]["result"] == {"_job_failed": True, "attempts": 2}


def test_job_that_recovers_on_second_attempt_is_saved(redis_fake, monkeypatch):
    state = {"n": 0}

    def unstable(j):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("falha transitória")
        return {"record_id": "1", "audit_data": {}}

    monkeypatch.setattr(worker, "process_patient_record", unstable)
    redis_fake.lpush(QUEUE, json.dumps(job(1)))
    run_loop()
    assert state["n"] == 2 and redis_fake.llen(DLQ) == 0
    assert redis_fake.get(f"{PREFIX}job-1") is not None


def test_jobs_are_consumed_fifo(redis_fake, monkeypatch):
    """The Producer pushes with LPUSH and the Worker pops with BRPOP, so insertion order is preserved."""
    order = []
    monkeypatch.setattr(worker, "process_patient_record", lambda j: order.append(j["job_id"]) or {"audit_data": {}})
    for n in (1, 2, 3):
        redis_fake.lpush(QUEUE, json.dumps(job(n)))
    run_loop()
    assert order == ["job-1", "job-2", "job-3"]


def test_KNOWN_BUG_malformed_message_crashes_the_worker(redis_fake, monkeypatch):
    """json.loads(raw) sits outside the try: an invalid message crashes the process (planned for F5)."""
    monkeypatch.setattr(worker, "process_patient_record", lambda j: {})
    redis_fake.lpush(QUEUE, "isto não é json")
    with pytest.raises(json.JSONDecodeError):
        worker.main()


class _Done:
    def __init__(self, returncode=0, stdout="[]", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def test_model_and_seed_are_passed_to_the_subprocess_env(monkeypatch):
    captured = {}

    def run(cmd, **kw):
        captured.update(kw)
        return _Done(stdout=json.dumps([{"record_id": "1", "audit_data": {}}]))

    monkeypatch.setattr(worker.subprocess, "run", run)
    out = worker.process_patient_record({"records": [{"a": 1}], "model_name": "phi-4", "seed": 42})
    assert out == {"record_id": "1", "audit_data": {}}
    assert captured["env"]["LLM_MODEL"] == "phi-4" and captured["env"]["LLM_SEED"] == "42"
    assert json.loads(captured["input"]) == [{"a": 1}]
    assert captured["timeout"] == worker.SUBPROCESS_TIMEOUT


@pytest.mark.parametrize("done,snippet", [
    (_Done(returncode=1, stderr="traceback"), "data_extract failed (code 1)"),
    (_Done(stdout="não é json"), "invalid JSON"),
    (_Done(stdout="[]"), "empty result"),
])
def test_subprocess_failures_raise_runtime_error(monkeypatch, done, snippet):
    monkeypatch.setattr(worker.subprocess, "run", lambda cmd, **kw: done)
    with pytest.raises(RuntimeError, match=re.escape(snippet)):
        worker.process_patient_record({"records": [{}]})


class _FakeLLM(BaseHTTPRequestHandler):
    """Stands in for LM Studio. `mode` is "null" (answers every field with null) or "error500"."""

    mode = "null"

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if type(self).mode == "error500":
            self.send_response(500)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        system_turn = next(m["content"] for m in body["messages"] if m["role"] == "system")
        fields = re.findall(r"^- (\w+):", system_turn, flags=re.M)
        payload = json.dumps({"choices": [{"message": {"content": json.dumps({f: None for f in fields})}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *a):
        pass


@pytest.fixture
def fake_llm_server(monkeypatch):
    """Starts the fake LLM and points the real subprocess at it. Restores
    data_extract/metadataProntuarios.txt afterward, since the real subprocess appends to it."""
    srv = HTTPServer(("127.0.0.1", 0), _FakeLLM)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    monkeypatch.setenv("AI_RETRY_DELAY_SECONDS", "0")
    monkeypatch.setenv("PYTHONPATH", str(REPO_ROOT))
    monkeypatch.delenv("LLM_SEED", raising=False)

    real_run = subprocess.run

    def run_in_repo_root(cmd, **kw):
        """The Worker calls "python" with cwd=worker/; here it uses the test's own interpreter
        and the repo root, so it can import data_extract without installing it."""
        return real_run([sys.executable] + list(cmd[1:]), **{**kw, "cwd": str(REPO_ROOT)})

    monkeypatch.setattr(worker.subprocess, "run", run_in_repo_root)

    metadata = REPO_ROOT / "data_extract" / "metadataProntuarios.txt"
    original = metadata.read_bytes() if metadata.exists() else None
    yield _FakeLLM
    srv.shutdown()
    _FakeLLM.mode = "null"
    if original is None:
        metadata.unlink(missing_ok=True)
    else:
        metadata.write_bytes(original)


def test_end_to_end_real_subprocess_with_fake_llm(fake_llm_server, all_records):
    fake_llm_server.mode = "null"
    records = records_of(all_records, "62.407.871")
    result = worker.process_patient_record({"records": records, "model_name": "modelo-x"})
    assert result["record_id"] == "62.407.871"
    audit = result["audit_data"]
    assert audit["ia_incompleta"] is False
    assert audit["_ia_meta"]["model"] == "modelo-x"
    assert audit["_ia_meta"]["campos_erro"] == []
    assert audit["_ia_meta"]["campos_null"], "every field sent to the AI should have come back null"


def test_end_to_end_ai_down_returns_partial_result_not_an_exception(fake_llm_server, all_records):
    fake_llm_server.mode = "error500"
    result = worker.process_patient_record({"records": records_of(all_records, "62.407.871")})
    audit = result["audit_data"]
    assert audit["ia_incompleta"] is True
    assert "A IA não rodou para todos os campos" in audit["observacao_ia"]
    assert audit["_ia_meta"]["campos_erro"]
