"""Snapshot of the full audit (rules + fake AI) over every record in the frozen dataset (tests/fixtures).

This is the test that protects the refactor: `run_audit`'s output has to stay IDENTICAL
through every phase. If a test here fails after a refactor, the refactor changed behavior —
unless the change was decided and approved (then record it with UPDATE_SNAPSHOTS=1 in its
own commit).

ALL runs every record number in the frozen dataset. SUBSET has surgery, resolved placeholders
and several failures, and is cheaper to run against the invalid-JSON and missing-keys scenarios.
"""
import pytest

from data_extract.main import run_audit
from tests.conftest import normalize_audit, records_of

ALL = None
SUBSET = ("94.098.934", "62.407.871", "60.616.859")

CASES = [
    ("ok_mix", ALL),
    ("all_null", ALL),
    ("timeout", ALL),
    ("invalid_json", SUBSET),
    ("missing_keys", SUBSET),
]


@pytest.mark.parametrize("scenario,record_numbers", CASES, ids=[c[0] for c in CASES])
def test_audit_output_is_frozen(scenario, record_numbers, all_records, audit_env, snapshot):
    audit_env(scenario)
    records = all_records if record_numbers is None else records_of(all_records, *record_numbers)
    result = normalize_audit(run_audit(records))
    snapshot(f"audit_{scenario}", result)


def test_audit_is_deterministic(all_records, audit_env):
    """Two equal runs produce equal output (no dependency on order, the clock or randomness)."""
    audit_env("ok_mix")
    a = normalize_audit(run_audit(all_records))
    b = normalize_audit(run_audit(all_records))
    assert a == b


def test_one_result_per_patient_record_in_input_order(all_records, audit_env):
    audit_env("all_null")
    result = run_audit(all_records)
    order = list(dict.fromkeys(r["Prontuário"] for r in all_records))
    assert [r["record_id"] for r in result] == order
    assert len(result) == len(order)
