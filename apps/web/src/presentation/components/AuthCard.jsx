import React from 'react';

const fieldStyle = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border2)',
  borderRadius: 8,
  color: 'var(--text)',
  padding: '11px 12px',
  fontSize: 14,
  fontFamily: 'var(--sans)',
  outline: 'none',
};

/** The centered card the login and the password change share. */
export default function AuthCard({ title, subtitle, children }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: 'var(--bg)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '32px 28px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: 'linear-gradient(135deg, var(--accent) 0%, #0066aa 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 19,
          }}>
            ⚕
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>Auditor de Qualidade</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>CFM · LGPD · RDC 63/2011</div>
          </div>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 20 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/** A labelled input with the card's styling. */
export function Field({ label, id, ...inputProps }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>
        {label}
      </label>
      <input id={id} style={fieldStyle} {...inputProps} />
    </div>
  );
}

export function FormError({ children }) {
  if (!children) return null;
  return (
    <div role="alert" style={{
      background: 'var(--red2)',
      border: '1px solid var(--red)',
      color: 'var(--red)',
      borderRadius: 8,
      padding: '10px 12px',
      fontSize: 13,
      marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

export function FormNotice({ children }) {
  if (!children) return null;
  return (
    <div role="status" style={{
      background: 'var(--yellow2)',
      border: '1px solid var(--yellow)',
      color: 'var(--yellow)',
      borderRadius: 8,
      padding: '10px 12px',
      fontSize: 13,
      marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

export function PrimaryButton({ busy, children, ...buttonProps }) {
  return (
    <button
      type="submit"
      disabled={busy}
      style={{
        width: '100%',
        background: busy ? 'var(--accent2)' : 'var(--accent)',
        color: '#001018',
        border: 'none',
        borderRadius: 8,
        padding: '12px 14px',
        fontSize: 14,
        fontWeight: 600,
        fontFamily: 'var(--sans)',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.7 : 1,
      }}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
