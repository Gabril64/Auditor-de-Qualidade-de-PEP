import re
import sys
from datetime import datetime

from data_extract.utils.text_match import has_word, normalize


def calculate_age(birth_date_str, admission_date_str):
    try:
        if not birth_date_str or not admission_date_str:
            return ""
        birth_part = birth_date_str.split(',')[0].strip()
        admission_part = admission_date_str.split(',')[0].strip()
        fmt = "%d/%m/%Y"
        birth_date = datetime.strptime(birth_part, fmt)
        admission_date = datetime.strptime(admission_part, fmt)
        age = admission_date.year - birth_date.year - (
            (admission_date.month, admission_date.day) < (birth_date.month, birth_date.day)
        )
        return f"{age} ANOS"
    except Exception:
        return ""


def format_period(admission_str, discharge_str):
    if not admission_str:
        return "Não registrado"
    if not discharge_str:
        return f"{admission_str} - Data de saída não registrada"
    try:
        fmt = "%d/%m/%Y, %H:%M"
        admission_date = datetime.strptime(admission_str.strip(), fmt)
        discharge_date = datetime.strptime(discharge_str.strip(), fmt)
        days = (discharge_date - admission_date).days
        return f"{admission_str} - {discharge_str} ({days} dias)"
    except Exception as e:
        sys.stderr.write(f"DEBUG: Error calculating period: {e}\n")
        return f"{admission_str} - {discharge_str}"


def check_complete_physical_exam(text, systems_dictionary):
    """Complete physical exam = at least one keyword from EACH system (whole-word match)."""
    if not text:
        return "Não registrado"

    normalized = normalize(text)
    missing_systems = [
        system for system, synonyms in systems_dictionary.items()
        if not any(has_word(normalized, synonym) for synonym in synonyms)
    ]

    if missing_systems:
        return f"não conforme (Faltam: {', '.join(missing_systems)})"

    return "conforme"


DRESSING_TYPES = (("simples", "simples"), ("especial", "especial"), ("grau ii", "grau II"), ("grau 2", "grau II"))
_DRESSING = r"curativos?"
_TYPE_ALT = "|".join(re.escape(t) for t, _ in DRESSING_TYPES)
_DRESSING_TYPE_RE = re.compile(rf"(?<!\w)(?:{_DRESSING}\s+(?:{_TYPE_ALT})|(?:{_TYPE_ALT})\s+{_DRESSING})(?!\w)")
_DRESSING_RE = re.compile(rf"(?<!\w){_DRESSING}(?!\w)")
DRESSING_DETAILS = ("tamanho", "exsudato", "necrose")


def dressing_type(text):
    """Dressing type ('simples', 'especial' or 'grau II') when the type sits NEXT TO the word
    'curativo' (right before or after). A loose 'simples' elsewhere in the text does not count."""
    m = _DRESSING_TYPE_RE.search(normalize(text))
    if not m:
        return None
    snippet = m.group(0)
    for term, label in DRESSING_TYPES:
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", snippet):
            return label
    return None


def check_dressing(text):
    """Dressing (optional item; evaluated only in the nursing evolution).

    - no 'curativo' word: 'Não se aplica'
    - type identified + size, exudate and necrosis described: 'conforme (Curativo <tipo>)'
    - type identified, but something is missing: 'não conforme (Curativo <tipo>; faltou: ...)'
    - dressing mentioned without an identifiable type: 'Não registrado' -> the auditor sends it to the AI fallback
    """
    if not text:
        return "Não se aplica"

    normalized = normalize(text)
    if not _DRESSING_RE.search(normalized):
        return "Não se aplica"

    dressing = dressing_type(text)
    if dressing is None:
        return "Não registrado"

    missing = [d for d in DRESSING_DETAILS if not has_word(normalized, d)]
    if missing:
        return f"não conforme (Curativo {dressing}; faltou: {', '.join(missing)})"
    return f"conforme (Curativo {dressing})"
