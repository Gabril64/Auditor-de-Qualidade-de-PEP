import { randomBytes } from "node:crypto";
import { redis } from "../queue/redisClient.js";

export const SESSION_IDLE_SECONDS = 8 * 60 * 60;
const KEY_PREFIX = "sessao:";

export interface Session {
  userId: number;
  csrfToken: string;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: number): Promise<{ id: string; session: Session }> {
  const id = newToken();
  const session: Session = { userId, csrfToken: newToken() };
  await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(session), { EX: SESSION_IDLE_SECONDS });
  return { id, session };
}

/** Reads a session and pushes its expiry forward, so it only ends after a period of inactivity. */
export async function readSession(id: string): Promise<Session | null> {
  const key = `${KEY_PREFIX}${id}`;
  const value = await redis.get(key);
  if (!value) return null;
  await redis.expire(key, SESSION_IDLE_SECONDS);
  return JSON.parse(value) as Session;
}

export async function destroySession(id: string): Promise<void> {
  await redis.del(`${KEY_PREFIX}${id}`);
}
