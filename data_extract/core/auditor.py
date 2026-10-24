import re
import sys
import time
from datetime import datetime

from data_extract.core.llm_client import (
    AI_JSON_SCHEMA,
    AI_MAX_CONTEXT_CHARS,
    AI_MISSING_FIELDS,
    AI_OK,
    AI_SEED,
    AI_TEMPERATURE,
    AI_TOP_K,
    AI_TOP_P,
    MODEL_NAME,
    query_ai_fields,
)
from data_extract.core.parser import extract_record_info
from data_extract.core.temporal import check_anamnesis_creation, check_daily_evolution, date_key, day_label
from data_extract.keywords.exame_fisico import MEDICAL_PHYSICAL_EXAM_TERMS, NURSING_PHYSICAL_EXAM_TERMS
from data_extract.keywords.opme import OPME_GENERIC_TERMS, OPME_TERMS
from data_extract.utils.helpers import (
    calculate_age,
    check_complete_physical_exam,
    check_dressing,
    format_period,
)
from data_extract.utils.text_match import find_words, normalize

FIELDS_WITHOUT_AI = frozenset({"criacao_anamnese", "criacao_evolucao", "frequencia_diaria"})
"""Fields computed from date/time: there is no text snippet for the AI to look for."""


def has_diagnostic_hypothesis(text):
    """Diagnostic hypothesis/ICD code registered in the text (accent-insensitive: some records are
    written without accents). 'cid' only counts as a whole word: a substring search matched inside
    'flácido', 'acidente', etc."""
    normalized = normalize(text)
    return "hipotese" in normalized or "#hd" in normalized or "hd:" in normalized or re.search(r"\bcid\b", normalized) is not None


def _new_ai_meta():
    """The signature every audit carries: which model answered, with which decoding and which seed.
    `decodificacao` is "greedy" when either temperature is 0 or top_k is 1 — then the most likely
    token is always taken, which is what makes the run repeatable. The seed goes in every request
    and is recorded here; a server refusing it fails the call, so the affected field lands in
    `campos_erro` instead of passing silently as unseeded."""
    return {
        "model": MODEL_NAME,
        "temperature": AI_TEMPERATURE,
        "top_k": AI_TOP_K,
        "top_p": AI_TOP_P,
        "saida_estruturada": AI_JSON_SCHEMA,
        "decodificacao": "greedy" if AI_TEMPERATURE == 0 or AI_TOP_K == 1 else "amostragem",
        "seed": AI_SEED,
        "seed_aplicada": None if AI_SEED is None else True,
        "chamadas": 0,
        "chamadas_ok": 0,
        "tentativas_total": 0,
        "latencia_ia_s": 0.0,
        "campos_enviados": [],
        "campos_ok": [],
        "campos_null": [],
        "campos_erro": [],
        "chaves_normalizadas": [],
    }


def non_conformity_reason(value):
    """Strips the AI's answer prefix: 'não conforme: falta ACV' -> 'falta ACV'."""
    text = re.sub(r"^\s*(?:n[ãa]o conforme|incompleto)\s*[:\-–]?\s*", "", value.strip(), flags=re.IGNORECASE).strip()
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    return text or value.strip()


def truncate_text(text):
    """Caps the text sent to the AI at the configured character budget."""
    return text if len(text) <= AI_MAX_CONTEXT_CHARS else text[:AI_MAX_CONTEXT_CHARS]


