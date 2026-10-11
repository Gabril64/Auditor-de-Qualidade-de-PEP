"""Deadline rules from the audit prompt.

3.5  Medical and nursing anamnesis created within 12h of admission.
3.6  Doctors and nurses evolve daily: one evolution per 24h window, counted from the admission date/time
     until discharge. Day one's window is waived when there is an anamnesis in it; without an anamnesis
     on day one, the count starts at admission itself.
"""
from datetime import datetime, timedelta

ANAMNESIS_DEADLINE_HOURS = 12
WINDOW = timedelta(hours=24)
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
    """One evolution per 24h window from admission to discharge.

    `anamnesis_creations` / `evolution_creations`: creation dates (text) of records of the SAME category.
    Returns 'conforme' or 'não conforme (sem evolução entre X e Y; ...)'. 'Não registrado' if dates are missing.
    """
    admission_dt, discharge_dt = parse_datetime(admission), parse_datetime(discharge)
    if admission_dt is None or discharge_dt is None or discharge_dt <= admission_dt:
        return "Não registrado"

    total_windows = int((discharge_dt - admission_dt) / WINDOW)
    anamnesis_on_day_one = any(
        (dt := parse_datetime(c)) is not None and admission_dt <= dt < admission_dt + WINDOW
        for c in anamnesis_creations
    )
    first_window = 1 if anamnesis_on_day_one else 0

    evolution_dates = [dt for c in evolution_creations if (dt := parse_datetime(c)) is not None]
    missing_windows = []
    for window in range(first_window, total_windows):
        start, end = admission_dt + window * WINDOW, admission_dt + (window + 1) * WINDOW
        if not any(start <= dt < end for dt in evolution_dates):
            missing_windows.append(f"{start:%d/%m %H:%M} e {end:%d/%m %H:%M}")

    if missing_windows:
        return "não conforme (sem evolução entre " + "; entre ".join(missing_windows) + ")"
    return "conforme"
