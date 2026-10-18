/** User management calls (administrators only). */

import { ApiError, apiFetch } from "./session.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

const KNOWN_ERRORS = [
  ["E-mail already registered", "Já existe uma conta com este e-mail."],
  ["valid e-mail", "Informe um e-mail válido."],
  ["Name is required", "Informe o nome."],
  ["last active administrator", "Não dá para rebaixar ou desativar o último administrador ativo."],
];

async function failed(res) {
  const { error = "" } = await res.json().catch(() => ({}));
  const known = KNOWN_ERRORS.find(([fragment]) => error.includes(fragment));
  return new ApiError(known ? known[1] : error || `HTTP ${res.status}`, { status: res.status });
}

/** @returns {Promise<Array<object>>} */
export async function fetchUsers() {
  const res = await apiFetch("/api/users");
  if (!res.ok) throw await failed(res);
  return (await res.json()).users;
}

/**
 * Creates an account that must change its password at the first login.
 * @returns {Promise<{user: object, temporary_password: string|null}>} The generated password is shown once
 */
export async function createUser({ email, name, role }) {
  const res = await apiFetch("/api/users", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, name, role }),
  });
  if (!res.ok) throw await failed(res);
  return res.json();
}

/** @param {{name?: string, role?: string, active?: boolean}} fields */
export async function updateUser(id, fields) {
  const res = await apiFetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw await failed(res);
  return (await res.json()).user;
}

/** @returns {Promise<string>} The new temporary password, shown once */
export async function resetUserPassword(id) {
  const res = await apiFetch(`/api/users/${id}/reset-password`, { method: "POST" });
  if (!res.ok) throw await failed(res);
  return (await res.json()).temporary_password;
}
