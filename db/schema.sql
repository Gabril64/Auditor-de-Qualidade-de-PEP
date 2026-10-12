-- Single source of truth for the SQLite schema. Applied by the Producer on startup
-- (services/producer/src/db/migrate.ts); no other service creates a table.

-- The original, immutable audit result. Only the Producer's results consumer inserts into it.
CREATE TABLE IF NOT EXISTS audit_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    job_id TEXT UNIQUE NOT NULL,
    record_number TEXT NOT NULL,
    record_number_display TEXT,
    encounter TEXT,
    audit_data TEXT NOT NULL,
    conformity_percent REAL DEFAULT 0,
    status TEXT DEFAULT 'done',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_record ON audit_results(record_number);
CREATE INDEX IF NOT EXISTS idx_results_batch ON audit_results(batch_id);
CREATE INDEX IF NOT EXISTS idx_results_job ON audit_results(job_id);

-- Web system accounts. password_hash is the full argon2id hash (salt + parameters), never the
-- password. created_by points to the admin who created the account (NULL for the first admin).
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('auditor', 'admin')),
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_login TEXT
);

-- The patient records exactly as they were submitted, one row per audit job. Written by the
-- Producer when it receives a batch, before the job is queued. job_id links to audit_results.
CREATE TABLE IF NOT EXISTS raw_patient_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL UNIQUE,
    batch_id TEXT NOT NULL,
    record_number TEXT NOT NULL,
    record_number_display TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('upload', 'api')),
    submitted_by INTEGER REFERENCES users(id),
    submitted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_records_batch ON raw_patient_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_records_number ON raw_patient_records(record_number);

-- One row per entry of a patient record. Each key of the submitted JSON has its own TEXT column,
-- holding the value as it arrived; original_json keeps the whole entry and extra_keys the keys
-- that have no column. The key-to-column map lives in src/domain/rawRecordColumns.ts.
CREATE TABLE IF NOT EXISTS raw_record_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_patient_record_id INTEGER NOT NULL REFERENCES raw_patient_records(id),
    position INTEGER NOT NULL,
    encounter TEXT,
    professional_category TEXT,
    procedure_icd_code TEXT,
    patient_sus_code TEXT,
    patient_birth_date TEXT,
    surgery_end_at TEXT,
    surgery_start_at TEXT,
    admission_at TEXT,
    discharge_at TEXT,
    death_at TEXT,
    entry_description TEXT,
    surgical_description TEXT,
    surgery_specialty TEXT,
    internal_procedure_performed TEXT,
    surgical_procedure_performed TEXT,
    record_number TEXT,
    followed_safe_surgery_protocol TEXT,
    sex TEXT,
    entry_type TEXT,
    surgery_functional_unit TEXT,
    admission_functional_unit TEXT,
    used_prophylactic_antibiotic TEXT,
    used_oxygen TEXT,
    anamnesis_created_at TEXT,
    original_json TEXT NOT NULL,
    extra_keys TEXT,
    UNIQUE (raw_patient_record_id, position)
);