def call_ai_and_apply(target, fields, text, record_type, section_key, ai_meta, null_overrides=None):
    """
    Sends `fields` to the AI and writes into `target` the result with each field's "signature":
      - conforme / não conforme (IA: trecho)          -> the AI answered with a snippet
      - Não registrado (IA: null)                     -> the AI answered null (looked and found nothing)
      - Não registrado (IA_NAO_EXECUTADA: <motivo>)    -> the AI did not run (timeout, invalid JSON...)
    `null_overrides` swaps the value written when the AI answers null (e.g. uso_opme -> "Não se aplica").
    Only "conforme" and "não conforme" exist: the AI's incompleto/não conforme become
    "não conforme (IA: <motivo>)". Returns the time spent on the AI (seconds).
    Without text, nothing is sent or recorded.
    """
    null_overrides = null_overrides or {}
    resp = query_ai_fields(text, fields, record_type)
    if resp["attempts"] == 0:
        return 0.0

    ai_meta["chamadas"] += 1
    ai_meta["tentativas_total"] += resp["attempts"]
    ai_meta["latencia_ia_s"] += resp["latency"]
    # How many answers only matched after their key's spelling was reconciled: a measure of how
    # closely a model follows the requested output format, and the audit trail of that leniency.
    for field, key in (resp.get("renamed_keys") or {}).items():
        ai_meta["chaves_normalizadas"].append({"campo": f"{section_key}.{field}", "chave_recebida": key})
    if resp["status"] == AI_OK:
        ai_meta["chamadas_ok"] += 1

    for field in fields:
        field_id = f"{section_key}.{field}"
        ai_meta["campos_enviados"].append(field_id)

        if field not in resp["fields"]:
            reason = resp["status"] if resp["status"] != AI_OK else AI_MISSING_FIELDS
            target[field] = f"Não registrado (IA_NAO_EXECUTADA: {reason})"
            ai_meta["campos_erro"].append({"campo": field_id, "motivo": reason, "detalhe": resp["error"]})
            sys.stderr.write(f"  [AI Fallback Error] Field {field_id} was not processed by the AI ({reason}).\n")
            continue

        field_value = resp["fields"][field]
        if field_value and isinstance(field_value, str):
            if "não conforme" in field_value.lower() or "incompleto" in field_value.lower():
                target[field] = f"não conforme (IA: {non_conformity_reason(field_value)})"
            else:
                target[field] = f"conforme (IA: {field_value})"
            ai_meta["campos_ok"].append(field_id)
        elif field_value:
            target[field] = "conforme (validado por IA)"
            ai_meta["campos_ok"].append(field_id)
        else:
            target[field] = null_overrides.get(field, "Não registrado (IA: null)")
            ai_meta["campos_null"].append(field_id)

    return resp["latency"]


def finalize_ai_meta(audit_data, ai_meta):
    """Attaches the AI summary to the result, and the partial-result warning if anything failed."""
    ai_meta["latencia_ia_s"] = round(ai_meta["latencia_ia_s"], 2)
    audit_data["_ia_meta"] = ai_meta
    errors = ai_meta["campos_erro"]
    audit_data["ia_incompleta"] = bool(errors)
    if errors:
        details = ", ".join(f"{error['campo']} ({error['motivo']})" for error in errors)
        audit_data["observacao_ia"] = (
            f"A IA não rodou para todos os campos ({len(errors)} de {len(ai_meta['campos_enviados'])}): {details}. "
            "Esses campos foram marcados como 'Não registrado' e o resultado é parcial."
        )
        sys.stderr.write(f"  [Auditor] WARNING: partial result — {audit_data['observacao_ia']}\n")


_AI_SIGNATURE = re.compile(r"\((?:IA|IA_NAO_EXECUTADA):")

# Verdicts that a merge treats as "nothing found", and whose values a signature can enrich.
_NOT_FOUND_VERDICTS = ("Não registrado", "Não se aplica")


def _only_new_records_what_the_ai_did(current_text, new_text):
    """True when both values carry the SAME verdict but only the new one says what the AI did.
    "Não registrado (IA: null)" means the AI looked and found nothing; a plain "Não registrado"
    means the keyword rules found nothing and is silent about the AI. The verdict prefix has to
    match, so this never turns a "Não registrado" into a "Não se aplica" (which would leave the
    field out of the conformity total) — it only adds provenance."""
    for verdict in _NOT_FOUND_VERDICTS:
        if current_text.startswith(verdict) and new_text.startswith(verdict):
            return _AI_SIGNATURE.search(new_text) is not None and _AI_SIGNATURE.search(current_text) is None
    return False


def merge_section(current, new_data):
    """Merges new conformity data, keeping 'conforme' when it is already present. Between two
    values with the same verdict, the one carrying the AI's signature wins: dropping it made a
    model that answered null indistinguishable from a model that was never asked, which silently
    removed those fields from the model's score in the evaluation."""
    for key, value in new_data.items():
        current_text = str(current.get(key))
        new_text = str(value)
        if not current_text.startswith("conforme") and new_text.startswith("conforme"):
            current[key] = value
        elif (current_text.startswith("Não registrado") or current_text.startswith("Não se aplica")) and not (
            new_text.startswith("Não registrado") or new_text.startswith("Não se aplica")
        ):
            current[key] = value
        elif _only_new_records_what_the_ai_did(current_text, new_text):
            current[key] = value


def _append_day_note(value, days):
    return value[:-1] + f" — dia {days})" if value.endswith(")") else f"{value} (dia {days})"


