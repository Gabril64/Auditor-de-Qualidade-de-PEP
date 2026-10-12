import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "../errorMessage.js";
import { migrate } from "./migrate.js";

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(), "..", "data", "auditor.db");

let connection: Database.Database | null = null;

/** Opens the shared SQLite connection, applying the schema and any pending migration on the
 * first call. Returns null (logging the error) if the database cannot be opened. */
export function getDb(): Database.Database | null {
  if (connection) return connection;

  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const opened = new Database(DB_PATH);
    opened.pragma("journal_mode = WAL");
    opened.pragma("foreign_keys = ON");
    opened.pragma("busy_timeout = 5000");
    migrate(opened);
    connection = opened;
    console.log(`[DB] SQLite initialized at ${DB_PATH}`);
    return connection;
  } catch (error) {
    console.error(`[DB] Failed to connect to SQLite at ${DB_PATH}:`, errorMessage(error));
    return null;
  }
}

/** Runs `work` in one transaction: it commits if `work` returns and rolls back if it throws. */
export function inTransaction<T>(work: () => T): T {
  const connection = getDb();
  if (!connection) throw new Error("Database unavailable");
  return connection.transaction(work)();
}
