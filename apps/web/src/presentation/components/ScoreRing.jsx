import React from 'react';

export default function ScoreRing({ value, size = 120, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const color = value >= 90 ? 'var(--green)' : value >= 75 ? 'var(--yellow)' : 'var(--red)';

  const valFontSize = size >= 120 ? 24 : size >= 90 ? 18 : 9;
  const labelVisible = size >= 90;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg4)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: valFontSize, fontWeight: 600, color, whiteSpace: 'nowrap' }}>{value}%</span>
        {labelVisible && <span style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>geral</span>}
      </div>
    </div>
  );
}
