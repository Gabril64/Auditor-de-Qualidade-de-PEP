import { retryAfterSeconds, recordFailure, recordSuccess } from "../auth/loginLimiter.js";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "../auth/passwords.js";
import { createSession, destroySession } from "../auth/sessions.js";
import { HttpError } from "../errors.js";
import { logAccess } from "../repositories/accessLog.js";
import {
  findUserByEmail,
  findUserById,
  setUserPassword,
  toPublicUser,
  touchLastLogin,
  type PublicUser,
} from "../repositories/users.js";

export interface LoginResult {
  user: PublicUser;
  sessionId: string;
  csrfToken: string;
}

const INVALID_CREDENTIALS = "Invalid e-mail or password";

/** Checks the credentials and opens a session. The answer is the same for an unknown e-mail, an
 * inactive account and a wrong password, and failures are counted per e-mail and per address. */
export async function login(emailInput: unknown, passwordInput: unknown, ip: string): Promise<LoginResult> {
  if (typeof emailInput !== "string" || typeof passwordInput !== "string" || !emailInput.trim() || !passwordInput) {
    throw new HttpError(400, "E-mail and password are required");
  }
  const email = emailInput.trim();

  const wait = retryAfterSeconds(email, ip);
  if (wait > 0) {
    throw new HttpError(429, "Too many attempts, try again later", wait);
  }

  const user = findUserByEmail(email);
  const valid = user && user.active === 1 ? await verifyPassword(user.password_hash, passwordInput) : false;
  if (!user || !valid) {
    if (!user) await verifyAgainstDummy(passwordInput);
    recordFailure(email, ip);
    logAccess({ event: "login_failed", userId: user?.id ?? null, email, ip });
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  recordSuccess(email);
  touchLastLogin(user.id);
  const { id, session } = await createSession(user.id);
  logAccess({ event: "login", userId: user.id, email: user.email, ip });

  return { user: toPublicUser(findUserById(user.id) ?? user), sessionId: id, csrfToken: session.csrfToken };
}

export async function logout(userId: number, email: string, sessionId: string): Promise<void> {
  await destroySession(sessionId);
  logAccess({ event: "logout", userId, email });
}

export async function changePassword(userId: number, current: unknown, next: unknown): Promise<void> {
  const user = findUserById(userId);
  if (!user || typeof current !== "string" || !(await verifyPassword(user.password_hash, current))) {
    throw new HttpError(400, "Current password is incorrect");
  }

  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  if (next === current) throw new HttpError(400, "The new password must differ from the current one");

  setUserPassword(userId, await hashPassword(next as string), false);
  logAccess({ event: "password_changed", userId, email: user.email });
}
