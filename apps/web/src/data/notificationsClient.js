/** Notification calls: what finished for the signed-in user, and what they have already seen. */

import { ApiError, apiFetch } from "./session.js";

async function failed(res) {
  const err = await res.json().catch(() => ({}));
  return new ApiError(err.error || `HTTP ${res.status}`, { status: res.status });
}

/**
 * @param {number|null} after - Id of the last notification already held; without it, the latest ones
 * @returns {Promise<{notifications: Array<object>, unread_count: number}>}
 */
export async function fetchNotifications(after = null) {
  const res = await apiFetch(after === null ? "/api/notifications" : `/api/notifications?after=${after}`);
  if (!res.ok) throw await failed(res);
  return res.json();
}

export async function markNotificationRead(id) {
  const res = await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
  if (!res.ok) throw await failed(res);
  return res.json();
}

export async function markAllNotificationsRead() {
  const res = await apiFetch("/api/notifications/read-all", { method: "POST" });
  if (!res.ok) throw await failed(res);
  return res.json();
}
