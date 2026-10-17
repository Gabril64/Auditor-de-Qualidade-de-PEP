import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from data_extract.core import auditor, llm_client
from data_extract.core.auditor import _new_ai_meta, calculate_conformity, call_ai_and_apply, finalize_ai_meta


def _fake(responses):
    """Replaces _single_attempt with a sequence of (status, fields, error)."""
    seq = list(responses)
    calls = []

    def fn(payload, fields):
        calls.append(fields)
        return seq.pop(0)

    fn.calls = calls
    return fn


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(llm_client, "AI_RETRY_DELAY_SECONDS", 0)


def test_retry_until_success(monkeypatch):
    fake = _fake([("timeout", {}, "t"), ("invalid_json", {}, "j"), ("ok", {"hda": "x"}, None)])
    monkeypatch.setattr(llm_client, "_single_attempt", fake)
    r = llm_client.query_ai_fields("texto", ["hda"], "MEDICINA - anamnese")
    assert r["status"] == "ok" and r["attempts"] == 3 and r["fields"] == {"hda": "x"}


def test_gives_up_after_three_attempts(monkeypatch):
    fake = _fake([("timeout", {}, "t")] * 3)
    monkeypatch.setattr(llm_client, "_single_attempt", fake)
    r = llm_client.query_ai_fields("texto", ["hda"], "x")
    assert r["status"] == "timeout" and r["attempts"] == 3 and len(fake.calls) == 3


def test_empty_text_does_not_call_ai(monkeypatch):
    monkeypatch.setattr(llm_client, "_single_attempt", _fake([]))
    assert llm_client.query_ai_fields("  ", ["hda"], "x")["attempts"] == 0


def test_signature_all_outcomes(monkeypatch):
    fields = {"hda": "paciente iniciou quadro", "af": None, "cd": "não conforme (incompleto)"}
    monkeypatch.setattr(llm_client, "_single_attempt", _fake([("ok", fields, None)]))
    meta, target = _new_ai_meta(), {}
    call_ai_and_apply(target, ["hda", "af", "cd"], "texto", "x", "secao_b_anamnese", meta)
    assert target["hda"] == "conforme (IA: paciente iniciou quadro)"
    assert target["af"] == "Não registrado (IA: null)"
    assert target["cd"].startswith("não conforme (IA:")
    assert meta["campos_ok"] == ["secao_b_anamnese.hda", "secao_b_anamnese.cd"]
    assert meta["campos_null"] == ["secao_b_anamnese.af"]
    assert meta["campos_erro"] == []


def test_failure_marks_partial(monkeypatch):
    monkeypatch.setattr(llm_client, "_single_attempt", _fake([("timeout", {}, "t")] * 3))
    meta, target = _new_ai_meta(), {}
    call_ai_and_apply(target, ["hda"], "texto", "x", "secao_b_anamnese", meta)
    assert target["hda"] == "Não registrado (IA_NAO_EXECUTADA: timeout)"
    data = {}
    finalize_ai_meta(data, meta)
    assert data["ia_incompleta"] is True
    assert "A IA não rodou para todos os campos" in data["observacao_ia"]
    m = data["_ia_meta"]
    assert len(m["campos_enviados"]) == len(m["campos_ok"]) + len(m["campos_null"]) + len(m["campos_erro"])


def test_missing_key_is_error_for_that_field_only(monkeypatch):
    monkeypatch.setattr(llm_client, "_single_attempt", _fake([("campos_ausentes", {"hda": "x"}, "e")] * 3))
    meta, target = _new_ai_meta(), {}
    call_ai_and_apply(target, ["hda", "af"], "texto", "x", "s", meta)
    assert target["hda"].startswith("conforme")
    assert "IA_NAO_EXECUTADA: campos_ausentes" in target["af"]


def test_conformity_treats_signed_not_registered_as_invalid():
    data = {"secao_b_anamnese": {"hda": "Não registrado (IA: null)", "hd_cid": "Não registrado (IA_NAO_EXECUTADA: timeout)", "ap_app": "conforme"}}
    out = calculate_conformity(data)
    assert out["conformity_b_anamnese"]["valid"] == 1