def aggregate_evolutions(entries):
    """Evolutions: ALL of them must be conforme. `entries` = [(day 'DD/MM', {field: value})].

    - all conforme       -> keeps the first value (with the AI signature, if any)
    - some failed        -> 'não conforme (<motivo> — dia DD/MM, DD/MM)', naming the day it failed
    - no evolution has the field (only 'Não registrado')  -> keeps 'Não registrado'
    - 'Não se aplica' in all of them (e.g. dressing)       -> 'Não se aplica'
    """
    by_field: dict[str, list[tuple[str, str]]] = {}
    for day, values in entries:
        for field, value in values.items():
            by_field.setdefault(field, []).append((day, str(value)))

    result = {}
    for field, field_entries in by_field.items():
        applicable = [(day, value) for day, value in field_entries if not value.startswith("Não se aplica")]
        if not applicable:
            result[field] = field_entries[0][1]
            continue
        failures = [(day, value) for day, value in applicable if not value.startswith("conforme")]
        if not failures:
            result[field] = applicable[0][1]
            continue
        days = ", ".join(day for day, _ in failures)
        first_failure_value = failures[0][1]
        ai_error = next((value for _, value in failures if "IA_NAO_EXECUTADA" in value), None)
        any_conforme = len(failures) < len(applicable)
        any_non_conforme = any(value.startswith("não conforme") for _, value in failures)
        if ai_error:
            result[field] = _append_day_note(ai_error, days)
        elif not any_conforme and not any_non_conforme:
            result[field] = first_failure_value
        elif first_failure_value.startswith("não conforme"):
            result[field] = _append_day_note(first_failure_value, days)
        else:
            inner = first_failure_value[len("Não registrado"):].strip()
            inner = inner[1:-1] if inner.startswith("(") and inner.endswith(")") else "não registrado"
            result[field] = f"não conforme ({inner} — dia {days})"
    return result


def _group_by_patient(records):
    patients: dict[str, list[dict]] = {}
    for record in records:
        info = extract_record_info(record)
        record_number = info["prontuario"] or "Desconhecido"
        patients.setdefault(record_number, []).append(info)
    return patients


def _build_document_matrix(patient_records):
    """One entry per `{category} - {record_type}` document, counting how many times each creation
    date appears. Feeds `secao_a`'s `matriz_documentos`, which the front end renders as a table."""
    matrix: dict[str, dict[str, int]] = {}
    all_dates = set()
    for info in patient_records:
        category = info.get("categoria_profissional", "Outros")
        if (category or "").upper() not in ("MEDICINA", "ENFERMAGEM"):
            category = _team_category_name(category)
        record_type = info.get("tipo_registro", "Registro")
        doc_name = f"{category} - {record_type}"

        raw_date = info.get("data_criacao", "")
        if raw_date:
            date = date_key(raw_date)
            all_dates.add(date)
            matrix.setdefault(doc_name, {})
            matrix[doc_name][date] = matrix[doc_name].get(date, 0) + 1
    return matrix, all_dates


def _new_audit_data(base_info, matrix, all_dates):
    return {
        "matriz_documentos": {
            "datas": sorted(
                all_dates,
                key=lambda d: d.split('/')[2] + d.split('/')[1] + d.split('/')[0] if d.count('/') == 2 else d,
            ),
            "matriz": matrix,
        },
        "secao_a": {
            "prontuario": base_info["prontuario"] or "Não registrado",
            "data_nascimento": base_info["data_nascimento"] or "Não registrado",
            "idade": base_info["idade"] or (calculate_age(base_info["data_nascimento"], base_info["periodo_internacao"]) or "Não registrado"),
            "especialidade_internacao": base_info["especialidade_internacao"] or base_info["especialidade_cirurgia"] or "Não registrado",
            "periodo_internacao": format_period(base_info["periodo_internacao"], base_info.get("data_saida", "")),
            "diagnostico_internacao": base_info["diagnostico_internacao"] or "Não registrado",
            "especialidade_cirurgia": base_info["especialidade_cirurgia"] or "Não se aplica",
            "unidade_funcional": base_info["unidade_funcional"] or "Não registrado",
        },
        "secao_b_anamnese": {k: "Não registrado" for k in ["hda", "hd_cid", "ap_app", "af", "exame_fisico", "cd", "criacao_anamnese"]},
        "secao_b_evolucao": {k: "Não registrado" for k in ["hd_cid", "exame_fisico", "procedimentos_condutas_queixas", "frequencia_diaria"]},
        "secao_c": {
            "tem_cirurgia": bool(base_info["especialidade_cirurgia"]),
            "especialidade": base_info["especialidade_cirurgia"] or "Não registrado",
            "unidade_funcional": base_info.get("uf_cirurgia") or "Não registrado",
            "inicio": base_info["data_cirurgia"] or "Não registrado",
            "fim": base_info["fim_cirurgia"] or "Não registrado",
            "diagnostico_cid": base_info["cid_procedimento"] or "Não registrado",
            "descricao_procedimento": base_info["procedimento_realizado"] or "Não registrado",
            "descricao_tecnica": "Não registrado",
            "uso_opme": "Não se aplica",
        },
        "secao_d_anamnese": {k: "Não registrado" for k in ["motivo_internacao", "ap_app", "af", "exame_fisico", "escala_braden", "escala_morse", "cd", "criacao_anamnese"]},
        "secao_d_evolucao": dict({k: "Não registrado" for k in ["motivo_internacao", "exame_fisico", "condutas", "escala_braden", "escala_morse", "criacao_evolucao"]}, curativo="Não se aplica"),
        "secao_e": {
            "tem_outras_categorias": False,
            "categorias": {name: _not_applicable_kinds() for name in TEAM_CATEGORIES},
        },
    }


