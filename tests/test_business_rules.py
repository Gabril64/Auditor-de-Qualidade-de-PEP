"""Business rules decided in Phase N (items 1-15 of the plan). Rule source:
evaluation/data/prompt-agente-auditor-originaal.txt (3.2, 3.4, 3.5, 3.6, 3.7 and Section D)."""
import pytest

from data_extract.core import auditor, llm_client
from data_extract.core.auditor import aggregate_evolutions, calculate_conformity
from data_extract.core.temporal import check_anamnesis_creation, check_daily_evolution
from data_extract.keywords.exame_fisico import MEDICAL_PHYSICAL_EXAM_TERMS, NURSING_PHYSICAL_EXAM_TERMS
from data_extract.utils.helpers import check_complete_physical_exam

BASE = {
    "Prontuário": "1.111.111", "Atendimento": "1", "Data De Nascimento pact": "1/1/1950",
    "Data da internação": "10/01/2025, 10:00", "Data de saída": "13/01/2025, 10:00",
    "Especialidade cirurgia": "", "UF cirurgia": "", "Unidade Funcional Internaçao": "UF",
    "Cid procedimento": "", "Procedimento cirurgico Realizado": "",
    "Data Inicio Cirurgia": "", "Data Fim Cirurgia": "", "Descrição Cirurgica": "",
}
SURGERY = {"Especialidade cirurgia": "Ortopedia", "UF cirurgia": "BLOCO", "Data Inicio Cirurgia": "11/01/2025, 08:00",
           "Data Fim Cirurgia": "11/01/2025, 10:00", "Cid procedimento": "S72.1", "Procedimento cirurgico Realizado": "Osteossíntese"}
SURGICAL_DESCRIPTION = "passo a passo da cirurgia com mais de cinquenta caracteres com certeza sim"
MEDICAL_EXAM = "estado geral bom, acv: ritmo regular, ar: mv presente, abd: flácido, ext: sem edemas"
NURSING_EXAM = ("consciente e orientada, pele corada, eupneica, pulsos presentes, abdome flácido com dieta aceita, "
                "diurese presente, deambulando, braden 15")


def rec(category, record_type, description, created_at="10/01/2025, 10:00", **extra):
    return {**BASE, "Categoria Profissional": category, "Tipo do registro": record_type,
            "Descricao do registro": description, "criacao_registro": created_at, **extra}


def audit(records):
    return auditor.audit_medical_records(records)[0]["audit_data"]


def ai_answers(field_values):
    """Fake LLM that answers `field_values[field]` (default: null) — returns the scenario for audit_env."""
    def scenario(payload, fields):
        return "ok", {field: field_values.get(field) for field in fields}, None
    return scenario


def test_item01_only_conforme_counts_as_valid():
    data = calculate_conformity({"secao_b_anamnese": {
        "hda": "não conforme (IA: x)", "hd_cid": "Incompleto (Faltam: ACV)",
        "ap_app": "Não registrado", "af": "conforme"}})
    assert data["conformity_b_anamnese"] == {"total": 7, "valid": 1, "percent": 1 / 7 * 100}


@pytest.mark.parametrize("ai_answer,reason", [
    ("não conforme: faltou o exame do abdome", "faltou o exame do abdome"),
    ("não conforme (incompleto)", "incompleto"),
    ("incompleto: sem sistemas básicos", "sem sistemas básicos"),
])
def test_item01_ai_incomplete_or_nonconforming_becomes_nao_conforme_with_reason(audit_env, ai_answer, reason):
    audit_env(ai_answers({"hda": ai_answer}))
    d = audit([rec("MEDICINA", "Anamnese", "texto")])
    assert d["secao_b_anamnese"]["hda"] == f"não conforme (IA: {reason})"


def test_item01_rule_based_exam_says_nao_conforme_not_incompleto():
    r = check_complete_physical_exam("estado geral bom", MEDICAL_PHYSICAL_EXAM_TERMS)
    assert r.startswith("não conforme (Faltam:") and "Incompleto" not in r


@pytest.mark.parametrize("creation,expected", [
    ("10/01/2025, 22:00", "conforme"),
    ("10/01/2025, 22:01", "não conforme (criada 12h01 após a internação; prazo de 12h)"),
    ("11/01/2025, 09:00", "não conforme (criada 23h após a internação; prazo de 12h)"),
    ("10/01/2025, 10:00", "conforme"),
])
def test_item02_anamnese_creation_deadline(creation, expected):
    assert check_anamnesis_creation("10/01/2025, 10:00", creation) == expected


