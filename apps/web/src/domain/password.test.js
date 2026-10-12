// Validação do formulário de troca de senha. Roda com:  npm test   (Node >= 22; sem dependência nova)
import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordFormProblem } from "./password.js";

const OK = { current: "provisoria-123", next: "uma-senha-nova-longa", confirmation: "uma-senha-nova-longa" };

test("senha válida: nenhum problema", () => {
  assert.equal(passwordFormProblem(OK), "");
});

test("nova senha curta demais", () => {
  assert.match(passwordFormProblem({ ...OK, next: "curta", confirmation: "curta" }), /pelo menos 10/);
});

test("nova senha igual à atual", () => {
  const same = "mesma-senha-longa";
  assert.match(passwordFormProblem({ current: same, next: same, confirmation: same }), /diferente/);
});

test("confirmação diferente", () => {
  assert.match(passwordFormProblem({ ...OK, confirmation: "outra-coisa-longa" }), /confirmação/);
});