def _apply_surgery_presence(audit_data, surgical_description):
    """A patient with no surgical description had no surgery: the whole of section C is "Não se
    aplica", whatever the structured columns say, and it stays out of the score."""
    section_c = audit_data["secao_c"]
    section_c["tem_cirurgia"] = bool(surgical_description)
    if not section_c["tem_cirurgia"]:
        for key in section_c:
            if key != "tem_cirurgia":
                section_c[key] = "Não se aplica"


def _audit_surgery_section(audit_data, description, ai_meta, meta_lines):
    """OPME: a specific term found in the surgical description -> conforme; only a generic mention
    ("material de síntese") -> não conforme, since it exists but is not explained; no mention -> the
    AI decides (null -> "Não se aplica"). Only the OPEN fields go to the AI: structured columns that come back
    empty (especialidade, unidade, início, fim, CID, procedimento) stay "Não registrado", because the
    source column is the authority on them."""
    section_started_at = time.time()
    meta_lines.append(f"Seção C - inicio {datetime.now().strftime('%d/%m/%y, %H:%M:%S')}")

    found_terms = find_words(description, OPME_TERMS, plural=True)
    generic_terms = [] if found_terms else find_words(description, OPME_GENERIC_TERMS, plural=True)
    if found_terms:
        audit_data["secao_c"]["uso_opme"] = f"conforme ({', '.join(found_terms)})"
    elif generic_terms:
        audit_data["secao_c"]["uso_opme"] = f"não conforme (OPME mencionado sem especificar o material: {', '.join(generic_terms)})"
    else:
        audit_data["secao_c"]["uso_opme"] = "Não registrado"

    missing_fields = [k for k in ("descricao_tecnica", "uso_opme") if audit_data["secao_c"][k] == "Não registrado"]
    ai_duration = 0.0
    if missing_fields:
        meta_lines.append(f"Seção C - IA ({', '.join(missing_fields)}) inicio {datetime.now().strftime('%H:%M:%S')}")
        ai_duration = call_ai_and_apply(
            audit_data["secao_c"], missing_fields, truncate_text(description),
            "Cirurgia / Descrição Cirúrgica", "secao_c", ai_meta,
            null_overrides={"uso_opme": "Não se aplica (IA: null)"},
        )
        meta_lines.append(f"Seção C - IA ({', '.join(missing_fields)}) fim {datetime.now().strftime('%H:%M:%S')} ({ai_duration:.1f}s)")

    meta_lines.append(f"Seção C - fim {datetime.now().strftime('%d/%m/%y, %H:%M:%S')} ({time.time() - section_started_at:.1f}s)")
    return ai_duration


def _apply_daily_evolution_rule(audit_data, patient_records, base_info):
    """Rule 3.6: medical records write to frequencia_diaria, nursing records to criacao_evolucao."""
    for category, key, field in (("MEDICINA", "secao_b_evolucao", "frequencia_diaria"),
                                  ("ENFERMAGEM", "secao_d_evolucao", "criacao_evolucao")):
        records_of_category = [r for r in patient_records if (r["categoria_profissional"] or "").upper() == category]
        anamnesis_dates = [r["data_criacao"] for r in records_of_category if "anamnese" in (r["tipo_registro"] or "").lower()]
        evolution_dates = [r["data_criacao"] for r in records_of_category if "evolução" in (r["tipo_registro"] or "").lower()]
        if anamnesis_dates or evolution_dates:
            audit_data[key][field] = check_daily_evolution(
                base_info["periodo_internacao"], base_info.get("data_saida", ""), anamnesis_dates, evolution_dates
            )


