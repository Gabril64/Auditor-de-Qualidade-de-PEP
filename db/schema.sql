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
