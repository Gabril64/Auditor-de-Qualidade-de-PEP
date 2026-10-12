import { Router } from "express";
import { authContext } from "../auth/middleware.js";
import { clearedSessionCookie, sessionCookie } from "../auth/cookies.js";
import { SESSION_IDLE_SECONDS } from "../auth/sessions.js";
import { toPublicUser } from "../repositories/users.js";
import { changePassword, login, logout } from "../services/auth.js";
import { bodyOf, fail } from "./respond.js";

/** Routes reachable without a session. */
export const publicAuthRouter = Router();

publicAuthRouter.post("/api/auth/login", async (req, res) => {
  try {
    const body = bodyOf(req.body);
    const result = await login(body.email, body.password, req.ip ?? "unknown");
    res.setHeader("Set-Cookie", sessionCookie(result.sessionId, SESSION_IDLE_SECONDS));
    res.json({ user: result.user, csrf_token: result.csrfToken });
  } catch (error) {
    fail(res, 500, "logging in", error);
  }
});

/** Routes for the signed-in user; mounted after `authenticate`. */
export const authRouter = Router();

authRouter.get("/api/auth/me", (_req, res) => {
  const { user, csrfToken } = authContext(res);
  res.json({ user: toPublicUser(user), csrf_token: csrfToken });
});

authRouter.post("/api/auth/logout", async (_req, res) => {
  try {
    const { user, sessionId } = authContext(res);
    await logout(user.id, user.email, sessionId);
    res.setHeader("Set-Cookie", clearedSessionCookie());
    res.status(204).end();
  } catch (error) {
    fail(res, 500, "logging out", error);
  }
});

authRouter.post("/api/auth/change-password", async (req, res) => {
  try {
    const body = bodyOf(req.body);
    await changePassword(authContext(res).user.id, body.current_password, body.new_password);
    res.status(204).end();
  } catch (error) {
    fail(res, 500, "changing password", error);
  }
});