def _is_incomplete_physical_exam(value):
    """The keywords found the exam but some body systems are missing ("não conforme (Faltam: ...)")."""
    return isinstance(value, str) and value.startswith("não conforme (Faltam:")


TEAM_CATEGORIES = (
    "Fisioterapia/Terapia Ocupacional", "Nutrição", "Psicologia", "Fonoaudiologia", "Serviço Social", "Farmácia",
)
# Stems of the normalized category name -> the listed category it belongs to.
_TEAM_CATEGORY_STEMS = (
    ("fisioterap", TEAM_CATEGORIES[0]), ("terapia ocupacional", TEAM_CATEGORIES[0]),
    ("terapeuta ocupacional", TEAM_CATEGORIES[0]),
    ("nutri", TEAM_CATEGORIES[1]), ("psicolog", TEAM_CATEGORIES[2]), ("fonoaudio", TEAM_CATEGORIES[3]),
    ("servico social", TEAM_CATEGORIES[4]), ("farmac", TEAM_CATEGORIES[5]),
)


def _not_applicable_kinds():
    return {"anamnese": "Não se aplica", "evolucao": "Não se aplica"}


def _team_category_name(category):
    """The listed category a record's category belongs to ("SERVICO SOCIAL" -> "Serviço Social",
    "FISIOTERAPIA" -> "Fisioterapia/Terapia Ocupacional"); a category not on the list keeps its own name."""
    normalized = normalize(category)
    return next((name for stem, name in _TEAM_CATEGORY_STEMS if stem in normalized), category)


def _note_other_category_record(other_categories, category, record_type, description):
    """Section E: the six multiprofessional categories are always listed, and any other category found
    joins them; each one gets an
    "anamnese" and an "evolucao" verdict, like medicine and nursing, but only presence is checked
    (never the content): "conforme" when a record of that type has a description, "Não registrado"
    when the records of that type are all empty, "Não se aplica" when there is no record of that type."""
    entry = other_categories.setdefault(_team_category_name(category), _not_applicable_kinds())
    kind = "anamnese" if "anamnese" in record_type else "evolucao" if "evolução" in record_type else None
    if kind is None:
        return
    if description:
        entry[kind] = "conforme"
    elif entry[kind] == "Não se aplica":
        entry[kind] = "Não registrado"


def _local_findings(category, record_type, normalized_description, description):
    """Keyword-based findings for one record, before the AI fallback fills in what is missing.
    Returns (target_key, values); target_key is None for a category with no rules of its own.
    An anamnese's "criacao_anamnese" comes back None: the caller fills it in, since only it has
    the patient's admission date."""
    if category == "MEDICINA":
        if "anamnese" in record_type:
            return "secao_b_anamnese", {
                "hda": "conforme" if "hda" in normalized_description or "historia da doenca" in normalized_description else "Não registrado",
                "hd_cid": "conforme" if has_diagnostic_hypothesis(description) else "Não registrado",
                "ap_app": "conforme" if "antecedentes pessoais" in normalized_description or "app" in normalized_description or "#ap" in normalized_description or "ap:" in normalized_description else "Não registrado",
                "af": "conforme" if "antecedentes familiares" in normalized_description or "#af" in normalized_description or "af:" in normalized_description else "Não registrado",
                "exame_fisico": check_complete_physical_exam(description, MEDICAL_PHYSICAL_EXAM_TERMS),
                "cd": "conforme" if "conduta" in normalized_description or "terapeutica" in normalized_description or "#cd" in normalized_description or "cd:" in normalized_description else "Não registrado",
                "criacao_anamnese": None,
            }
        if "evolução" in record_type:
            return "secao_b_evolucao", {
                "hd_cid": "conforme" if has_diagnostic_hypothesis(description) else "Não registrado",
                "exame_fisico": check_complete_physical_exam(description, MEDICAL_PHYSICAL_EXAM_TERMS),
                "procedimentos_condutas_queixas": "conforme" if "procedimento" in normalized_description or "conduta" in normalized_description or "queixa" in normalized_description or "intercorrencia" in normalized_description or "#cd" in normalized_description or "cd:" in normalized_description else "Não registrado",
            }
    elif category == "ENFERMAGEM":
        if "anamnese" in record_type:
            return "secao_d_anamnese", {
                "motivo_internacao": "conforme" if "motivo" in normalized_description or "internacao" in normalized_description else "Não registrado",
                "ap_app": "conforme" if "antecedentes" in normalized_description or "comorbidade" in normalized_description else "Não registrado",
                "af": "conforme" if "antecedentes familiares" in normalized_description else "Não registrado",
                "exame_fisico": check_complete_physical_exam(description, NURSING_PHYSICAL_EXAM_TERMS),
                "escala_braden": "conforme" if "braden" in normalized_description else "Não registrado",
                "escala_morse": "conforme" if "morse" in normalized_description else "Não registrado",
                "cd": "conforme" if "conduta" in normalized_description or "#cd" in normalized_description or "cd:" in normalized_description else "Não registrado",
                "criacao_anamnese": None,
            }
        if "evolução" in record_type:
            return "secao_d_evolucao", {
                "motivo_internacao": "conforme" if "motivo" in normalized_description else "Não registrado",
                "exame_fisico": check_complete_physical_exam(description, NURSING_PHYSICAL_EXAM_TERMS),
                "condutas": "conforme" if "conduta" in normalized_description or "#cd" in normalized_description or "cd:" in normalized_description else "Não registrado",
                "escala_braden": "conforme" if "braden" in normalized_description else "Não registrado",
                "escala_morse": "conforme" if "morse" in normalized_description else "Não registrado",
                "curativo": check_dressing(description),
            }
    return None, {}


