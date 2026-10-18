import React from 'react';
import { statusCfg } from './Badge.jsx';
import { actionLabel, historyGroups, itemLabels } from '../../domain/auditHistory.js';

const WHEN = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

const ACTION_COLORS = {
  field_edit: 'var(--yellow)',
  approve: 'var(--green)',
  revoke_approval: 'var(--yellow)',
  delete: 'var(--red)',
  restore: 'var(--accent)',
};

const statusLabel = (status) => statusCfg[status]?.label ?? status;

/** One value as it was or became: the status it counted as, and the text kept with it. */
function ValueLine({ label, status, value, isMobile }) {
  const color = statusCfg[status]?.color ?? 'var(--text2)';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', minWidth: 34 }}>{label}</span>
      <span style={{ fontSize: 10, color, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{statusLabel(status)}</span>
      <span style={{
        fontSize: isMobile ? 11 : 10, color: 'var(--text2)', fontFamily: 'var(--mono)',
        wordBreak: 'break-word', flex: 1, minWidth: 0,
      }}>
        {value === null || value === '' ? '—' : value}
      </span>
    </div>
  );
}

/**
 * What people did to this audit, newest first: every field edit with the value before and after,
 * and the approvals, deletes and restores around them.
 */
export default function ChangeHistory({ history, audit, isMobile }) {
  const groups = historyGroups(history, itemLabels(audit));

  if (groups.length === 0) {
    return (
      <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', padding: '4px 0' }}>
        Nada foi alterado desde a auditoria automática.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groups.map((group) => {
        const color = ACTION_COLORS[group.action] ?? 'var(--accent)';
        return (
          <div key={group.id} style={{
            background: 'var(--bg2)', border: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
            borderRadius: 10, padding: isMobile ? '10px 12px' : '12px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 10, fontFamily: 'var(--mono)', color, background: 'var(--bg4)',
                padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
              }}>
                {actionLabel(group.action)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text)' }}>{group.user}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
                {new Date(group.at).toLocaleString('pt-BR', WHEN)}
              </span>
            </div>

            {group.changes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {group.changes.map((change) => (
                  <div key={change.key} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)' }}>{change.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{change.place}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <ValueLine label="antes" status={change.fromStatus} value={change.fromValue} isMobile={isMobile} />
                      <ValueLine label="depois" status={change.toStatus} value={change.toValue} isMobile={isMobile} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
