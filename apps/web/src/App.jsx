import React, { useState, useEffect } from 'react';
import Sidebar from './presentation/components/Sidebar.jsx';
import AuditView from './presentation/views/AuditView.jsx';
import DashboardView from './presentation/views/DashboardView.jsx';
import ExplanationView from './presentation/views/ExplanationView.jsx';
import AuditDetailView from './presentation/views/AuditDetailView.jsx';
import LoginView from './presentation/views/LoginView.jsx';
import ChangePasswordView from './presentation/views/ChangePasswordView.jsx';
import UsersView from './presentation/views/UsersView.jsx';
import NotificationBell from './presentation/components/NotificationBell.jsx';
import { fetchSession, logout } from './data/authClient.js';
import { onUnauthorized } from './data/session.js';

const SESSION_EXPIRED = 'Sua sessão expirou. Entre novamente.';
const LOADING = { status: 'loading', user: null, notice: '' };
const UNAVAILABLE = { status: 'unavailable', user: null, notice: '' };

const sessionOf = (user) =>
  user ? { status: 'ready', user, notice: '' } : { status: 'anonymous', user: null, notice: '' };

export default function App() {
  // status: 'loading' | 'anonymous' | 'unavailable' | 'ready'
  const [session, setSession] = useState(LOADING);
  const [activeView, setActiveView] = useState('audit'); // 'audit', 'dashboard', 'details', 'explanation', 'users'
  const [selectedAuditId, setSelectedAuditId] = useState(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 600 : false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 600);
    const handleResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    onUnauthorized(() => setSession({ status: 'anonymous', user: null, notice: SESSION_EXPIRED }));

    let active = true;
    fetchSession()
      .then((user) => active && setSession(sessionOf(user)))
      .catch(() => active && setSession(UNAVAILABLE));
    return () => {
      active = false;
    };
  }, []);

  const loadSession = () => {
    setSession(LOADING);
    fetchSession()
      .then((user) => setSession(sessionOf(user)))
      .catch(() => setSession(UNAVAILABLE));
  };

  const handleLogout = async () => {
    await logout();
    setActiveView('audit');
    setSession({ status: 'anonymous', user: null, notice: '' });
  };

  const handleSelectAuditFromDashboard = (audit) => {
    setSelectedAuditId(audit.id);
    setActiveView('details');
  };

  if (session.status === 'loading') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;
  }

  if (session.status === 'unavailable') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexDirection: 'column' }}>
        <div style={{ color: 'var(--text2)', fontSize: 14 }}>Não foi possível falar com o servidor.</div>
        <button onClick={loadSession} style={{ padding: '8px 16px', cursor: 'pointer' }}>Tentar de novo</button>
      </div>
    );
  }

  if (session.status === 'anonymous') {
    return (
      <LoginView
        notice={session.notice}
        onLoggedIn={(user) => setSession({ status: 'ready', user, notice: '' })}
      />
    );
  }

  if (session.user.must_change_password) {
    return <ChangePasswordView user={session.user} onChanged={loadSession} onLogout={handleLogout} />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      background: 'var(--bg)',
      color: 'var(--text)'
    }}>
      {/* Sidebar Navigation */}
      <Sidebar activeView={activeView === 'details' ? 'dashboard' : activeView} setActiveView={setActiveView} isMobile={isMobile} isAdmin={session.user.role === 'admin'} />

      {/* Main View Container */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: isMobile ? 'auto' : '100vh',
        overflowY: isMobile ? 'visible' : 'auto'
      }}>

        {/* Top Header for mobile and branding */}
        <header style={{
          borderBottom: '1px solid var(--border)',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--bg2)',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          {isMobile && (
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, var(--accent) 0%, #0066aa 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17
            }}>
              ⚕
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>Auditor de Prontuários</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>CFM · LGPD · RDC 63/2011</div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <NotificationBell onOpenAudit={handleSelectAuditFromDashboard} />
            {!isMobile && <span style={{ fontSize: 12, color: 'var(--text2)' }}>{session.user.name}</span>}
            <button
              onClick={handleLogout}
              style={{
                background: 'none',
                border: '1px solid var(--border2)',
                borderRadius: 8,
                color: 'var(--text2)',
                padding: '6px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Sair
            </button>
          </div>
        </header>

        {/* View render area */}
        <main style={{ flex: 1 }}>
          {/* Stays mounted when hidden, so a batch in progress and its results survive a change of screen. */}
          <div style={{ display: activeView === 'audit' ? 'block' : 'none' }}>
            <AuditView
              isMobile={isMobile}
            />
          </div>
          {activeView === 'dashboard' && (
            <DashboardView
              onSelectAudit={handleSelectAuditFromDashboard}
              user={session.user}
              isMobile={isMobile}
            />
          )}
          {activeView === 'details' && selectedAuditId !== null && (
            <AuditDetailView
              auditId={selectedAuditId}
              user={session.user}
              onBack={() => setActiveView('dashboard')}
              isMobile={isMobile}
            />
          )}
          {activeView === 'users' && session.user.role === 'admin' && (
            <UsersView currentUser={session.user} isMobile={isMobile} />
          )}
          {activeView === 'explanation' && (
            <ExplanationView
              isMobile={isMobile}
            />
          )}
        </main>
      </div>
    </div>
  );
}
