import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon.jsx';
import { fetchAllAudits, fetchDashboardStats, fetchDeletedAudits, restoreAudit } from '../../data/apiClient.js';
import { needsApproval } from '../../domain/approvals.js';
import { matchesSearch } from '../../domain/auditSearch.js';
import ApprovalSeal from '../components/ApprovalSeal.jsx';

export default function DashboardView({ onSelectAudit, user, isMobile }) {
  const isAdmin = user?.role === 'admin';
  const [audits, setAudits] = useState([]);
  const [search, setSearch] = useState('');
  const [listMode, setListMode] = useState('all'); // 'all' | 'needs_approval' | 'deleted'
  const [deleted, setDeleted] = useState([]);
  const [listError, setListError] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [auditsRes, statsRes] = await Promise.all([
        fetchAllAudits(),
        fetchDashboardStats()
      ]);
      setAudits(auditsRes.audits || []);
      setStats(statsRes);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDeleted() {
    setListError(null);
    try {
      setDeleted((await fetchDeletedAudits()).audits || []);
    } catch (err) {
      setListError(err.message);
    }
  }

  function chooseMode(mode) {
    setListMode(mode);
    if (mode === 'deleted') loadDeleted();
  }

  async function handleRestore(audit) {
    setListError(null);
    try {
      await restoreAudit(audit.id);
      await Promise.all([loadDeleted(), loadData()]);
    } catch (err) {
      setListError(err.message);
    }
  }

  // Calculate section averages from real data
  const sectionIds = ['A', 'B', 'C', 'D', 'E'];
  const sectionAverages = sectionIds.map(id => {
    let totalScore = 0;
    let count = 0;
    audits.forEach(a => {
      if (!a.audit) return;
      const sec = a.audit.secoes?.find(s => s.id === id);
      if (sec) {
        totalScore += sec.conformidade;
        count++;
      }
    });
    return {
      id,
      name: id === 'A' ? 'Identificação' :
            id === 'B' ? 'Anamnese/Evolução Médica' :
            id === 'C' ? 'Bloco Cirúrgico' :
            id === 'D' ? 'Anamnese / Evoluções de Enfermagem' :
            'Equipe Multiprofissional',
      value: count > 0 ? Math.round(totalScore / count * 10) / 10 : 100
    };
  });

  // Calculate recurrent non-conformities from real data
  const nonConformityCounts = {};
  audits.forEach(a => {
    if (!a.audit?.nao_conformidades) return;
    a.audit.nao_conformidades.forEach(nc => {
      const parts = nc.item.split(' — ');
      const coreItemName = parts[parts.length - 1];
      if (!nonConformityCounts[coreItemName]) {
        nonConformityCounts[coreItemName] = {
          name: coreItemName,
          secao: nc.secao,
          count: 0
        };
      }
      nonConformityCounts[coreItemName].count += 1;
    });
  });

  const recurrentIssues = Object.values(nonConformityCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const modeAudits = listMode === 'deleted'
    ? deleted
    : listMode === 'needs_approval'
      ? audits.filter(needsApproval)
      : audits;
  const shownAudits = modeAudits.filter((audit) => matchesSearch(audit, search));

  const totalCharts = stats?.total_audits || audits.length;
  const avgCompliance = stats?.avg_conformity || 0;

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: isMobile ? '12px 10px 80px' : '24px 16px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="chart" size={26} /> Painel de Qualidade PEP
          </h1>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 16 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
                animation: 'pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s`
              }} />
            ))}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
            Carregando dados do banco...
          </div>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ padding: isMobile ? '12px 10px 80px' : '24px 16px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="chart" size={26} /> Painel de Qualidade PEP
          </h1>
        </div>
        <div style={{
          background: 'var(--red-bg)', border: '1px solid var(--red)',
          borderRadius: 12, padding: '20px 24px', textAlign: 'center'
        }}>
          <div style={{ fontSize: 14, color: 'var(--red)', fontWeight: 600, marginBottom: 8 }}>
            <Icon name="alert" size={15} /> Erro ao carregar dados
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>{error}</div>
          <button
            onClick={loadData}
            style={{
              background: 'var(--bg4)', border: '1px solid var(--border)',
              color: 'var(--accent)', padding: '8px 20px', borderRadius: 8,
              fontSize: 12, fontWeight: 600, cursor: 'pointer'
            }}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (totalCharts === 0) {
    return (
      <div style={{ padding: isMobile ? '12px 10px 80px' : '24px 16px' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="chart" size={26} /> Painel de Qualidade PEP
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: isMobile ? 13 : 15, marginTop: 8, maxWidth: 640 }}>
            Indicadores consolidados da auditoria clínica institucional e status de conformidade legal.
          </p>
        </div>
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '40px 24px', textAlign: 'center'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}><Icon name="inbox" size={48} /></div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Nenhuma auditoria realizada ainda
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', maxWidth: 400, margin: '0 auto' }}>
            Envie prontuários pela aba de Auditoria para que os resultados apareçam aqui.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? '12px 10px 80px' : '24px 16px' }}>
      {/* Title */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="chart" size={26} /> Painel de Qualidade PEP
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: isMobile ? 13 : 15, marginTop: 8, maxWidth: 640 }}>
            Indicadores consolidados da auditoria clínica institucional e status de conformidade legal.
          </p>
        </div>
        <button
          onClick={loadData}
          style={{
            background: 'var(--bg3)', border: '1px solid var(--border)',
            color: 'var(--accent)', padding: '8px 16px', borderRadius: 8,
            fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--mono)',
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'all 0.15s'
          }}
          onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <Icon name="refresh" size={13} /> Atualizar
        </button>
      </div>

      {/* Metric Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
        gap: 16,
        marginBottom: 32
      }}>
        {/* Metric 1 */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>PRONTUÁRIOS AUDITADOS</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8, color: 'var(--accent)' }}>{totalCharts}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8 }}>Resultados persistidos no banco</div>
        </div>

        {/* Metric 2 */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>CONFORMIDADE MÉDIA</div>
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            marginTop: 8,
            color: avgCompliance >= 90 ? 'var(--green)' : avgCompliance >= 75 ? 'var(--yellow)' : 'var(--red)'
          }}>{avgCompliance}%</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8 }}>Média de todas as seções auditadas</div>
        </div>

        {/* Metric 3 */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}>
          <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>ALERTA DE QUALIDADE</div>
          {stats?.min_conformity?.record_number ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 14, color: 'var(--text)' }}>
                <Icon name="alert" size={12} /> Prontuário {stats.min_conformity.record_number}
              </div>
              <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 8 }}>
                Menor pontuação registrada ({stats.min_conformity.value}%)
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 14, color: 'var(--text2)' }}>
              — sem dados
            </div>
          )}
        </div>
      </div>

      {/* Grid for Section Performance & Audits list */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr',
        gap: 24,
        alignItems: 'start'
      }}>
        {/* Left Column: Stats & Recurrent Issues */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Section compliance ratings */}
          <div style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 20 }}>Conformidade por Seção Regulatória</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sectionAverages.map(sec => {
                const color = sec.value >= 90 ? 'var(--green)' : sec.value >= 75 ? 'var(--yellow)' : 'var(--red)';
                return (
                  <div key={sec.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ 
                      display: 'flex', 
                      flexDirection: isMobile ? 'column' : 'row', 
                      justifyContent: 'space-between', 
                      alignItems: isMobile ? 'flex-start' : 'center', 
                      gap: isMobile ? 4 : 8,
                      fontSize: isMobile ? 11 : 12 
                    }}>
                      <span style={{ color: 'var(--text2)' }}>Seção {sec.id} — {sec.name}</span>
                      <span style={{ fontWeight: 600, color, alignSelf: isMobile ? 'flex-end' : 'auto' }}>{sec.value}%</span>
                    </div>
                    {/* Progress Bar Container */}
                    <div style={{ width: '100%', height: 8, background: 'var(--bg4)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        width: `${sec.value}%`,
                        height: '100%',
                        background: `linear-gradient(to right, color-mix(in srgb, ${color} 80%, transparent), ${color})`,
                        borderRadius: 4,
                        transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)'
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recurrent Non-conformities */}
          <div style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={16} /> Não Conformidades Mais Recorrentes
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recurrentIssues.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--green)', padding: '8px 0' }}>
                  <Icon name="check" size={14} /> Nenhuma não conformidade identificada nos prontuários da base.
                </div>
              ) : (
                recurrentIssues.map((issue, idx) => (
                  <div key={idx} style={{
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'stretch' : 'center',
                    justifyContent: 'space-between',
                    gap: isMobile ? 8 : 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 10,
                        background: 'color-mix(in srgb, var(--red) 10%, transparent)',
                        color: 'var(--red)',
                        border: '1px solid color-mix(in srgb, var(--red) 20%, transparent)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap'
                      }}>
                        Seção {issue.secao}
                      </span>
                      <span style={{ 
                        fontSize: isMobile ? 12 : 13, 
                        fontWeight: 500, 
                        color: 'var(--text)', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap' 
                      }}>
                        {issue.name}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 10,
                      color: 'var(--text2)',
                      fontFamily: 'var(--mono)',
                      background: 'var(--bg4)',
                      padding: '4px 8px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                      alignSelf: isMobile ? 'flex-end' : 'auto',
                      flexShrink: 0
                    }}>
                      {issue.count} ocorrência{issue.count > 1 ? 's' : ''}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Audits list (real data from DB) */}
        <div style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 20
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Prontuários Auditados</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              ['all', `Todos (${audits.length})`],
              ['needs_approval', `Precisa de aprovação (${audits.filter(needsApproval).length})`],
              ...(isAdmin ? [['deleted', 'Excluídos']] : []),
            ].map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => chooseMode(mode)}
                aria-pressed={listMode === mode}
                style={{
                  background: listMode === mode ? 'var(--bg4)' : 'transparent',
                  border: `1px solid ${listMode === mode ? 'var(--accent)' : 'var(--border2)'}`,
                  color: listMode === mode ? 'var(--accent)' : 'var(--text2)',
                  borderRadius: 20, padding: '4px 12px', fontSize: 11, cursor: 'pointer'
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número do prontuário ou atendimento"
            aria-label="Buscar prontuário"
            style={{
              width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8,
              color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '9px 12px', marginBottom: 14,
            }}
          />
          {listError && (
            <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 12 }}>{listError}</div>
          )}
          {shownAudits.length === 0 && (
            <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', padding: '8px 0' }}>
              {search.trim() !== ''
                ? `Nenhum prontuário encontrado para "${search.trim()}".`
                : listMode === 'deleted' ? 'Nenhum prontuário excluído.' : listMode === 'needs_approval' ? 'Nada pendente de aprovação.' : 'Nenhum prontuário.'}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {shownAudits.map((audit) => {
              const score = audit.audit?.conformidade_geral ?? audit.conformity_percent ?? 0;
              const color = score >= 90 ? 'var(--green)' : score >= 75 ? 'var(--yellow)' : 'var(--red)';
              const dateStr = audit.created_at
                ? new Date(audit.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <div
                  key={audit.id || audit.job_id}
                  style={{
                    background: 'var(--bg3)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ 
                        fontSize: isMobile ? 12 : 13, 
                        fontWeight: 600, 
                        color: 'var(--text)',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: isMobile ? 'normal' : 'nowrap'
                      }}>
                        Prontuário {audit.record_number_display || audit.record_number}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                        {dateStr}
                        {audit.encounter && ` · Atendimento: ${audit.encounter}`}
                      </div>
                    </div>
                    <span style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 12,
                      fontWeight: 700,
                      color,
                      background: `color-mix(in srgb, ${color} 10%, transparent)`,
                      padding: '4px 8px',
                      borderRadius: 6
                    }}>
                      {typeof score === 'number' ? `${Math.round(score * 10) / 10}%` : 'N/A'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {listMode !== 'deleted' && <ApprovalSeal audit={audit} />}
                    {audit.edited && (
                      <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>editado</span>
                    )}
                    {listMode === 'deleted' && isAdmin && (
                      <button
                        onClick={() => handleRestore(audit)}
                        style={{ background: 'var(--bg4)', border: '1px solid var(--border2)', color: 'var(--accent)', borderRadius: 8, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
                      >
                        Restaurar
                      </button>
                    )}
                  </div>

                  {onSelectAudit && audit.audit && (
                    <button
                      onClick={() => onSelectAudit(audit)}
                      style={{
                        background: 'var(--bg4)',
                        border: '1px solid var(--border2)',
                        color: 'var(--accent)',
                        padding: '8px 12px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        transition: 'all 0.15s'
                      }}
                      onMouseOver={e => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 5%, transparent)';
                      }}
                      onMouseOut={e => {
                        e.currentTarget.style.borderColor = 'var(--border2)';
                        e.currentTarget.style.background = 'var(--bg4)';
                      }}
                    >
                      Ver Detalhes <Icon name="arrow-right" size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
