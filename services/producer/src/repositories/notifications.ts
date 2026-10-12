import { getDb } from "../db/connection.js";

export type NotificationType = "audit_done" | "audit_partial" | "audit_failed";

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  job_id: string;
  batch_id: string | null;
  audit_id: number | null;
  record_number_display: string | null;
  detail: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NewNotification {
  type: NotificationType;
  jobId: string;
  batchId: string | null;
  auditId: number | null;
  recordNumberDisplay: string | null;
  detail: string | null;
}

const LIST_LIMIT = 100;
const FIRST_PAGE = 50;

function db() {
  const connection = getDb();
  if (!connection) throw new Error("Database unavailable");
  return connection;
}

/** Whoever submitted the job (when still active) plus every active administrator, without repeats. */
export function recipientsOf(jobId: string): number[] {
  const rows = db()
    .prepare(
      `SELECT id FROM users
       WHERE active = 1 AND (role = 'admin' OR id = (SELECT submitted_by FROM raw_patient_records WHERE job_id = ?))`,
    )
    .all(jobId) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

/** Inserts one notification per recipient; a job already notified to a user is left alone. */
export function insertNotifications(userIds: number[], notification: NewNotification, createdAt: string): void {
  const insert = db().prepare(
    `INSERT OR IGNORE INTO notifications
     (user_id, type, job_id, batch_id, audit_id, record_number_display, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const userId of userIds) {
    insert.run(
      userId,
      notification.type,
      notification.jobId,
      notification.batchId,
      notification.auditId,
      notification.recordNumberDisplay,
      notification.detail,
      createdAt,
    );
  }
}

/** The notifications after `afterId`, oldest first; without it, the latest ones. */
export function listNotifications(userId: number, afterId: number | null): NotificationRow[] {
  if (afterId !== null) {
    return db()
      .prepare("SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?")
      .all(userId, afterId, LIST_LIMIT) as NotificationRow[];
  }
  const latest = db()
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, FIRST_PAGE) as NotificationRow[];
  return latest.reverse();
}

export function countUnread(userId: number): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL")
    .get(userId) as { n: number };
  return row.n;
}

/** Marks one of the user's notifications as read. False when it does not exist or is not theirs. */
export function markRead(userId: number, id: number, readAt: string): boolean {
  const own = db().prepare("SELECT 1 FROM notifications WHERE id = ? AND user_id = ?").get(id, userId);
  if (!own) return false;
  db().prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL").run(readAt, id);
  return true;
}

export function markAllRead(userId: number, readAt: string): number {
  return db()
    .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .run(readAt, userId).changes;
}

/** Deletes the notifications read before `cutoff`; unread ones are always kept. */
export function purgeReadBefore(cutoff: string): number {
  return db().prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?").run(cutoff).changes;
}
