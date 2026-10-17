"""Characterization test infrastructure (refactor Phase 0).

Goal: freeze the backend's CURRENT behavior. No test here judges whether the behavior is
correct — only that it does not change by accident during the refactor.
"""
import hashlib
import json
import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

FIXTURES = Path(__file__).parent / "fixtures"
SNAPSHOTS = Path(__file__).parent / "snapshots"


@pytest.fixture(scope="session")
def all_records():
    """Frozen copy of prontuarios.json (115 records, 16 prontuários)."""
    with open(FIXTURES / "prontuarios_sample.json", encoding="utf-8") as f:
        return json.load(f)


def records_of(all_records, *record_numbers):
    return [r for r in all_records if r["Prontuário"] in record_numbers]


def _diff(expected, actual, path="$", out=None, limit=8):
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    if type(expected) is not type(actual):
        out.append(f"{path}: type {type(expected).__name__} != {type(actual).__name__}")
    elif isinstance(expected, dict):
        for key in sorted(set(expected) | set(actual)):
            if key not in expected:
                out.append(f"{path}.{key}: appeared (expected absent): {str(actual[key])[:80]!r}")
            elif key not in actual:
                out.append(f"{path}.{key}: disappeared (expected {str(expected[key])[:80]!r})")
            else:
                _diff(expected[key], actual[key], f"{path}.{key}", out, limit)
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            out.append(f"{path}: size {len(expected)} != {len(actual)}")
        for i, (x, y) in enumerate(zip(expected, actual, strict=False)):
            _diff(x, y, f"{path}[{i}]", out, limit)
    elif expected != actual:
        out.append(f"{path}: expected {str(expected)[:80]!r} but got {str(actual)[:80]!r}")
    return out


@pytest.fixture
def snapshot():
    """snapshot("name", data): compares against tests/snapshots/name.json.
    To record it on purpose (e.g. an approved business-rule fix): UPDATE_SNAPSHOTS=1 pytest."""

    def check(name, data):
        """Round-trips `data` through JSON first, so the comparison matches exactly what a
        real snapshot write would produce."""
        path = SNAPSHOTS / f"{name}.json"
        data = json.loads(json.dumps(data, ensure_ascii=False))
        if os.environ.get("UPDATE_SNAPSHOTS") == "1":
            path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
            return
        if not path.exists():
            pytest.fail(f"Snapshot {path.name} does not exist. Generate it with UPDATE_SNAPSHOTS=1 pytest.")
        expected = json.loads(path.read_text(encoding="utf-8"))
        if expected != data:
            diffs = "\n  ".join(_diff(expected, data))
            pytest.fail(f"Output changed relative to snapshot {path.name}:\n  {diffs}")

    return check


def _bucket(field, text):
    return int(hashlib.sha1(f"{field}|{text}".encode("utf-8")).hexdigest(), 16) % 10


def scenario_ok_mix(payload, fields):
    """Deterministic mix of: snippet, null, 'não conforme (incompleto)' and a non-string value."""
    text = payload["input"].split("TEXTO DO REGISTRO:\n", 1)[-1]
    out = {}
    for field in fields:
        bucket = _bucket(field, text)
        if bucket < 5:
            out[field] = f"trecho[{field}]: {text[:40]}"
        elif bucket < 7:
            out[field] = None
        elif bucket < 8:
            out[field] = "não conforme (incompleto)"
        else:
            out[field] = True
    return "ok", out, None


def scenario_all_null(payload, fields):
    return "ok", {field: None for field in fields}, None


def scenario_timeout(payload, fields):
    return "timeout", {}, "timeout simulado"


def scenario_invalid_json(payload, fields):
    return "invalid_json", {}, "json inválido simulado"


def scenario_missing_keys(payload, fields):
    half = fields[: len(fields) // 2]
    return "campos_ausentes", {field: f"trecho[{field}]" for field in half}, "chaves ausentes simuladas"


SCENARIOS = {
    "ok_mix": scenario_ok_mix,
    "all_null": scenario_all_null,
    "timeout": scenario_timeout,
    "invalid_json": scenario_invalid_json,
    "missing_keys": scenario_missing_keys,
}


@pytest.fixture
def audit_env(monkeypatch, tmp_path):
    """Isolates the auditor from the environment: fixed configuration, no sleep, no writes to the
    repository. The auditor writes metadataProntuarios.txt next to the package, so `auditor.__file__`
    is redirected into `tmp_path` to keep that write out of the repo."""
    from data_extract.core import auditor, llm_client

    monkeypatch.setattr(llm_client, "AI_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(llm_client, "AI_RETRY_DELAY_SECONDS", 0)
    monkeypatch.setattr(auditor, "MODEL_NAME", "modelo-de-teste")
    monkeypatch.setattr(auditor, "SEED_REQUESTED", None)
    (tmp_path / "core").mkdir()
    monkeypatch.setattr(auditor, "__file__", str(tmp_path / "core" / "auditor.py"))

    def use(scenario):
        calls = []
        fn = SCENARIOS[scenario] if isinstance(scenario, str) else scenario

        def fake(payload, fields):
            calls.append({"fields": list(fields), "input": payload["input"]})
            return fn(payload, fields)

        monkeypatch.setattr(llm_client, "_single_attempt", fake)
        return calls

    return use


def normalize_audit(results):
    """Strips what changes from run to run (the measured time)."""
    out = json.loads(json.dumps(results, ensure_ascii=False))
    for r in out:
        meta = r["audit_data"].get("_ia_meta")
        if meta:
            meta["latencia_ia_s"] = 0.0
    return out