def audit_medical_records(records):
    """Audits one patient's worth of records at a time and returns one result per patient.

    Records are grouped by prontuário; the first one read supplies the static identification
    fields (secao_a). Each record then contributes keyword-based findings for its section
    (MEDICINA/ENFERMAGEM × anamnese/evolução); daily evolutions are aggregated afterward so that
    EVERY day must be conforme (rule 3.6). Fields the keywords leave as "Não registrado" go to the
    AI fallback. Section E keeps every other professional category, checking only whether it has a
    description, never its content. Section A's diagnostico_internacao falls back to the AI using
    MEDICAL text only (rule 3.4): the medical anamnesis, or the first medical evolution if there is
    no anamnesis.
    """
    results = []
    patients = _group_by_patient(records)

    for record_number, patient_records in patients.items():
        sys.stderr.write(f"Auditing patient {record_number} with {len(patient_records)} records...\n")

        base_info = patient_records[0]
        matrix, all_dates = _build_document_matrix(patient_records)
        audit_data = _new_audit_data(base_info, matrix, all_dates)

        unique_surgical_description = next(
            (r["descricao_cirurgica"] for r in patient_records if r.get("descricao_cirurgica")), None
        )

        _apply_surgery_presence(audit_data, unique_surgical_description)

        patient_started_at = time.time()
        meta_lines = [f"\nProntuario {record_number}", f"Modelo IA: {MODEL_NAME}"]
        total_ai_time = 0.0
        ai_meta = _new_ai_meta()

        other_categories = audit_data["secao_e"]["categorias"]
        evolutions: dict[str, list[tuple[str, dict]]] = {}

        for info in patient_records:
            category = (info["categoria_profissional"] or "").upper()
            record_type = (info["tipo_registro"] or "").lower()
            normalized_description = normalize(info["descricao"])

            if unique_surgical_description and audit_data["secao_c"]["tem_cirurgia"]:
                total_ai_time += _audit_surgery_section(audit_data, unique_surgical_description, ai_meta, meta_lines)
                sys.stderr.write(f"  [Auditor] Surgery section finished for patient {record_number}.\n")
                unique_surgical_description = None

            target_key, local_values = _local_findings(category, record_type, normalized_description, info["descricao"])
            if "criacao_anamnese" in local_values:
                local_values["criacao_anamnese"] = check_anamnesis_creation(info["periodo_internacao"], info["data_criacao"])
            elif category and category not in ("MEDICINA", "ENFERMAGEM"):
                audit_data["secao_e"]["tem_outras_categorias"] = True
                _note_other_category_record(other_categories, category, record_type, info["descricao"])

            if local_values and target_key is not None:
                target_section = audit_data[target_key]
                section_label = f"{category} - {record_type}"
                section_started_at = time.time()
                meta_lines.append(f"Seção {section_label} - inicio {datetime.now().strftime('%d/%m/%y, %H:%M:%S')}")

                missing_fields = [
                    k for k, v in local_values.items()
                    if k not in FIELDS_WITHOUT_AI and (v == "Não registrado" or (isinstance(v, str) and v.startswith("Não registrado")))
                ]
                incomplete_exam = local_values.get("exame_fisico") if _is_incomplete_physical_exam(local_values.get("exame_fisico")) else None
                if incomplete_exam:
                    missing_fields.append("exame_fisico")
                if missing_fields:
                    meta_lines.append(f"Seção {section_label} - IA ({', '.join(missing_fields)}) inicio {datetime.now().strftime('%H:%M:%S')}")
                    ai_duration = call_ai_and_apply(
                        local_values, missing_fields, truncate_text(info["descricao"]), f"{category} - {record_type}", target_key, ai_meta,
                        null_overrides={"curativo": "Não se aplica (IA: null)"},
                    )
                    total_ai_time += ai_duration
                    if incomplete_exam and not _is_valid(local_values["exame_fisico"]):
                        local_values["exame_fisico"] = incomplete_exam
                    meta_lines.append(f"Seção {section_label} - IA ({', '.join(missing_fields)}) fim {datetime.now().strftime('%H:%M:%S')} ({ai_duration:.1f}s)")

                if "evolução" in record_type:
                    evolutions.setdefault(target_key, []).append((day_label(info["data_criacao"]), local_values))
                else:
                    merge_section(target_section, local_values)
                meta_lines.append(f"Seção {section_label} - fim {datetime.now().strftime('%d/%m/%y, %H:%M:%S')} ({time.time() - section_started_at:.1f}s)")
                sys.stderr.write(f"  [Auditor] Section {category} - {record_type} finished for patient {record_number}.\n")

        for key, entries in evolutions.items():
            audit_data[key].update(aggregate_evolutions(entries))

        _apply_daily_evolution_rule(audit_data, patient_records, base_info)


        if audit_data["secao_a"]["diagnostico_internacao"] == "Não registrado":
            doctors = [r for r in patient_records if (r["categoria_profissional"] or "").upper() == "MEDICINA" and r.get("descricao")]
            diagnosis_source = next((r for r in doctors if "anamnese" in (r["tipo_registro"] or "").lower()), None) \
                or next((r for r in doctors if "evolução" in (r["tipo_registro"] or "").lower()), None)
            if diagnosis_source:
                meta_lines.append(f"Seção A - IA (diagnostico_internacao) inicio {datetime.now().strftime('%H:%M:%S')}")
                ai_duration = call_ai_and_apply(
                    audit_data["secao_a"], ["diagnostico_internacao"], truncate_text(diagnosis_source["descricao"]),
                    "Identificação do Paciente", "secao_a", ai_meta,
                )
                total_ai_time += ai_duration
                meta_lines.append(f"Seção A - IA (diagnostico_internacao) fim {datetime.now().strftime('%H:%M:%S')} ({ai_duration:.1f}s)")
                sys.stderr.write(f"  [Auditor] Section A - diagnostico_internacao finished for patient {record_number}.\n")

        total_time = time.time() - patient_started_at
        meta_lines.append(f"Tempo total prontuario {record_number} = {total_time:.1f}s")
        meta_lines.append(f"Tempo total IA = {total_ai_time:.1f}s")

        try:
            import os
            meta_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "metadataProntuarios.txt")
            with open(meta_path, "a", encoding="utf-8") as meta_file:
                meta_file.write("\n".join(meta_lines) + "\n")
        except Exception:
            pass

        audit_data = calculate_conformity(audit_data)
        finalize_ai_meta(audit_data, ai_meta)

        results.append({"record_id": record_number, "audit_data": audit_data})

    return results


