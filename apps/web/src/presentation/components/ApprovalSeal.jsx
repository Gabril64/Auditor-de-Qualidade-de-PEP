import React from 'react';
import Icon from './Icon.jsx';
import { approvalSeal } from '../../domain/approvals.js';

const TONES = {
  ok: { color: 'var(--green)', bg: 'var(--green-bg)', border: 'color-mix(in srgb, var(--green) 19%, transparent)' },
  warn: { color: 'var(--yellow)', bg: 'var(--yellow-bg)', border: 'color-mix(in srgb, var(--yellow) 19%, transparent)' },
  muted: { color: 'var(--text2)', bg: 'var(--bg4)', border: 'var(--border)' },
};

/** The approval of an audit in one badge: green, amber (approved before the last edit) or grey (pending). */
export default function ApprovalSeal({ audit }) {
  const { tone, label } = approvalSeal(audit);
  const cfg = TONES[tone];
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      fontSize: 11, padding: '3px 9px', borderRadius: 20, lineHeight: 1.3,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <Icon name={tone === 'ok' ? 'check-circle' : tone === 'warn' ? 'alert' : 'minus-circle'} size={12} /> {label}
    </span>
  );
}
