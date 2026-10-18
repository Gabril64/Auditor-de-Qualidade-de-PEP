// Validação do formulário de troca de senha. Roda com:  npm test   (Node >= 22; sem dependência nova)
import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordFormProblem } from "./password.js";

const OK = { current: "provisoria-123", next: "uma-senha-nova-longa", confirmation: "uma-senha-nova-longa" };

test("valid password: no problem", () => {
  assert.equal(passwordFormProblem(OK), "");
});

test("new password too short", () => {
  assert.match(passwordFormProblem({ ...OK, next: "curta", confirmation: "curta" }), /pelo menos 10/);
});

test("new password equal to the current one", () => {
  const same = "mesma-senha-longa";
  assert.match(passwordFormProblem({ current: same, next: same, confirmation: same }), /diferente/);
});

test("confirmation does not match", () => {
  assert.match(passwordFormProblem({ ...OK, confirmation: "outra-coisa-longa" }), /confirmação/);
});