def _is_valid(value):
    """A value counts toward conformity only when it is exactly "conforme": "Não registrado (...)",
    "não conforme (...)" and "Incompleto (...)" do not."""
    if isinstance(value, bool):
        return value
    if not value:
        return False
    text = str(value).lower().strip()
    if text.startswith(("não registrado", "nao registrado", "não conforme", "nao conforme", "incompleto")):
        return False
    return text not in ("não", "nao", "false", "")


def _is_not_applicable(value):
    if not value:
        return False
    text = str(value).lower().strip()
    return text.startswith(("não se aplica", "nao se aplica")) or text in ("n/a", "na")


def _score(valid, total):
    return {"total": total, "valid": valid, "percent": (valid / total * 100) if total > 0 else 0}


def calculate_conformity(data):
    """Calculates the conformity percentage for each section and the global total."""
    section_a = data.get("secao_a", {})
    a_items = ["prontuario", "data_nascimento", "idade", "periodo_internacao", "diagnostico_internacao", "unidade_funcional"]
    a_valid = sum(1 for item in a_items if _is_valid(section_a.get(item)))
    a_total = len(a_items)

    for optional_item in ("especialidade_cirurgia", "especialidade_internacao"):
        if not _is_not_applicable(section_a.get(optional_item)):
            a_total += 1
            if _is_valid(section_a.get(optional_item)):
                a_valid += 1

    data["conformity_a"] = _score(a_valid, a_total)

    section_b_anamnese = data.get("secao_b_anamnese", {})
    b_a_items = ["hda", "hd_cid", "ap_app", "af", "exame_fisico", "cd", "criacao_anamnese"]
    b_a_valid = sum(1 for item in b_a_items if _is_valid(section_b_anamnese.get(item)))
    data["conformity_b_anamnese"] = _score(b_a_valid, len(b_a_items))

    section_b_evolucao = data.get("secao_b_evolucao", {})
    b_e_items = ["hd_cid", "exame_fisico", "procedimentos_condutas_queixas", "frequencia_diaria"]
    b_e_valid = sum(1 for item in b_e_items if _is_valid(section_b_evolucao.get(item)))
    data["conformity_b_evolucao"] = _score(b_e_valid, len(b_e_items))

    section_c = data.get("secao_c", {})
    has_surgery = section_c.get("tem_cirurgia", False)
    if has_surgery:
        c_items = ["especialidade", "unidade_funcional", "inicio", "fim", "diagnostico_cid", "descricao_procedimento", "descricao_tecnica"]
        c_valid = sum(1 for item in c_items if _is_valid(section_c.get(item)))
        c_total = len(c_items)
        if not _is_not_applicable(section_c.get("uso_opme")):
            c_total += 1
            if _is_valid(section_c.get("uso_opme")):
                c_valid += 1
        data["conformity_c"] = {**_score(c_valid, c_total), "applies": True}
    else:
        data["conformity_c"] = {"total": 0, "valid": 0, "percent": 100, "applies": False}

    section_d_anamnese = data.get("secao_d_anamnese", {})
    d_a_items = ["motivo_internacao", "ap_app", "af", "exame_fisico", "escala_braden", "escala_morse", "cd", "criacao_anamnese"]
    d_a_valid = sum(1 for item in d_a_items if _is_valid(section_d_anamnese.get(item)))
    d_a_total = len(d_a_items)
    data["conformity_d_anamnese"] = _score(d_a_valid, d_a_total)

    section_d_evolucao = data.get("secao_d_evolucao", {})
    d_e_items = ["motivo_internacao", "exame_fisico", "condutas", "escala_braden", "escala_morse", "criacao_evolucao"]
    d_e_valid = sum(1 for item in d_e_items if _is_valid(section_d_evolucao.get(item)))
    d_e_total = len(d_e_items)
    if not _is_not_applicable(section_d_evolucao.get("curativo")):
        d_e_total += 1
        if _is_valid(section_d_evolucao.get("curativo")):
            d_e_valid += 1
    data["conformity_d_evolucao"] = _score(d_e_valid, d_e_total)

    section_e = data.get("secao_e", {})
    e_values = [value for kinds in section_e.get("categorias", {}).values() for value in kinds.values()]
    e_applicable = [value for value in e_values if not _is_not_applicable(value)]
    if e_applicable:
        e_valid = sum(1 for value in e_applicable if _is_valid(value))
        data["conformity_e"] = {**_score(e_valid, len(e_applicable)), "applies": True, "categoria": ", ".join(section_e["categorias"])}
    else:
        data["conformity_e"] = {"total": 0, "valid": 0, "percent": 100, "applies": False, "categoria": ", ".join(section_e.get("categorias", {})) or "Outras"}

    global_total = a_total + len(b_a_items) + len(b_e_items) + d_a_total + d_e_total
    global_valid = a_valid + b_a_valid + b_e_valid + d_a_valid + d_e_valid
    if has_surgery:
        global_total += data["conformity_c"]["total"]
        global_valid += data["conformity_c"]["valid"]
    global_total += data["conformity_e"]["total"]
    global_valid += data["conformity_e"]["valid"]

    data["conformity_global"] = {
        "total": global_total,
        "valid": global_valid,
        "invalid": global_total - global_valid,
        "percent": (global_valid / global_total * 100) if global_total > 0 else 0,
    }

    return data
