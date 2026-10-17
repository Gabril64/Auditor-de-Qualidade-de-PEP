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


def test_retries_an_environment_failure_until_success(monkeypatch):
    fake = _fake([("timeout", {}, "t"), ("http_error", {}, "h"), ("ok", {"hda": "x"}, None)])
    monkeypatch.setattr(llm_client, "_single_attempt", fake)
    r = llm_client.query_ai_fields("texto", ["hda"], "MEDICINA - anamnese")
    assert r["status"] == "ok" and r["attempts"] == 3 and r["fields"] == {"hda": "x"}


def test_does_not_retry_a_format_failure(monkeypatch):
    """Under greedy decoding the same payload gives the same answer, so a model that answered
    without the requested keys would answer the same way again: insisting only burns time."""
    fake = _fake([("campos_ausentes", {"outro": "x"}, "chaves ausentes"), ("ok", {"hda": "x"}, None)])
    monkeypatch.setattr(llm_client, "_single_attempt", fake)
    r = llm_client.query_ai_fields("texto", ["hda"], "x")
    assert r["status"] == "campos_ausentes" and r["attempts"] == 1 and len(fake.calls) == 1


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
    # An answer that is not JSON is deterministic, so it is reported after a single attempt.
    assert r["status"] == "invalid_json" and r["attempts"] == 1


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


def test_merge_keeps_the_ai_signature_of_a_null_answer():
    """The bug behind the evaluation's uneven denominators: the section starts as a plain
    "Não registrado", and the merge dropped "Não registrado (IA: null)", so a model that answered
    null looked like a model that was never asked."""
    from data_extract.core.auditor import merge_section

    section = {"af": "Não registrado", "ap_app": "Não registrado"}
    merge_section(section, {"af": "Não registrado (IA: null)", "ap_app": "Não registrado (IA_NAO_EXECUTADA: timeout)"})
    assert section == {"af": "Não registrado (IA: null)", "ap_app": "Não registrado (IA_NAO_EXECUTADA: timeout)"}


def test_merge_never_changes_the_verdict_when_adding_a_signature():
    """Only provenance is added. "Não registrado" must not become "Não se aplica", which would
    take the field out of the conformity total."""
    from data_extract.core.auditor import merge_section

    section = {"uso_opme": "Não registrado"}
    merge_section(section, {"uso_opme": "Não se aplica (IA: null)"})
    assert section["uso_opme"] == "Não registrado"


def test_merge_does_not_overwrite_a_signature_already_recorded():
    from data_extract.core.auditor import merge_section

    section = {"af": "Não registrado (IA: null)"}
    merge_section(section, {"af": "Não registrado (IA_NAO_EXECUTADA: timeout)"})
    assert section["af"] == "Não registrado (IA: null)"


def test_merge_still_prefers_conforme():
    from data_extract.core.auditor import merge_section

    section = {"af": "Não registrado (IA: null)"}
    merge_section(section, {"af": "conforme (IA: mãe hipertensa)"})
    assert section["af"] == "conforme (IA: mãe hipertensa)"


def test_a_renamed_key_is_counted_in_the_signature(monkeypatch):
    """The leniency is auditable: every reconciled key is recorded, so the evaluation can report
    how closely each model followed the requested format."""
    fake = _fake([("campos_ausentes", {"diagnóstico_internacao": "fratura"}, "chaves ausentes")])
    monkeypatch.setattr(llm_client, "_single_attempt", fake)
    meta, target = _new_ai_meta(), {}
    call_ai_and_apply(target, ["diagnostico_internacao"], "texto", "x", "secao_a", meta)
    assert meta["chaves_normalizadas"] == [
        {"campo": "secao_a.diagnostico_internacao", "chave_recebida": "diagnóstico_internacao"}
    ]
    assert meta["campos_ok"] == ["secao_a.diagnostico_internacao"], "it counts as answered, not failed"
    assert meta["campos_erro"] == []
    assert target["diagnostico_internacao"] == "conforme (IA: fratura)"


def test_a_clean_answer_records_no_normalisation(monkeypatch):
    fake = _fake([("ok", {"diagnostico_internacao": "fratura"}, None)])
    monkeypatch.setattr(llm_client, "_single_attempt", fake)
    meta = _new_ai_meta()
    call_ai_and_apply({}, ["diagnostico_internacao"], "texto", "x", "secao_a", meta)
    assert meta["chaves_normalizadas"] == []


def test_accented_key_counts_as_the_requested_field(monkeypatch):
    """The real case: phi-4-mini-instruct answered `diagnóstico_internacao` with the right content
    for the requested `diagnostico_internacao`. Spelling is not audit quality."""
    def handler(body):
        answer = {"diagnóstico_internacao": "Hipótese diagnóstica: fratura transtrocantérica"}
        return 200, {"choices": [{"message": {"content": json.dumps(answer, ensure_ascii=False)}}]}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    r = llm_client.query_ai_fields("texto", ["diagnostico_internacao"], "x")
    srv.shutdown()
    assert r["status"] == "ok"
    assert r["fields"]["diagnostico_internacao"].startswith("Hipótese diagnóstica")


def test_an_exact_answer_is_never_overwritten_by_a_variant(monkeypatch):
    def handler(body):
        answer = {"diagnostico_internacao": "certo", "diagnóstico_internacao": "variante"}
        return 200, {"choices": [{"message": {"content": json.dumps(answer, ensure_ascii=False)}}]}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    r = llm_client.query_ai_fields("texto", ["diagnostico_internacao"], "x")
    srv.shutdown()
    assert r["fields"]["diagnostico_internacao"] == "certo"


def test_a_key_for_another_field_is_still_a_missing_field(monkeypatch):
    """Normalisation forgives spelling, not a different answer: the model has to answer what was
    asked, otherwise `campos_ausentes` still reports it."""
    def handler(body):
        return 200, {"choices": [{"message": {"content": json.dumps({"outro_campo": "x"})}}]}

    srv = _server(handler)
    monkeypatch.setattr(llm_client, "LMSTUDIO_URL", f"http://127.0.0.1:{srv.server_port}/")
    r = llm_client.query_ai_fields("texto", ["diagnostico_internacao"], "x")
    srv.shutdown()
    assert r["status"] == "campos_ausentes" and "diagnostico_internacao" in r["error"]


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