def test_item02_applies_to_medical_and_nursing_anamnese(audit_env):
    audit_env("all_null")
    d = audit([rec("MEDICINA", "Anamnese", "x", created_at="11/01/2025, 09:00"),
               rec("ENFERMAGEM", "Anamnese", "x", created_at="10/01/2025, 20:00")])
    assert d["secao_b_anamnese"]["criacao_anamnese"].startswith("não conforme (criada 23h")
    assert d["secao_d_anamnese"]["criacao_anamnese"] == "conforme"


def test_item02_missing_dates_is_not_registered_and_never_sent_to_ai(audit_env):
    calls = audit_env("all_null")
    d = audit([rec("MEDICINA", "Anamnese", "x", created_at="")])
    assert d["secao_b_anamnese"]["criacao_anamnese"] == "Não registrado"
    assert not any("criacao_anamnese" in c["fields"] for c in calls)


ADMISSION, DISCHARGE = "15/03/2024, 14:30", "19/03/2024, 10:00"


def test_item03_daily_evolutions_are_conforme():
    assert check_daily_evolution(ADMISSION, DISCHARGE, [ADMISSION], ["16/03/2024, 14:30", "17/03/2024, 14:30", "18/03/2024, 14:30"]) == "conforme"


def test_item03_missing_day_names_the_window():
    r = check_daily_evolution(ADMISSION, DISCHARGE, [ADMISSION], ["16/03/2024, 14:30", "18/03/2024, 14:30"])
    assert r == "não conforme (sem evolução entre 17/03 14:30 e 18/03 14:30)"


def test_item03_stay_of_three_days_needs_two_evolutions_but_accepts_three():
    admission, discharge = "20/03/2025, 08:00", "23/03/2025, 08:00"
    two_evolutions = ["21/03/2025, 08:00", "22/03/2025, 08:00"]
    assert check_daily_evolution(admission, discharge, [admission], two_evolutions) == "conforme"
    assert check_daily_evolution(admission, discharge, [admission], two_evolutions + ["22/03/2025, 20:00"]) == "conforme"
    assert check_daily_evolution(admission, discharge, [admission], two_evolutions[:1]).startswith("não conforme")


def test_item03_without_first_day_anamnese_counting_starts_at_admission():
    admission, discharge = "20/03/2025, 08:00", "22/03/2025, 08:00"
    with_anamnese = check_daily_evolution(admission, discharge, [admission], ["21/03/2025, 08:00"])
    without_anamnese = check_daily_evolution(admission, discharge, [], ["21/03/2025, 08:00"])
    assert with_anamnese == "conforme"
    assert without_anamnese == "não conforme (sem evolução entre 20/03 08:00 e 21/03 08:00)"


def test_item03_late_anamnese_does_not_exempt_the_first_window():
    admission, discharge = "20/03/2025, 08:00", "22/03/2025, 08:00"
    assert check_daily_evolution(admission, discharge, ["21/03/2025, 09:00"], ["21/03/2025, 09:00"]).startswith("não conforme")


def test_item03_missing_discharge_date_is_not_registered():
    assert check_daily_evolution(ADMISSION, "", [ADMISSION], []) == "Não registrado"


def test_item03_audit_uses_medical_for_frequencia_and_nursing_for_criacao_evolucao(audit_env):
    audit_env("all_null")
    d = audit([
        rec("MEDICINA", "Anamnese", "x", created_at="10/01/2025, 10:00"),
        rec("MEDICINA", "Evolução", "a", created_at="11/01/2025, 10:00"),
        rec("MEDICINA", "Evolução", "b", created_at="12/01/2025, 10:00"),
        rec("ENFERMAGEM", "Anamnese", "x", created_at="10/01/2025, 10:00"),
        rec("ENFERMAGEM", "Evolução", "c", created_at="12/01/2025, 10:00"),
    ])
    assert d["secao_b_evolucao"]["frequencia_diaria"] == "conforme"
    assert d["secao_d_evolucao"]["criacao_evolucao"] == "não conforme (sem evolução entre 11/01 10:00 e 12/01 10:00)"


def test_item03_every_evolution_must_be_conforme_and_reason_names_the_day():
    r = aggregate_evolutions([
        ("11/01", {"exame_fisico": "conforme", "hd_cid": "conforme (IA: HD x)"}),
        ("12/01", {"exame_fisico": "não conforme (Faltam: Abdome)", "hd_cid": "conforme"}),
        ("13/01", {"exame_fisico": "não conforme (Faltam: Extremidades)", "hd_cid": "Não registrado (IA: null)"}),
    ])
    assert r["exame_fisico"] == "não conforme (Faltam: Abdome — dia 12/01, 13/01)"
    assert r["hd_cid"] == "não conforme (IA: null — dia 13/01)"