def test_merge_section_replaces_signed_not_registered():
    cur = {"hda": "Não registrado (IA_NAO_EXECUTADA: timeout)"}
    auditor.merge_section(cur, {"hda": "conforme (IA: x)"})
    assert cur["hda"] == "conforme (IA: x)"


def test_real_http_timeout_and_invalid_json(monkeypatch):
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            body = json.dumps({"choices": [{"message": {"content": "isso não é json"}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    r = llm_client.query_ai_fields("texto", ["hda"], "x")
    srv.shutdown()
    assert r["status"] == "invalid_json" and r["attempts"] == 3


def _server(handler_fn):
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            code, resp = handler_fn(body)
            raw = json.dumps(resp).encode()
            self.send_response(code)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def test_request_is_chat_completions_shaped(monkeypatch):
    """The client talks to the OpenAI-compatible route, the only one that carries a seed."""
    seen = []

    def handler(body):
        seen.append(body)
        return 200, {"choices": [{"message": {"content": '{"hda": "x"}'}}]}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    r = llm_client.query_ai_fields("texto do prontuário", ["hda"], "Anamnese")
    srv.shutdown()
    body = seen[0]
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "- hda:" in body["messages"][0]["content"], "the field rules go in the system turn"
    assert "texto do prontuário" in body["messages"][1]["content"], "the record goes in the user turn"
    assert r["status"] == "ok"


def test_decoding_and_seed_are_pinned_in_every_request(monkeypatch):
    """Greedy decoding is what makes a run reproducible; the seed documents it. Both travel in
    every payload, and both come back in the outcome so the audit can record them."""
    seen = []

    def handler(body):
        seen.append({k: body.get(k) for k in ("seed", "temperature", "top_k", "top_p")})
        return 200, {"choices": [{"message": {"content": '{"hda": "x"}'}}]}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    monkeypatch.setattr(llm_client, "AI_SEED", 42)
    r = llm_client.query_ai_fields("texto", ["hda"], "x")
    srv.shutdown()
    assert seen == [{"seed": 42, "temperature": 0.0, "top_k": 1, "top_p": 1.0}]
    assert r["sampling"] == {"seed": 42, "temperature": 0.0, "top_k": 1, "top_p": 1.0}


def test_without_a_seed_configured_the_key_is_absent(monkeypatch):
    """A missing seed is left out of the payload, never sent as null."""
    seen = []

    def handler(body):
        seen.append("seed" in body)
        return 200, {"choices": [{"message": {"content": '{"hda": "x"}'}}]}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    monkeypatch.setattr(llm_client, "AI_SEED", None)
    r = llm_client.query_ai_fields("texto", ["hda"], "x")
    srv.shutdown()
    assert seen == [False] and r["sampling"]["seed"] is None


def test_a_rejected_request_is_reported_not_retried_silently(monkeypatch):
    calls = []

    def handler(body):
        calls.append(1)
        return 400, {"error": "Unrecognized key(s) in object: 'foo'"}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    monkeypatch.setattr(llm_client, "AI_MAX_ATTEMPTS", 2)
    monkeypatch.setattr(llm_client, "AI_RETRY_DELAY_SECONDS", 0)
    r = llm_client.query_ai_fields("texto", ["hda"], "x")
    srv.shutdown()
    assert r["status"] == "http_error" and "400" in r["error"]
    assert len(calls) == 2, "each attempt is one request: no hidden extra call"


def test_hd_cid_does_not_match_flacido():
    from data_extract.core.auditor import has_diagnostic_hypothesis as t
    assert not t("abdome flácido, indolor, paciente hidratado, sem acidente")
    assert t("Hipótese diagnóstica: pneumonia") and t("CID J18.9") and t("#HD: ICC") and t("hd: icc")
    assert t("diagnóstico (CID-10 S72.1)")
