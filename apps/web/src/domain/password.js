export const MIN_PASSWORD_LENGTH = 10;

/**
 * The first problem with the password change form, or '' when it can be sent.
 * The server enforces the same rule; this only answers sooner and in Portuguese.
 */
export function passwordFormProblem({ current, next, confirmation }) {
  if (next.length < MIN_PASSWORD_LENGTH) return `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (next === current) return 'A nova senha deve ser diferente da senha atual.';
  if (next !== confirmation) return 'A confirmação não é igual à nova senha.';
  return '';
}
