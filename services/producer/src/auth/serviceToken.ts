import { randomBytes, timingSafeEqual } from "node:crypto";
import { findUserByEmail, insertUser, type UserRow } from "../repositories/users.js";
import { hashPassword } from "./passwords.js";

const DEFAULT_SERVICE_EMAIL = "evaluation@auditor.local";

export const SERVICE_TOKEN_HEADER = "x-api-token";

/** The e-mail of the non-interactive account that service-token requests act as. */
export function serviceUserEmail(): string {
  return process.env.EVAL_API_USER || DEFAULT_SERVICE_EMAIL;
}

/** The configured token, or null when the service-token path is turned off — which is the
 * default: with no `EVAL_API_TOKEN` in the environment, only a real session authenticates. */
export function configuredServiceToken(): string | null {
  const token = process.env.EVAL_API_TOKEN?.trim();
  return token ? token : null;
}

/** Compares in constant time, so a wrong token never reveals how much of it was right. */
export function matchesServiceToken(presented: string): boolean {
  const expected = configuredServiceToken();
  if (!expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function findServiceUser(): UserRow | null {
  return findUserByEmail(serviceUserEmail());
}

/** Creates the account service-token requests are attributed to, unless it already exists.
 * Its password hash is random and never printed: the account exists only so that batches sent
 * by a script still have an author in the access log, and nobody can ever log into it. */
export async function ensureServiceUser(): Promise<"created" | "existing"> {
  if (findServiceUser()) return "existing";
  insertUser({
    email: serviceUserEmail(),
    name: "Avaliação de modelos",
    passwordHash: await hashPassword(randomBytes(32).toString("hex")),
    role: "auditor",
    createdBy: null,
    mustChangePassword: false,
  });
  return "created";
}