def test_item03_aggregation_keeps_ai_signature_when_all_conform():
    r = aggregate_evolutions([("11/01", {"c": "conforme (IA: trecho)"}), ("12/01", {"c": "conforme"})])
    assert r["c"] == "conforme (IA: trecho)"


def test_item03_aggregation_keeps_not_registered_when_no_evolution_has_it():
    r = aggregate_evolutions([("11/01", {"c": "Não registrado (IA: null)"}), ("12/01", {"c": "Não registrado (IA: null)"})])
    assert r["c"] == "Não registrado (IA: null)"


def test_item03_ai_failure_signature_survives_aggregation():
    r = aggregate_evolutions([("11/01", {"c": "conforme"}), ("12/01", {"c": "Não registrado (IA_NAO_EXECUTADA: timeout)"})])
    assert "IA_NAO_EXECUTADA: timeout" in r["c"] and "dia 12/01" in r["c"]


def test_item04_complete_medical_exam():
    assert check_complete_physical_exam(MEDICAL_EXAM, MEDICAL_PHYSICAL_EXAM_TERMS) == "conforme"


def test_item04_medical_needs_all_five_systems():
    r = check_complete_physical_exam("estado geral bom, acv: rcr, abd: flácido", MEDICAL_PHYSICAL_EXAM_TERMS)
    assert r == "não conforme (Faltam: Respiratório, Extremidades)"


def test_item04_whole_word_only_regular_is_not_ar():
    r = check_complete_physical_exam("regular", MEDICAL_PHYSICAL_EXAM_TERMS)
    assert "Respiratório" in r and "Geral" in r


def test_item04_anestesia_geral_is_not_the_general_exam():
    r = check_complete_physical_exam("sob anestesia geral", MEDICAL_PHYSICAL_EXAM_TERMS)
    assert "Geral" in r


def test_item04_accents_and_case_do_not_matter():
    r = check_complete_physical_exam("ESTADO GERAL; ACV rcr; ABDÔMEN flácido; EXTREMIDADES; Murmúrio Vesicular",
                                     MEDICAL_PHYSICAL_EXAM_TERMS)
    assert r == "conforme"


def test_item04_nursing_has_eight_systems_including_escalas():
    assert check_complete_physical_exam(NURSING_EXAM, NURSING_PHYSICAL_EXAM_TERMS) == "conforme"
    without_scales = NURSING_EXAM.replace("braden 15", "")
    assert check_complete_physical_exam(without_scales, NURSING_PHYSICAL_EXAM_TERMS) == "não conforme (Faltam: Escalas)"
    assert len(NURSING_PHYSICAL_EXAM_TERMS) == 8 and len(MEDICAL_PHYSICAL_EXAM_TERMS) == 5


def test_item05_sem_queixas_counts_as_queixas_registered(audit_env):
    audit_env("all_null")
    d = audit([rec("MEDICINA", "Evolução", "paciente sem queixas.")])
    assert d["secao_b_evolucao"]["procedimentos_condutas_queixas"] == "conforme"


def test_item06_curativo_is_only_evaluated_in_nursing_evolution(audit_env):
    audit_env("all_null")
    d = audit([rec("ENFERMAGEM", "Anamnese", "curativo simples tamanho exsudato necrose")])
    assert "curativo" not in d["secao_d_anamnese"]
    assert "curativo" not in d["conformity_d_anamnese"]


def test_item07_curativo_conforme_needs_type_and_the_three_details(audit_env):
    audit_env("all_null")
    d = audit([rec("ENFERMAGEM", "Evolução", "curativo simples, tamanho 3cm, exsudato seroso, sem necrose")])
    assert d["secao_d_evolucao"]["curativo"] == "conforme (Curativo simples)"


def test_item07_type_found_but_incomplete_is_nao_conforme_with_reason(audit_env):
    audit_env("all_null")
    d = audit([rec("ENFERMAGEM", "Evolução", "curativo especial com exsudato")])
    assert d["secao_d_evolucao"]["curativo"] == "não conforme (Curativo especial; faltou: tamanho, necrose — dia 10/01)"


