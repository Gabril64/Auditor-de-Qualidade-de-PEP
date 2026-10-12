import { getDb } from "../db/connection.js";
import { errorMessage } from "../errorMessage.js";

export interface AccessEvent {
  event: string;
  userId?: number | null;
  email?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/** Records who did what. Never carries clinical content, and never fails the request it describes. */
export function logAccess(entry: AccessEvent): void {
  try {
    getDb()
      ?.prepare("INSERT INTO access_log (event, user_id, email, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        entry.event,
        entry.userId ?? null,
        entry.email ?? null,
        entry.detail ?? null,
        entry.ip ?? null,
        new Date().toISOString(),
      );
  } catch (error) {
    console.error("[AccessLog] Could not record the event:", errorMessage(error));
  }
}
