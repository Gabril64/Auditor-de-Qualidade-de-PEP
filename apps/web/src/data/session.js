/**
 * Session plumbing shared by every API call: the CSRF token the server issued at login, sent on
 * requests that change state, and one place to react when the server says the session is gone.
 *
 * The token lives in memory only. After a page reload, GET /api/auth/me returns it again.
 */

const API_BASE = import.meta.env?.VITE_API_URL || "";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let csrfToken = null;
let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, { status = 0, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function setCsrfToken(token) {
  csrfToken = token;
}

/** Registers what to do when a request comes back 401 (session expired or ended elsewhere). */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

/**
 * fetch against the API with the session cookie and the CSRF header attached.
 * @param {string} path - Path starting with "/"
 * @param {RequestInit & {skipUnauthorizedHandler?: boolean}} options
 */
export async function apiFetch(path, options = {}) {
  const { skipUnauthorizedHandler = false, ...init } = options;
  const method = (init.method || "GET").toUpperCase();
  const headers = { ...(init.headers || {}) };
  if (!SAFE_METHODS.has(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const res = await fetch(`${API_BASE}${path}`, { ...init, method, headers, credentials: "same-origin" });

  if (res.status === 401 && !skipUnauthorizedHandler) {
    csrfToken = null;
    if (unauthorizedHandler) unauthorizedHandler();
  }

  return res;
}
