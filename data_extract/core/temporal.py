"""Deadline rules from the audit prompt.

3.5  Medical and nursing anamnesis created within 12h of admission.
3.6  Doctors and nurses evolve daily: one evolution per calendar day, from the second day of the stay
     until the day before discharge. Day one is waived when there is an anamnesis on it; without an
     anamnesis on day one, the count starts at the admission day itself.
"""
from datetime import datetime, timedelta

ANAMNESIS_DEADLINE_HOURS = 12
_DATE_FORMATS = ("%d/%m/%Y, %H:%M", "%d/%m/%Y %H:%M", "%d/%m/%Y")


def parse_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def date_key(value):
    """The date of a creation timestamp as DD/MM/AAAA, zero-padded ("3/12/2023, 10:53" -> "03/12/2023");
    the text before the comma when it is not a date we can read."""
    parsed = parse_datetime(value)
    if parsed is not None:
        return f"{parsed:%d/%m/%Y}"
    return str(value or "").split(",")[0].strip()


def day_label(value):
    """DD/MM of a creation timestamp, zero-padded, for the "dia 17/03" notes."""
    parsed = parse_datetime(value)
    return f"{parsed:%d/%m}" if parsed is not None else str(value or "")[:5]


def _format_hours(delta):
    minutes = int(delta.total_seconds() // 60)
    hours, mins = divmod(minutes, 60)
    return f"{hours}h{mins:02d}" if mins else f"{hours}h"


def check_anamnesis_creation(admission, creation):
    """Gap between admission and anamnesis creation (12h deadline)."""
    admission_dt, creation_dt = parse_datetime(admission), parse_datetime(creation)
    if admission_dt is None or creation_dt is None:
        return "Não registrado"
    delta = creation_dt - admission_dt
    if delta > timedelta(hours=ANAMNESIS_DEADLINE_HOURS):
        return f"não conforme (criada {_format_hours(delta)} após a internação; prazo de {ANAMNESIS_DEADLINE_HOURS}h)"
    return "conforme"


def check_daily_evolution(admission, discharge, anamnesis_creations, evolution_creations):
    """One evolution per calendar day, from the day after admission (when there is an anamnesis on the
    admission day) or from the admission day itself (when there is not), up to the day before discharge.

    `anamnesis_creations` / `evolution_creations`: creation dates (text) of records of the SAME category.
    Returns 'conforme' or 'não conforme (sem evolução em DD/MM, DD/MM)'. 'Não registrado' if dates are missing.
    """
    admission_dt, discharge_dt = parse_datetime(admission), parse_datetime(discharge)
    if admission_dt is None or discharge_dt is None or discharge_dt <= admission_dt:
        return "Não registrado"

    admission_day, discharge_day = admission_dt.date(), discharge_dt.date()
    anamnesis_days = {dt.date() for c in anamnesis_creations if (dt := parse_datetime(c)) is not None}
    first_day = admission_day + timedelta(days=1) if admission_day in anamnesis_days else admission_day
    evolution_days = {dt.date() for c in evolution_creations if (dt := parse_datetime(c)) is not None}

    missing_days = []
    day = first_day
    while day < discharge_day:
        if day not in evolution_days:
            missing_days.append(f"{day:%d/%m}")
        day += timedelta(days=1)

    if missing_days:
        return "não conforme (sem evolução em " + ", ".join(missing_days) + ")"
    return "conforme"
