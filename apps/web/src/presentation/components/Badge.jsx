import React from 'react';

export const statusCfg = {
  conforme: { label: 'Conforme', color: 'var(--green)', bg: 'var(--green-bg)', border: 'color-mix(in srgb, var(--green) 19%, transparent)' },
  nao_conforme: { label: 'Não Conforme', color: 'var(--red)', bg: 'var(--red-bg)', border: 'color-mix(in srgb, var(--red) 19%, transparent)' },
  nao_se_aplica: { label: 'Não se aplica', color: 'var(--accent)', bg: 'var(--accent-bg)', border: 'color-mix(in srgb, var(--accent) 19%, transparent)' },
  nao_aplicavel: { label: 'Não se aplica', color: 'var(--accent)', bg: 'var(--accent-bg)', border: 'color-mix(in srgb, var(--accent) 19%, transparent)' },
};

export default function Badge({ status }) {
  const c = statusCfg[status] || statusCfg.conforme;
  return (
    <span style={{
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      fontSize: 11,
      padding: '3px 9px',
      borderRadius: 20,
      whiteSpace: 'nowrap',
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1
    }}>
      {c.label}
    </span>
  );
}