def test_item07_type_not_identified_goes_to_ai(audit_env):
    calls = audit_env(ai_answers({"curativo": "Curativo simples"}))
    d = audit([rec("ENFERMAGEM", "Evolução", "curativo oclusivo seco")])
    assert any("curativo" in c["fields"] for c in calls)
    assert d["secao_d_evolucao"]["curativo"] == "conforme (IA: Curativo simples)"


def test_item07_ai_cannot_identify_type_is_nao_conforme(audit_env):
    audit_env("all_null")
    d = audit([rec("ENFERMAGEM", "Evolução", "curativo oclusivo seco")])
    assert d["secao_d_evolucao"]["curativo"] == "não conforme (IA: tipo de curativo não identificado — dia 10/01)"


def test_item07_no_curativo_is_not_applicable_and_never_sent_to_ai(audit_env):
    calls = audit_env("all_null")
    d = audit([rec("ENFERMAGEM", "Evolução", "ferida operatória limpa e seca, analgesia simples")])
    assert d["secao_d_evolucao"]["curativo"] == "Não se aplica"
    assert not any("curativo" in c["fields"] for c in calls)


def surgery_rec(description=SURGICAL_DESCRIPTION):
    return rec("MEDICINA", "Anamnese", "x", **SURGERY, **{"Descrição Cirurgica": description})


def test_item08_opme_term_found_is_conforme_and_not_sent_to_ai(audit_env):
    calls = audit_env("all_null")
    d = audit([surgery_rec("fixação com placa e parafusos, síntese por planos, cirurgia longa e detalhada")])
    assert d["secao_c"]["uso_opme"].startswith("conforme (placa, parafuso")
    assert not any("uso_opme" in c["fields"] for c in calls)


def test_item08_no_term_goes_to_ai_and_null_means_nao_se_aplica(audit_env):
    calls = audit_env("all_null")
    d = audit([surgery_rec()])
    assert any("uso_opme" in c["fields"] for c in calls)
    assert d["secao_c"]["uso_opme"] == "Não se aplica (IA: null)"
    assert d["conformity_c"]["total"] == 7


def test_item08_poorly_described_opme_is_nao_conforme(audit_env):
    audit_env(ai_answers({"uso_opme": "não conforme: cita 'material de síntese' sem dizer qual"}))
    d = audit([surgery_rec()])
    assert d["secao_c"]["uso_opme"] == "não conforme (IA: cita 'material de síntese' sem dizer qual)"


def test_item08_plural_terms_match():
    from data_extract.utils.text_match import find_words
    assert find_words("colocados drenos e telas", ["dreno", "tela"], plural=True) == ["dreno", "tela"]
    assert find_words("cartela e supino", ["tela", "pino"], plural=True) == []


def test_item09_empty_structured_surgery_fields_stay_not_registered_without_ai(audit_env):
    calls = audit_env("all_null")
    d = audit([rec("MEDICINA", "Anamnese", "x", **{"Especialidade cirurgia": "Ortopedia", "Descrição Cirurgica": SURGICAL_DESCRIPTION})])
    for field in ("unidade_funcional", "inicio", "fim", "diagnostico_cid", "descricao_procedimento"):
        assert d["secao_c"][field] == "Não registrado"
    sent_for_c = [f for f in d["_ia_meta"]["campos_enviados"] if f.startswith("secao_c.")]
    assert sorted(sent_for_c) == ["secao_c.descricao_tecnica", "secao_c.uso_opme"]
    assert calls


def test_item10_secao_e_keeps_all_categories_and_checks_only_presence(audit_env):
    audit_env("all_null")
    d = audit([rec("FISIOTERAPIA", "Evolução", "f"), rec("NUTRICAO", "Evolução", "n"), rec("FISIOTERAPIA", "Anamnese", "g")])
    assert d["secao_e"] == {"tem_outras_categorias": True, "categoria": "FISIOTERAPIA, NUTRICAO", "descricao": "conforme"}


def test_item10_category_without_description_is_not_registered(audit_env):
    audit_env("all_null")
    d = audit([rec("FISIOTERAPIA", "Evolução", "f"), rec("NUTRICAO", "Evolução", "")])
    assert d["secao_e"]["descricao"] == "Não registrado"


def diagnosis_calls(calls):
    return [c for c in calls if c["fields"] == ["diagnostico_internacao"]]


