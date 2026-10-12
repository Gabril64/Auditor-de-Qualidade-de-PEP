import React, { useState } from 'react';
import { login } from '../../data/authClient.js';
import AuthCard, { Field, FormError, FormNotice, PrimaryButton } from '../components/AuthCard.jsx';

function waitMessage(error) {
  if (error.status !== 429 || !error.retryAfterSeconds) return error.message;
  const minutes = Math.ceil(error.retryAfterSeconds / 60);
  return `Muitas tentativas. Tente de novo em cerca de ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
}

export default function LoginView({ onLoggedIn, notice }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const user = await login(email.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      setError(waitMessage(err));
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Entrar" subtitle="Use o e-mail e a senha da sua conta.">
      <form onSubmit={handleSubmit}>
        <FormNotice>{notice}</FormNotice>
        <FormError>{error}</FormError>
        <Field
          id="email"
          label="E-mail"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="password"
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PrimaryButton busy={busy}>{busy ? 'Entrando…' : 'Entrar'}</PrimaryButton>
      </form>
    </AuthCard>
  );
}
