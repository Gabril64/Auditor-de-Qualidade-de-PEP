import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAuditFields } from "../domain/auditFields.js";
import type { RawAuditResult } from "../transformer.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Finds db/schema.sql whether running compiled (Docker: dist/db/../../db, since the schema is
 * copied beside dist/ at /app) or from source (local dev/tests: src/db/../../../../db, since this
 * file sits four levels under the repo root: services/producer/src/db). */
function findSchemaPath(): string {
  const candidates = [
    path.join(moduleDir, "..", "..", "db", "schema.sql"),
    path.join(moduleDir, "..", "..", "..", "..", "db", "schema.sql"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`db/schema.sql not found (tried: ${candidates.join(", ")})`);
  }
  return found;
}

function hasTable(db: Database.Database, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === column);
}

/** `audit_results` used to have a FOREIGN KEY into a `batches` table that no longer exists. SQLite
 * cannot drop a foreign key with ALTER TABLE, so the table is rebuilt without it. A no-op on a
 * database that never had `batches`, or already migrated. */
function dropBatchesForeignKey(db: Database.Database): void {
  const hasForeignKey = (db.pragma("foreign_key_list(audit_results)") as unknown[]).length > 0;
  if (!hasForeignKey && !hasTable(db, "batches")) return;

  const columns = "id, batch_id, job_id, record_number, record_number_display, encounter, audit_data, conformity_percent, status, created_at";
  db.pragma("foreign_keys = OFF");
  db.exec(`
    BEGIN;
    CREATE TABLE audit_results_new (
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
    INSERT INTO audit_results_new (${columns}) SELECT ${columns} FROM audit_results;
    DROP TABLE audit_results;
    ALTER TABLE audit_results_new RENAME TO audit_results;
    DROP TABLE IF EXISTS batches;
    COMMIT;
  `);
  db.pragma("foreign_keys = ON");
}

/** Databases seeded by the old `worker/usuarios.py` have a `users` table with Portuguese column
 * names. Renames them to the English names in db/schema.sql; a no-op once already renamed. */
function renameLegacyUserColumns(db: Database.Database): void {
  if (!hasTable(db, "users") || !hasColumn(db, "users", "nome")) return;

  const renames: Array<[string, string]> = [
    ["nome", "name"],
    ["senha_hash", "password_hash"],
    ["papel", "role"],
    ["ativo", "active"],
    ["deve_trocar_senha", "must_change_password"],
    ["criado_por", "created_by"],
    ["criado_em", "created_at"],
    ["ultimo_login", "last_login"],
  ];
  db.exec("BEGIN;");
  for (const [from, to] of renames) {
    if (hasColumn(db, "users", from)) {
      db.exec(`ALTER TABLE users RENAME COLUMN ${from} TO ${to};`);
    }
  }
  db.exec("COMMIT;");
}

/** Audits stored before `audit_fields` existed have no field rows. Fills them from the stored
 * audit JSON; a no-op once every audit has its fields. */
function backfillAuditFields(db: Database.Database): void {
  const pending = db
    .prepare("SELECT id, audit_data FROM audit_results WHERE id NOT IN (SELECT DISTINCT audit_id FROM audit_fields)")
    .all() as Array<{ id: number; audit_data: string }>;
  if (pending.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO audit_fields (audit_id, section, record_type, field, value, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const audit of pending) {
      const rows = extractAuditFields(JSON.parse(audit.audit_data) as RawAuditResult);
      for (const row of rows) {
        insert.run(audit.id, row.section, row.record_type, row.field, row.value, row.status, row.source);
      }
    }
  })();
}

/** Applies db/schema.sql (idempotent: CREATE TABLE/INDEX IF NOT EXISTS), then the one-time fixes
 * a database created by the old Python schema needs. Safe to call on every startup. */
export function migrate(db: Database.Database): void {
  dropBatchesForeignKey(db);
  db.exec(fs.readFileSync(findSchemaPath(), "utf-8"));
  renameLegacyUserColumns(db);
  backfillAuditFields(db);
}
