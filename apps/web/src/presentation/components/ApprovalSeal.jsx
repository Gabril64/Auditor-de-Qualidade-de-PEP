import React from 'react';
import { approvalSeal } from '../../domain/approvals.js';

const TONES = {
  ok: { color: '#00e676', bg: '#0d2b1a', border: '#00e67630' },
  warn: { color: '#ffd740', bg: '#2b2410', border: '#ffd74030' },
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
      {tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '○'} {label}
    </span>
  );
}
