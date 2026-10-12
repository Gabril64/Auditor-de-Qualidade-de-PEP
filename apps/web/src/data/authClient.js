/**
 * Authentication calls: who is signed in, login, logout and the password change.
 * The messages are written for the person reading the screen.
 */

import { ApiError, apiFetch, setCsrfToken } from "./session.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function errorBody(res) {
  return res.json().catch(() => ({}));
}

function retryAfterOf(res) {
  const value = Number(res.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The signed-in user, or null when there is no session. Also recovers the CSRF token after a reload.
 * @returns {Promise<object|null>}
 */
export async function fetchSession() {
  const res = await apiFetch("/api/auth/me", { skipUnauthorizedHandler: true });
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError("Não foi possível falar com o servidor.", { status: res.status });

  const body = await res.json();
  setCsrfToken(body.csrf_token);
  return body.user;
}

/**
 * Signs in. The session itself travels in an HttpOnly cookie the browser keeps.
 * @returns {Promise<object>} The user (id, email, name, role, must_change_password)
 */
export async function login(email, password) {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
    skipUnauthorizedHandler: true,
  });

  if (res.status === 401) {
    throw new ApiError("E-mail ou senha incorretos.", { status: 401 });
  }
  if (res.status === 429) {
    throw new ApiError("Muitas tentativas. Aguarde alguns minutos e tente de novo.", {
      status: 429,
      retryAfterSeconds: retryAfterOf(res),
    });
  }
  if (!res.ok) {
    const { error } = await errorBody(res);
    throw new ApiError(error || "Não foi possível entrar.", { status: res.status });
  }

  const body = await res.json();
  setCsrfToken(body.csrf_token);
  return body.user;
}

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", skipUnauthorizedHandler: true });
  } finally {
    setCsrfToken(null);
  }
}

const PASSWORD_ERRORS = [
  ["Current password is incorrect", "A senha atual está incorreta."],
  ["at least", "A nova senha deve ter pelo menos 10 caracteres."],
  ["must differ", "A nova senha deve ser diferente da atual."],
];

/** Changes the signed-in user's password. Rejects with a message to show on the form. */
export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (res.ok) return;

  const { error = "" } = await errorBody(res);
  const known = PASSWORD_ERRORS.find(([fragment]) => error.includes(fragment));
  throw new ApiError(known ? known[1] : "Não foi possível trocar a senha.", { status: res.status });
}