def test_item11_sends_only_the_medical_anamnese(audit_env):
    calls = audit_env("all_null")
    audit([rec("ENFERMAGEM", "Anamnese", "TEXTO DA ENFERMAGEM"), rec("MEDICINA", "Anamnese", "TEXTO MEDICO"),
           rec("MEDICINA", "Evolução", "EVOLUCAO MEDICA")])
    (call,) = diagnosis_calls(calls)
    assert "TEXTO MEDICO" in call["input"]
    assert "ENFERMAGEM" not in call["input"] and "EVOLUCAO" not in call["input"]


def test_item11_without_medical_anamnese_uses_the_first_medical_evolution(audit_env):
    calls = audit_env("all_null")
    audit([rec("ENFERMAGEM", "Anamnese", "TEXTO DA ENFERMAGEM"), rec("MEDICINA", "Evolução", "PRIMEIRA EVOLUCAO"),
           rec("MEDICINA", "Evolução", "SEGUNDA EVOLUCAO")])
    (call,) = diagnosis_calls(calls)
    assert "PRIMEIRA EVOLUCAO" in call["input"] and "SEGUNDA" not in call["input"]


def test_item11_without_medical_text_nothing_is_sent(audit_env):
    calls = audit_env("all_null")
    d = audit([rec("ENFERMAGEM", "Anamnese", "TEXTO DA ENFERMAGEM")])
    assert not diagnosis_calls(calls)
    assert d["secao_a"]["diagnostico_internacao"] == "Não registrado"


def test_item11_text_is_limited_to_the_configured_budget(audit_env, monkeypatch):
    monkeypatch.setattr(auditor, "AI_MAX_CONTEXT_CHARS", 50)
    calls = audit_env("all_null")
    audit([rec("MEDICINA", "Anamnese", "A" * 500)])
    (call,) = diagnosis_calls(calls)
    assert call["input"].count("A") == 50


def test_item15_descricao_tecnica_always_goes_to_ai(audit_env):
    calls = audit_env(ai_answers({"descricao_tecnica": "passo a passo numerado"}))
    d = audit([surgery_rec("a" * 500)])
    assert any("descricao_tecnica" in c["fields"] for c in calls)
    assert d["secao_c"]["descricao_tecnica"] == "conforme (IA: passo a passo numerado)"


def test_item15_ai_can_reject_a_long_description(audit_env):
    audit_env(ai_answers({"descricao_tecnica": "não conforme: sem passo a passo"}))
    d = audit([surgery_rec("a" * 500)])
    assert d["secao_c"]["descricao_tecnica"] == "não conforme (IA: sem passo a passo)"


def test_item12_retry_layers_defaults():
    import worker.worker as worker
    assert worker.MAX_ATTEMPTS == 2
    assert llm_client.AI_MAX_ATTEMPTS >= 1


def test_rules_ignore_accents_in_the_record_text(audit_env):
    audit_env("all_null")
    d = audit([rec("MEDICINA", "Evolução", "hipotese diagnostica: sindrome coronariana. conduta: manter medicacoes.")])
    assert d["secao_b_evolucao"]["hd_cid"] == "conforme"
    assert d["secao_b_evolucao"]["procedimentos_condutas_queixas"] == "conforme"


INCOMPLETE_MEDICAL_EXAM = "estado geral bom, acv: ritmo regular"


def test_incomplete_physical_exam_goes_to_the_ai_and_conforme_overrides_the_keywords(audit_env):
    audit_env(ai_answers({"exame_fisico": "ar: mv presente, abd: flácido, ext: sem edemas"}))
    d = audit([rec("MEDICINA", "Anamnese", INCOMPLETE_MEDICAL_EXAM)])
    assert d["secao_b_anamnese"]["exame_fisico"].startswith("conforme (IA:")


@pytest.mark.parametrize("ai_answer", [None, "não conforme: faltam os demais sistemas"])
def test_incomplete_physical_exam_keeps_the_missing_systems_when_the_ai_does_not_confirm(audit_env, ai_answer):
    audit_env(ai_answers({"exame_fisico": ai_answer}))
    d = audit([rec("MEDICINA", "Anamnese", INCOMPLETE_MEDICAL_EXAM)])
    assert d["secao_b_anamnese"]["exame_fisico"].startswith("não conforme (Faltam:")


def test_complete_physical_exam_is_not_sent_to_the_ai(audit_env):
    sent = []

    def scenario(payload, fields):
        sent.extend(fields)
        return "ok", {field: None for field in fields}, None

    audit_env(scenario)
    d = audit([rec("MEDICINA", "Anamnese", MEDICAL_EXAM)])
    assert "exame_fisico" not in sent
    assert d["secao_b_anamnese"]["exame_fisico"] == "conforme"
