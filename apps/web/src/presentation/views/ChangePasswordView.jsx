import React, { useState } from 'react';
import { changePassword } from '../../data/authClient.js';
import { MIN_PASSWORD_LENGTH, passwordFormProblem } from '../../domain/password.js';
import AuthCard, { Field, FormError, PrimaryButton } from '../components/AuthCard.jsx';

/** Shown right after a login with a temporary password, before anything else can be used. */
export default function ChangePasswordView({ user, onChanged, onLogout }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;

    const problem = passwordFormProblem({ current, next, confirmation });
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      onChanged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Defina uma nova senha"
      subtitle={`${user.name}, a senha da sua conta é provisória. Escolha uma senha só sua para continuar.`}
    >
      <form onSubmit={handleSubmit}>
        <FormError>{error}</FormError>
        <Field
          id="current-password"
          label="Senha atual (a provisória)"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          id="new-password"
          label={`Nova senha (mínimo de ${MIN_PASSWORD_LENGTH} caracteres)`}
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Field
          id="confirm-password"
          label="Repita a nova senha"
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <PrimaryButton busy={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</PrimaryButton>
      </form>
      <button
        type="button"
        onClick={onLogout}
        style={{
          width: '100%',
          marginTop: 14,
          background: 'none',
          border: 'none',
          color: 'var(--text2)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Sair
      </button>
    </AuthCard>
  );
}
