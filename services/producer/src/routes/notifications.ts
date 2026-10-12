import { Router } from "express";
import { authContext } from "../auth/middleware.js";
import { HttpError } from "../errors.js";
import { countUnread, listNotifications, markAllRead, markRead } from "../repositories/notifications.js";
import { fail } from "./respond.js";

export const notificationsRouter = Router();

notificationsRouter.get("/api/notifications", (req, res) => {
  try {
    const { user } = authContext(res);
    const after = req.query.after === undefined ? null : Number(req.query.after);
    if (after !== null && (!Number.isInteger(after) || after < 0)) {
      throw new HttpError(400, "'after' must be a non-negative integer");
    }

    res.json({ notifications: listNotifications(user.id, after), unread_count: countUnread(user.id) });
  } catch (error) {
    fail(res, 500, "fetching notifications", error);
  }
});

notificationsRouter.post("/api/notifications/read-all", (_req, res) => {
  try {
    const { user } = authContext(res);
    markAllRead(user.id, new Date().toISOString());
    res.json({ unread_count: 0 });
  } catch (error) {
    fail(res, 500, "marking notifications as read", error);
  }
});

notificationsRouter.post("/api/notifications/:id/read", (req, res) => {
  try {
    const { user } = authContext(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !markRead(user.id, id, new Date().toISOString())) {
      throw new HttpError(404, "Notification not found");
    }
    res.json({ unread_count: countUnread(user.id) });
  } catch (error) {
    fail(res, 500, "marking notification as read", error);
  }
});
