import { generatePassword, hashPassword, passwordProblem } from "../auth/passwords.js";
import { HttpError } from "../errors.js";
import { logAccess } from "../repositories/accessLog.js";
import {
  countActiveAdmins,
  findUserByEmail,
  findUserById,
  insertUser,
  listUsers,
  setUserPassword,
  toPublicUser,
  updateUserProfile,
  type PublicUser,
  type Role,
} from "../repositories/users.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly Role[] = ["auditor", "admin"];

export interface CreatedUser {
  user: PublicUser;
  temporary_password: string | null;
}

export function listAllUsers(): PublicUser[] {
  return listUsers().map(toPublicUser);
}

function requireUser(id: number) {
  const user = findUserById(id);
  if (!user) throw new HttpError(404, "User not found");
  return user;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Creates an account that must change its password on first login. When no password is given,
 * one is generated and returned once. */
export async function createAccount(input: Record<string, unknown>, actorId: number): Promise<CreatedUser> {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, "A valid e-mail is required");
  if (!name) throw new HttpError(400, "Name is required");
  if (!isRole(input.role)) throw new HttpError(400, "Role must be 'auditor' or 'admin'");
  if (findUserByEmail(email)) throw new HttpError(409, "E-mail already registered");

  const generated = input.password === undefined || input.password === null || input.password === "";
  const password = generated ? generatePassword() : input.password;
  const problem = generated ? null : passwordProblem(password);
  if (problem) throw new HttpError(400, problem);

  const id = insertUser({
    email,
    name,
    passwordHash: await hashPassword(password as string),
    role: input.role,
    createdBy: actorId,
  });
  logAccess({ event: "user_created", userId: actorId, detail: `user ${id} (${input.role})` });

  return { user: toPublicUser(requireUser(id)), temporary_password: generated ? (password as string) : null };
}

/** Changes name, role or active flag. The last active administrator can be neither demoted nor deactivated. */
export function updateAccount(id: number, input: Record<string, unknown>, actorId: number): PublicUser {
  const target = requireUser(id);
  const fields: { name?: string; role?: Role; active?: boolean } = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim()) throw new HttpError(400, "Name is required");
    fields.name = input.name.trim();
  }
  if (input.role !== undefined) {
    if (!isRole(input.role)) throw new HttpError(400, "Role must be 'auditor' or 'admin'");
    fields.role = input.role;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new HttpError(400, "'active' must be true or false");
    fields.active = input.active;
  }

  const losesAdmin = target.role === "admin" && target.active === 1 && (fields.role === "auditor" || fields.active === false);
  if (losesAdmin && countActiveAdmins() <= 1) {
    throw new HttpError(409, "The last active administrator cannot be demoted or deactivated");
  }

  updateUserProfile(id, fields);
  logAccess({ event: "user_updated", userId: actorId, detail: `user ${id}: ${Object.keys(fields).join(", ")}` });
  return toPublicUser(requireUser(id));
}

/** Sets a new generated password, returned once, and makes the user change it at the next login. */
export async function resetAccountPassword(id: number, actorId: number): Promise<string> {
  requireUser(id);
  const password = generatePassword();
  setUserPassword(id, await hashPassword(password), true);
  logAccess({ event: "password_reset", userId: actorId, detail: `user ${id}` });
  return password;
}
