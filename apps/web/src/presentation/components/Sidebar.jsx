import React from 'react';
import Icon from './Icon.jsx';

export default function Sidebar({ activeView, setActiveView, isMobile, isAdmin = false }) {
  const menuItems = [
    { id: 'audit', label: 'Auditoria de PEP', mobileLabel: 'Auditoria', icon: 'clipboard', desc: 'Análise ativa de registros' },
    { id: 'dashboard', label: 'Dashboard Geral', mobileLabel: 'Dashboard', icon: 'chart', desc: 'Métricas e relatórios gerais' },
    { id: 'explanation', label: 'Como Funciona', mobileLabel: 'Como Funciona', icon: 'activity', desc: 'Regras CFM e LGPD' }
  ];
  if (isAdmin) {
    menuItems.push({ id: 'users', label: 'Usuários', mobileLabel: 'Usuários', icon: 'users', desc: 'Contas e papéis' });
  }

  if (isMobile) {
    return (
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60px',
        background: 'var(--bg2)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        zIndex: 100,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.3)'
      }}>
        {menuItems.map(item => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              style={{
                background: 'none',
                border: 'none',
                color: isActive ? 'var(--accent)' : 'var(--text2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                fontSize: 10,
                fontFamily: 'var(--sans)',
                fontWeight: isActive ? 600 : 400,
                flex: 1,
                padding: '8px 0',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ fontSize: 18 }}><Icon name={item.icon} size={20} /></span>
              <span style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{item.mobileLabel}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <aside style={{
      width: '260px',
      background: 'var(--bg2)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0,
      flexShrink: 0
    }}>
      {/* Brand Header */}
      <div style={{
        padding: '24px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid var(--border)'
      }}>
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
          <Icon name="activity" size={18} />
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.02em' }}>Auditor de Qualidade</div>
          <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>VERSÃO 1.2.0</div>
        </div>
      </div>

      {/* Nav links */}
      <nav style={{
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flex: 1
      }}>
        {menuItems.map(item => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              style={{
                background: isActive ? 'var(--bg3)' : 'transparent',
                border: '1px solid',
                borderColor: isActive ? 'var(--border)' : 'transparent',
                borderRadius: 10,
                color: isActive ? 'var(--text)' : 'var(--text2)',
                padding: '12px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                transition: 'all 0.15s ease',
                width: '100%'
              }}
              onMouseOver={e => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text)';
                  e.currentTarget.style.background = 'var(--bg3)';
                }
              }}
              onMouseOut={e => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text2)';
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{
                fontSize: 18,
                background: isActive ? 'var(--bg4)' : 'transparent',
                padding: isActive ? '4px' : '0',
                borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: isActive ? 28 : 'auto',
                height: isActive ? 28 : 'auto'
              }}><Icon name={item.icon} size={isActive ? 16 : 20} /></span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 500 }}>{item.label}</span>
                <span style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{item.desc}</span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Footer info */}
      <div style={{
        padding: '20px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg3)',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
      </div>
    </aside>
  );
}
