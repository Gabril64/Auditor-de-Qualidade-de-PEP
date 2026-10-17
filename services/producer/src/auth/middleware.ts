import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findUserById, type Role, type UserRow } from "../repositories/users.js";
import { parseCookies, SESSION_COOKIE } from "./cookies.js";
import {
  configuredServiceToken,
  findServiceUser,
  matchesServiceToken,
  SERVICE_TOKEN_HEADER,
  serviceUserEmail,
} from "./serviceToken.js";
import { readSession } from "./sessions.js";

export interface AuthContext {
  user: UserRow;
  /** Null when the request authenticated with the service token, which has no session. */
  sessionId: string | null;
  csrfToken: string | null;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_WHILE_PASSWORD_PENDING = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/change-password"]);

/** The authenticated user of the current request. Only valid after `authenticate` ran. */
export function authContext(res: Response): AuthContext {
  return res.locals.auth as AuthContext;
}

/** Requires a valid session of an active user, a matching CSRF token on requests that change
 * state, and a completed first-login password change. Everything mounted after it is protected.
 *
 * Non-interactive callers (the model-evaluation notebook, other local programs) may instead send
 * the service token in `X-Api-Token`. That path exists only while `EVAL_API_TOKEN` is set, needs
 * no CSRF token since it carries no cookie, and acts as the service account — an auditor, so it
 * can submit batches and read results, but not delete or restore audits. */
export const authenticate: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const presentedToken = req.get(SERVICE_TOKEN_HEADER);
  if (presentedToken !== undefined) {
    if (!matchesServiceToken(presentedToken)) {
      const reason = configuredServiceToken() ? "Invalid service token" : "Service token authentication is disabled";
      res.status(401).json({ error: reason });
      return;
    }

    const serviceUser = findServiceUser();
    if (!serviceUser || serviceUser.active !== 1) {
      res.status(401).json({
        error: `The service account ${serviceUserEmail()} does not exist or is inactive. Restart the Producer to recreate it.`,
      });
      return;
    }

    res.locals.auth = { user: serviceUser, sessionId: null, csrfToken: null } satisfies AuthContext;
    next();
    return;
  }

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
