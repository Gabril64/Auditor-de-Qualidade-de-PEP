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

-- The original audit result, one row per audited field. Only the fields that count toward
-- conformity are stored (section C only when there was surgery, section E only when there are
-- other professional categories). record_type is NULL in sections A, C and E.
-- status: conforme | nao_conforme | nao_registrado | nao_se_aplica
-- source: rule | ai | ai_null | ai_failed | human (human only in audit_revision_fields)
CREATE TABLE IF NOT EXISTS audit_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL REFERENCES audit_results(id),
    section TEXT NOT NULL CHECK (length(section) = 1),
    record_type TEXT CHECK (record_type IN ('anamnesis', 'evolution')),
    field TEXT NOT NULL,
    value TEXT,
    status TEXT NOT NULL CHECK (status IN ('conforme', 'nao_conforme', 'nao_registrado', 'nao_se_aplica')),
    source TEXT NOT NULL CHECK (source IN ('rule', 'ai', 'ai_null', 'ai_failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_fields_unique
    ON audit_fields(audit_id, section, IFNULL(record_type, ''), field);
CREATE INDEX IF NOT EXISTS idx_audit_fields_status ON audit_fields(field, status);

-- The current version the user sees, created on the first edit. One row per audit.
-- Logical delete: deleted_at set by an admin hides the submission, nothing leaves the database.
CREATE TABLE IF NOT EXISTS audit_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL UNIQUE REFERENCES audit_results(id),
    audit_data TEXT NOT NULL,
    conformity_percent REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    deleted_at TEXT,
    deleted_by INTEGER REFERENCES users(id)
);

-- The current version, field by field. source is 'human' for a field the auditor changed.
CREATE TABLE IF NOT EXISTS audit_revision_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL REFERENCES audit_results(id),
    section TEXT NOT NULL CHECK (length(section) = 1),
    record_type TEXT CHECK (record_type IN ('anamnesis', 'evolution')),
    field TEXT NOT NULL,
    value TEXT,
    status TEXT NOT NULL CHECK (status IN ('conforme', 'nao_conforme', 'nao_registrado', 'nao_se_aplica')),
    source TEXT NOT NULL CHECK (source IN ('rule', 'ai', 'ai_null', 'ai_failed', 'human')),
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_revision_fields_unique
    ON audit_revision_fields(audit_id, section, IFNULL(record_type, ''), field);

-- Append-only log of what people did: edits, approvals, revoked approvals, deletes and restores.
-- Approval state is derived from this table, never stored.
CREATE TABLE IF NOT EXISTS audit_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL REFERENCES audit_results(id),
    action TEXT NOT NULL CHECK (action IN ('field_edit', 'approve', 'revoke_approval', 'delete', 'restore')),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    section TEXT,
    record_type TEXT,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    old_status TEXT,
    new_status TEXT,
    revision_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_history_audit ON audit_history(audit_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_history_user ON audit_history(user_id, id);

-- Who did what in the system, without any clinical content. user_id is NULL for events with no
-- authenticated user (a failed login); email is then the address that was tried.
CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    email TEXT,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_log_user ON access_log(user_id, id);

-- One row per finished audit and per recipient: whoever submitted it and every active
-- administrator. Never carries clinical content: only ids, the record number to display and a
-- short generic reason. read_at is NULL while unread; read ones are purged after 30 days.
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('audit_done', 'audit_partial', 'audit_failed')),
    job_id TEXT NOT NULL,
    batch_id TEXT,
    audit_id INTEGER REFERENCES audit_results(id),
    record_number_display TEXT,
    detail TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_job ON notifications(user_id, job_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, id);
