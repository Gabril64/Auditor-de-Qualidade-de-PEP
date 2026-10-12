import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findUserById, type Role, type UserRow } from "../repositories/users.js";
import { parseCookies, SESSION_COOKIE } from "./cookies.js";
import { readSession } from "./sessions.js";

export interface AuthContext {
  user: UserRow;
  sessionId: string;
  csrfToken: string;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_WHILE_PASSWORD_PENDING = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);

/** The authenticated user of the current request. Only valid after `authenticate` ran. */
export function authContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

/** Requires a valid session of an active user, a matching CSRF token on requests that change
 * state, and a completed first-login password change. Everything mounted after it is protected. */
export const authenticate: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = sessionId ? await readSession(sessionId) : null;
  const user = session ? findUserById(session.userId) : null;

  if (!sessionId || !session || !user || user.active !== 1) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (UNSAFE_METHODS.has(req.method) && req.get("x-csrf-token") !== session.csrfToken) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  if (user.must_change_password === 1 && !ALLOWED_WHILE_PASSWORD_PENDING.has(req.path)) {
    res.status(403).json({ error: "Password change required" });
    return;
  }

  res.locals.auth = { user, sessionId, csrfToken: session.csrfToken } satisfies AuthContext;
  next();
};

export function requireRole(role: Role): RequestHandler {
  return (_req, res, next) => {
    if (authContext(res).user.role !== role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
