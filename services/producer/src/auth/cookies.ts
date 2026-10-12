export const SESSION_COOKIE = "session";

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.APP_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearedSessionCookie(): string {
  return sessionCookie("", 0);
}
