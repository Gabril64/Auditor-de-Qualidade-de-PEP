import argon2 from "argon2";
import { randomBytes } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 10;

let dummyHash: Promise<string> | null = null;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Spends the same time as a real check, so a login for an unknown e-mail answers as slowly as a wrong password. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(await dummyHash, password);
}

export function generatePassword(): string {
  return randomBytes(15).toString("base64url");
}

/** Returns the reason the password is not acceptable, or null when it is. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must have at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
