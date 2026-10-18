import React, { useEffect, useMemo, useState } from 'react';
import { approveAudit, deleteAudit, fetchAuditById, revokeAuditApproval, saveAuditRevision } from '../../data/apiClient.js';
import { changesFromDrafts, refKey } from '../../domain/auditValue.js';
import { ResultCard } from '../components/AuditReport.jsx';
import ChangeHistory from '../components/ChangeHistory.jsx';
import ApprovalSeal from '../components/ApprovalSeal.jsx';
import { lastEdit } from '../../domain/auditHistory.js';

const SUBMITTED_AT = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

/** The submitted record, read only: one block per entry, each key under its own label. */
function RawRecordPanel({ raw, isMobile }) {
  if (!raw) {
    return (
      <div style={{ color: 'var(--text2)', fontSize: 13, padding: 20 }}>
        O prontuário original não foi guardado para esta auditoria.
      </div>
    );
  }

  const when = raw.submitted_at ? new Date(raw.submitted_at).toLocaleString('pt-BR', SUBMITTED_AT) : '';

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginBottom: 12 }}>
        Enviado em {when} · {raw.entries.length} registro{raw.entries.length === 1 ? '' : 's'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {raw.entries.map((entry) => {
          const values = Object.entries(entry.original).filter(([, v]) => v !== null && v !== '');
          return (
            <div key={entry.position} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: isMobile ? 10 : 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--mono)', marginBottom: 10 }}>
                Registro {entry.position + 1}
                {entry.original['Tipo do registro'] ? ` · ${entry.original['Tipo do registro']}` : ''}
                {entry.original['Categoria Profissional'] ? ` · ${entry.original['Categoria Profissional']}` : ''}
              </div>
              <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {values.map(([label, value]) => (
                  <div key={label}>
                    <dt style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{label}</dt>
                    <dd style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The edit symbol: a pencil, on the button that turns the audited items into fields. */
function PencilIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

const panelStyle = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, minWidth: 0 };

export default function AuditDetailView({ auditId, user, onBack, isMobile }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchAuditById(auditId));
      setDrafts({});
      setSaveError(null);
      setConflict(false);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  const originals = useMemo(() => {
    const byKey = {};
    for (const row of detail?.fields ?? []) byKey[refKey(row)] = row;
    return byKey;
  }, [detail]);

  const pending = Object.keys(drafts).length;

  function handleChange(ref, draft) {
    setDrafts((current) => {
      const next = { ...current };
      if (draft) next[refKey(ref)] = { ...draft, ref };
      else delete next[refKey(ref)];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveAuditRevision(detail.id, detail.updated_at, changesFromDrafts(drafts));
      setDetail(await fetchAuditById(auditId));
      setDrafts({});
    } catch (err) {
      if (err.status === 409) setConflict(true);
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  /** Turns editing on and off; leaving it drops whatever was not saved, after asking. */
  function toggleEditing() {
    if (editing && pending > 0 && !window.confirm('Há alterações não salvas. Sair da edição e descartá-las?')) return;
    if (editing) setDrafts({});
    setEditing((on) => !on);
  }

  /** Approves the saved version, or withdraws the user's own approval when they already gave it. */
  async function handleApproval() {
    setApproving(true);
    setSaveError(null);
    try {
      if (detail.approved_by_me) await revokeAuditApproval(detail.id);
      else await approveAudit(detail.id);
      setDetail(await fetchAuditById(auditId));
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setApproving(false);
    }
  }

  async function handleDelete() {
    const number = detail.record_number_display || detail.record_number;
    if (!window.confirm(`Excluir o prontuário ${number}? Ele sai das listas e do dashboard; só um administrador pode restaurá-lo.`)) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteAudit(detail.id);
      setDrafts({});
      onBack();
    } catch (err) {
      setSaveError(err.message);
      setDeleting(false);
    }
  }

  function handleBack() {
    if (pending > 0 && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    onBack();
  }

  const pad = isMobile ? '12px 10px 80px' : '24px 16px';

  if (loading && !detail) {
    return <div style={{ padding: pad, color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: 13 }}>Carregando auditoria...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: pad }}>
        <button onClick={onBack} style={linkButton}>← Voltar ao dashboard</button>
        <div style={{ marginTop: 16, color: 'var(--red)', fontSize: 14 }}>Erro ao carregar a auditoria: {error}</div>
        <button onClick={load} style={{ ...linkButton, marginTop: 12 }}>Tentar novamente</button>
      </div>
    );
  }

  const original = detail.original_conformity_percent;
  const edited = detail.updated_at !== null && detail.updated_at !== undefined;
  const editor = lastEdit(detail.history);

  return (
    <div style={{ padding: pad }}>
      <button onClick={handleBack} style={linkButton}>← Voltar ao dashboard</button>

      <div style={{ margin: '16px 0 20px', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 26, fontWeight: 700, letterSpacing: '-0.03em' }}>
            Prontuário {detail.record_number_display || detail.record_number}
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: 12, fontFamily: 'var(--mono)', marginTop: 6 }}>
            {detail.encounter ? `Atendimento ${detail.encounter} · ` : ''}
            {edited
              ? `editado${editor ? ` por ${editor.user}` : ''} em ${new Date(detail.updated_at).toLocaleString('pt-BR', SUBMITTED_AT)}${typeof original === 'number' ? ` · original da auditoria: ${original}%` : ''}`
              : 'como saiu da auditoria automática'}
          </p>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <ApprovalSeal audit={detail} />
            {detail.deleted_at && (
              <span style={{ fontSize: 11, color: 'var(--red)', fontFamily: 'var(--mono)' }}>
                excluído em {new Date(detail.deleted_at).toLocaleString('pt-BR', SUBMITTED_AT)}
              </span>
            )}
          </div>
        </div>

        {!detail.deleted_at && (
          <button
            onClick={handleApproval}
            disabled={approving || pending > 0}
            title={pending > 0 ? 'Salve ou descarte as alterações antes de aprovar' : undefined}
            style={detail.approved_by_me ? secondaryButton : primaryButton}
          >
            {approving ? 'Aguarde...' : detail.approved_by_me ? 'Retirar minha aprovação' : 'Aprovar'}
          </button>
        )}

        {!detail.deleted_at && user?.role === 'admin' && (
          <button
            onClick={handleDelete}
            disabled={deleting || saving}
            aria-label="Excluir este prontuário"
            title="Excluir prontuário"
            style={{ ...dangerButton, ...editButton }}
          >
            {deleting ? 'Excluindo...' : 'Excluir'}
          </button>
        )}

        {!detail.deleted_at && (
          <button
            onClick={toggleEditing}
            aria-pressed={editing}
            aria-label={editing ? 'Concluir a edição desta auditoria' : 'Editar esta auditoria'}
            title={editing ? 'Concluir edição' : 'Editar auditoria'}
            style={editing ? { ...primaryButton, ...editButton } : { ...secondaryButton, ...editButton }}
          >
            <PencilIcon />
            {editing ? 'Concluir edição' : 'Editar'}
          </button>
        )}
      </div>

      {pending > 0 && (
        <div style={{
          position: 'sticky', top: 64, zIndex: 5, marginBottom: 16,
          background: 'var(--bg4)', border: '1px solid var(--accent)', borderRadius: 10,
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, flex: 1 }}>
            {pending} alteração{pending === 1 ? '' : 'ões'} não salva{pending === 1 ? '' : 's'}
          </span>
          <button onClick={() => setDrafts({})} disabled={saving} style={secondaryButton}>Descartar</button>
          <button onClick={handleSave} disabled={saving || conflict} style={primaryButton}>
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      )}

      {saveError && (
        <div style={{ marginBottom: 16, background: '#2b0d0d', border: '1px solid var(--red)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          <div style={{ color: 'var(--red)' }}>{conflict ? 'Outra pessoa salvou esta auditoria antes de você.' : saveError}</div>
          {conflict && (
            <button onClick={load} style={{ ...secondaryButton, marginTop: 8 }}>
              Recarregar (suas alterações não salvas serão descartadas)
            </button>
          )}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: 20,
        alignItems: 'start',
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={sideTitle}>Prontuário auditado</h2>
          {detail.audit ? (
            <ResultCard
              r={detail.audit}
              isMobile={isMobile}
              edit={{ drafts, originals, onChange: handleChange, editing }}
            />
          ) : (
            <div style={{ ...panelStyle, color: 'var(--text2)', fontSize: 13 }}>Esta auditoria não pôde ser exibida.</div>
          )}
        </div>

        <div style={{ minWidth: 0, position: isMobile ? 'static' : 'sticky', top: 80 }}>
          <h2 style={sideTitle}>Prontuário original</h2>
          <div style={{ ...panelStyle, maxHeight: isMobile ? 'none' : 'calc(100vh - 160px)', overflowY: isMobile ? 'visible' : 'auto' }}>
            <RawRecordPanel raw={detail.raw_patient_record} isMobile={isMobile} />
          </div>
        </div>
      </div>

      {(editing || (detail.history ?? []).length > 0) && (
        <section style={{ marginTop: 24 }}>
          <h2 style={sideTitle}>Histórico de alterações</h2>
          <ChangeHistory history={detail.history} audit={detail.audit} isMobile={isMobile} />
        </section>
      )}
    </div>
  );
}

const sideTitle = { fontSize: 13, fontWeight: 600, color: 'var(--text2)', fontFamily: 'var(--mono)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.04em' };

const linkButton = { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 };

const secondaryButton = {
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
  borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer',
};

const editButton = { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 };

const dangerButton = {
  background: 'var(--bg3)', border: '1px solid var(--red)', color: 'var(--red)',
  borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer',
};

const primaryButton = {
  background: 'var(--accent)', border: '1px solid var(--accent)', color: '#00131a',
  borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
