import React, { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import ScoreRing from './ScoreRing.jsx';
import Badge, { statusCfg } from './Badge.jsx';
import { baseDraftOf, refKey, sameDraft } from '../../domain/auditValue.js';

const CHOICES = [
  ['conforme', 'Conforme'],
  ['nao_conforme', 'Não conforme'],
];

/** The inputs that change one item: conformity buttons and the value kept under the item name. */
function ItemEditor({ item, draft, onChange, isMobile }) {
  const current = draft ?? baseDraftOf(item);

  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHOICES.map(([status, label]) => {
          const selected = current.status === status;
          const cfg = statusCfg[status];
          return (
            <button
              key={status}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ status })}
              style={{
                background: selected ? cfg.bg : 'transparent',
                color: selected ? cfg.color : 'var(--text2)',
                border: `1px solid ${selected ? cfg.color : 'var(--border2)'}`,
                borderRadius: 20,
                padding: '4px 12px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <input
        value={current.comment}
        onChange={(e) => onChange({ comment: e.target.value })}
        placeholder="Valor / observação deste item"
        aria-label={`Valor de ${item.item}`}
        style={{
          width: '100%',
          background: 'var(--bg2)',
          border: '1px solid var(--border2)',
          borderRadius: 6,
          color: 'var(--text)',
          fontFamily: 'var(--mono)',
          fontSize: isMobile ? 12 : 11,
          padding: '7px 10px',
        }}
      />
    </div>
  );
}

/**
 * One audited item. `edit.originals` is what the automatic audit produced, shown next to anything
 * an auditor changed. With `edit.editing`, an item that has a `ref` can be changed as well:
 * `edit.drafts` holds the unsaved changes by `refKey` and `edit.onChange(ref, draft | null)`
 * records a draft (null drops it).
 */
function ItemRow({ it, isMobile, edit }) {
  const key = it.ref ? refKey(it.ref) : null;
  const draft = key && edit ? edit.drafts[key] : undefined;
  const original = key && edit ? edit.originals[key] : undefined;
  const changedFromOriginal = original !== undefined && original !== null && String(it.valor) !== String(original.value ?? 'N/A');
  const editable = Boolean(edit?.editing && it.ref);
  const color = draft ? statusCfg[draft.status].color : statusCfg[it.status]?.color || 'var(--green)';

  function handleChange(patch) {
    const base = baseDraftOf(it);
    const next = { ...base, ...(draft ?? {}), ...patch };
    edit.onChange(it.ref, sameDraft(next, base) ? null : next);
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto', gap: 8,
      background: draft ? 'var(--bg4)' : 'var(--bg3)',
      border: `1px solid ${draft ? 'var(--accent)' : 'var(--border)'}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 7, padding: isMobile ? '8px 10px' : '10px 14px',
    }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', marginBottom: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {it.item}
          {draft && <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>não salvo</span>}
          {!draft && changedFromOriginal && (
            <span style={{ fontSize: 9, color: 'var(--yellow)', fontFamily: 'var(--mono)' }}>editado</span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', wordBreak: 'break-word' }}>{it.valor}</div>
        {it.observacao && (
          <div style={{ fontSize: 10, color: 'var(--yellow)', marginTop: 4, opacity: 0.9 }}><Icon name="alert" size={11} /> {it.observacao}</div>
        )}
        {changedFromOriginal && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, fontFamily: 'var(--mono)', wordBreak: 'break-word' }}>
            original da auditoria: {original.value ?? 'N/A'}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Badge status={it.status} />
      </div>
      {editable && <ItemEditor item={it} draft={draft} onChange={handleChange} isMobile={isMobile} />}
    </div>
  );
}

export function Section({ sec, defaultOpen = false, isMobile, edit }) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const list = (items) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((it, i) => <ItemRow key={i} it={it} isMobile={isMobile} edit={edit} />)}
    </div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'var(--bg3)', border: 'none', padding: isMobile ? '10px 12px' : '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)',
          background: 'var(--bg4)', padding: '2px 6px', borderRadius: 5, flexShrink: 0
        }}>
          {sec.id}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{sec.titulo}</span>
          <span style={{
            fontSize: 10, fontWeight: 500, color: 'var(--text3)', background: 'var(--bg4)',
            padding: '2px 6px', borderRadius: 6, fontFamily: 'var(--mono)', whiteSpace: 'nowrap'
          }}>
            {sec.conformes}/{sec.total} ({sec.conformidade}%)
          </span>
        </span>
        <ScoreRing value={sec.conformidade} size={36} stroke={4} />
        <span style={{ color: 'var(--text3)', fontSize: 14, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ background: 'var(--bg2)', padding: isMobile ? '10px 8px' : '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sec.subgrupos ? (
            sec.subgrupos.map((sub, sIdx) => (
              <div key={sIdx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--sans)',
                  marginTop: sIdx > 0 ? 10 : 0, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span style={{ width: 3, height: 11, borderRadius: 2, background: 'var(--accent)' }} />
                  {sub.titulo}
                </div>
                {list(sub.itens)}
              </div>
            ))
          ) : (
            list(sec.itens)
          )}
        </div>
      )}
    </div>
  );
}

export function ResultCard({ r, isMobile, edit }) {
  const [tab, setTab] = useState('secoes');
  const days = r.days || ['15/04', '16/04', '17/04', '18/04'];

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '2px 12px 12px 12px' }}>
      {/* Header score */}
      <div style={{
        padding: isMobile ? '16px 12px' : '24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: isMobile ? 'center' : 'flex-start',
        gap: isMobile ? '16px' : '24px',
        flexWrap: 'wrap',
        flexDirection: isMobile ? 'column' : 'row',
        textAlign: isMobile ? 'center' : 'left'
      }}>
        <ScoreRing value={r.conformidade_geral} size={isMobile ? 100 : 130} stroke={isMobile ? 8 : 10} />
        <div style={{ flex: isMobile ? 'none' : 1, minWidth: isMobile ? '100%' : 200, display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-start' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>
            prontuário {r.prontuario}
          </div>
          <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 600, marginBottom: isMobile ? 0 : 12, letterSpacing: '-0.02em' }}>
            Relatório de Auditoria
          </div>
          {!isMobile && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {r.secoes.map(s => {
                const color = s.conformidade >= 90 ? 'var(--green)' : s.conformidade >= 75 ? 'var(--yellow)' : 'var(--red)';
                const bg = s.conformidade >= 90 ? 'var(--green-bg)' : s.conformidade >= 75 ? 'var(--yellow-bg)' : 'var(--red-bg)';
                return (
                  <div key={s.id} style={{ background: bg, border: `1px solid color-mix(in srgb, ${color} 19%, transparent)`, borderRadius: 8, padding: '7px 12px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>Seção {s.id}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 600, color }}>{s.conformidade}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {[['secoes', 'Seções'], ['quantitativo', 'Quantitativo'], ['nao_conformidades', 'Não Conformidades']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: 'none', border: 'none', borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab === k ? 'var(--accent)' : 'var(--text2)',
            padding: isMobile ? '10px 8px' : '10px 14px',
            fontSize: isMobile ? 11 : 12,
            fontFamily: 'var(--mono)', cursor: 'pointer',
            transition: 'color 0.15s',
            flexShrink: 0,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: isMobile ? '12px 8px' : '16px' }}>
        {tab === 'secoes' && (
          <div>
            {r.secoes.map((s, i) => <Section key={s.id} sec={s} defaultOpen={!isMobile && i === 0} isMobile={isMobile} edit={edit} />)}
          </div>
        )}

        {tab === 'quantitativo' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: isMobile ? '6px 8px' : '8px 12px', color: 'var(--text2)', fontWeight: 500 }}>Tipo de Registro</th>
                  {days.map(d => <th key={d} style={{ padding: isMobile ? '6px 4px' : '8px 12px', color: 'var(--text2)', fontWeight: 500 }}>{d}</th>)}
                  <th style={{ padding: isMobile ? '6px 4px' : '8px 12px', color: 'var(--text2)', fontWeight: 500 }}>Total</th>
                  <th style={{ padding: isMobile ? '6px 8px' : '8px 12px', color: 'var(--text2)', fontWeight: 500 }}>Conform.</th>
                </tr>
              </thead>
              <tbody>
                {(r.quantitativo || []).map((row, i) => {
                  const c = row.conformidade >= 90 ? 'var(--green)' : row.conformidade >= 75 ? 'var(--yellow)' : 'var(--red)';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg3)' : 'transparent' }}>
                      <td style={{ padding: isMobile ? '8px 8px' : '10px 12px', color: 'var(--text)' }}>{row.tipo}</td>
                      {days.map(d => (
                        <td key={d} style={{ padding: isMobile ? '8px 4px' : '10px 12px', textAlign: 'center', fontSize: 14 }}>
                          {row[d] ? <span style={{ color: 'var(--green)' }}><Icon name="check" size={14} /></span> : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      ))}
                      <td style={{ padding: isMobile ? '8px 4px' : '10px 12px', textAlign: 'center', color: 'var(--text)' }}>{row.total}</td>
                      <td style={{ padding: isMobile ? '8px 8px' : '10px 12px', textAlign: 'center', color: c, fontWeight: 600, whiteSpace: 'nowrap' }}>{row.conformidade}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'nao_conformidades' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(r.nao_conformidades || []).length === 0
              ? <div style={{ color: 'var(--green)', fontSize: 13, padding: '16px', textAlign: 'center' }}><Icon name="check" size={14} /> Nenhuma não conformidade encontrada</div>
              : (r.nao_conformidades || []).map((nc, i) => (
                <div key={i} style={{ background: 'var(--red-bg)', border: '1px solid color-mix(in srgb, var(--red) 19%, transparent)', borderLeft: '3px solid var(--red)', borderRadius: 8, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'color-mix(in srgb, var(--red) 12%, transparent)', color: 'var(--red)', padding: '2px 8px', borderRadius: 5 }}>
                      Seção {nc.secao}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{nc.item}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{nc.descricao}</div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}
