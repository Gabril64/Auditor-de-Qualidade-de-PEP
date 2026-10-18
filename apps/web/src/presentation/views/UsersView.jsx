import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { createUser, fetchUsers, resetUserPassword, updateUser } from '../../data/usersClient.js';

const ROLE_LABELS = { admin: 'Administrador', auditor: 'Auditor' };
const WHEN = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)',
  fontSize: 13, padding: '8px 10px', minWidth: 0,
};
const buttonStyle = {
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
  borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
};
const primaryStyle = { ...buttonStyle, background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--on-accent)', fontWeight: 600 };

/** The temporary password is shown once; the administrator hands it over. */
function PasswordNotice({ notice, onClose }) {
  return (
    <div role="status" style={{ background: 'var(--yellow-bg)', border: '1px solid color-mix(in srgb, var(--yellow) 38%, transparent)', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        Senha temporária de <b>{notice.name}</b> (aparece só desta vez; a pessoa troca no primeiro acesso):
      </div>
      <code style={{ fontFamily: 'var(--mono)', fontSize: 15, userSelect: 'all' }}>{notice.password}</code>
      <div style={{ marginTop: 10 }}>
        <button onClick={onClose} style={buttonStyle}>Já anotei</button>
      </div>
    </div>
  );
}

export default function UsersView({ currentUser, isMobile }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'auditor' });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** Runs one action, shows its error in place, and refreshes the list when it worked. */
  async function run(action) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setUsers(await fetchUsers());
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(e) {
    e.preventDefault();
    run(async () => {
      const created = await createUser(form);
      setForm({ name: '', email: '', role: 'auditor' });
      if (created.temporary_password) setNotice({ name: created.user.name, password: created.temporary_password });
    });
  }

  const handleReset = (user) => {
    if (!window.confirm(`Gerar uma nova senha para ${user.name}? A atual deixa de valer.`)) return;
    run(async () => setNotice({ name: user.name, password: await resetUserPassword(user.id) }));
  };

  const handleToggleActive = (user) => run(() => updateUser(user.id, { active: !user.active }));
  const handleRole = (user, role) => run(() => updateUser(user.id, { role }));

  const pad = isMobile ? '12px 10px 80px' : '24px 16px';

  return (
    <div style={{ padding: pad, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 20 }}>
        <Icon name="users" size={26} style={{ marginRight: 10 }} />Usuários
      </h1>

      {notice && <PasswordNotice notice={notice} onClose={() => setNotice(null)} />}

      {actionError && (
        <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--red)', marginBottom: 16 }}>
          {actionError}
        </div>
      )}

      <form onSubmit={handleCreate} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text2)', flex: '1 1 160px' }}>
          Nome
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text2)', flex: '1 1 200px' }}>
          E-mail
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text2)' }}>
          Papel
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={inputStyle}>
            <option value="auditor">Auditor</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button type="submit" disabled={busy} style={primaryStyle}>Criar usuário</button>
      </form>

      {loading && <div style={{ color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 13 }}>Carregando usuários...</div>}
      {error && (
        <div style={{ color: 'var(--red)', fontSize: 13 }}>
          Erro ao carregar os usuários: {error} <button onClick={load} style={buttonStyle}>Tentar novamente</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.map((user) => {
          const isSelf = user.id === currentUser.id;
          return (
            <div key={user.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', opacity: user.active ? 1 : 0.6, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {user.name}{isSelf && <span style={{ color: 'var(--text3)', fontWeight: 400 }}> (você)</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>{user.email}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                  {user.active ? ROLE_LABELS[user.role] : 'Desativado'}
                  {user.must_change_password && ' · senha temporária'}
                  {user.last_login ? ` · último acesso ${new Date(user.last_login).toLocaleString('pt-BR', WHEN)}` : ' · nunca entrou'}
                </div>
              </div>
              <select
                aria-label={`Papel de ${user.name}`}
                value={user.role}
                disabled={busy || isSelf}
                onChange={(e) => handleRole(user, e.target.value)}
                style={inputStyle}
              >
                <option value="auditor">Auditor</option>
                <option value="admin">Administrador</option>
              </select>
              <button onClick={() => handleReset(user)} disabled={busy} style={buttonStyle}>Redefinir senha</button>
              <button onClick={() => handleToggleActive(user)} disabled={busy || isSelf} style={buttonStyle}>
                {user.active ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
