import React, { useState, useRef, useEffect } from 'react';
import Icon from '../components/Icon.jsx';
import { submitAndPollBatch } from '../../data/apiClient.js';
import { ResultCard } from '../components/AuditReport.jsx';

function UserMessage({ content, isMobile }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 150;

  let recordCount = 0;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) recordCount = parsed.length;
  } catch (e) { }

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
      <div style={{
        background: 'var(--bg3)', border: '1px solid var(--border)',
        borderRadius: '12px 12px 2px 12px', padding: '12px 16px',
        maxWidth: isMobile ? '95%' : '80%', width: '100%'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>prontuário enviado</span>
          {recordCount > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
              {recordCount} registro{recordCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <pre style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: expanded ? 'none' : (isMobile ? '60px' : '100px'),
            overflowY: 'hidden', margin: 0
          }}>
            {content}
          </pre>
          {!expanded && isLong && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '24px',
              background: 'linear-gradient(to bottom, transparent, var(--bg3))',
              pointerEvents: 'none'
            }} />
          )}
        </div>
        {isLong && (
          <button onClick={() => setExpanded(e => !e)} style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer',
            marginTop: 6, padding: 0, display: 'flex', alignItems: 'center', gap: 4
          }}>
            {expanded ? '▲ recolher' : '▼ expandir prontuário'}
          </button>
        )}
      </div>
    </div>
  );
}

// Main View
export default function AuditView({ isMobile }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    // Validate that input is valid JSON
    try {
      JSON.parse(text);
    } catch {
      // Try wrapping in array brackets (format from POST /batches)
      try {
        JSON.parse(`[${text}]`);
      } catch {
        setMessages(prev => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', type: 'error', content: 'JSON inválido. Verifique a estrutura e tente novamente.' }
        ]);
        return;
      }
    }

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setProgress({ completed: 0, total: 0 });

    try {
      // Each prontuário appears as soon as its job ends; only the failures wait for the end of the batch.
      const results = await submitAndPollBatch(text, {
        onJobStarted: (batchInfo) => {
          setProgress({ completed: 0, total: batchInfo.total_records });
        },
        onProgress: (completed, total) => {
          setProgress({ completed, total });
        },
        onJobComplete: (result) => {
          setMessages(prev => [...prev, { role: 'assistant', type: 'result', content: result }]);
        },
      });

      const failures = results
        .filter((result) => result.error)
        .map((result) => ({
          role: 'assistant',
          type: 'error',
          content: result.message || 'Erro ao processar prontuário'
        }));

      if (failures.length > 0) setMessages(prev => [...prev, ...failures]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        type: 'error',
        content: `Erro na comunicação com o servidor: ${err.message}`
      }]);
    } finally {
      setLoading(false);
      setProgress({ completed: 0, total: 0 });
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
  }

  const progressText = progress.total > 0
    ? `processando prontuário ${progress.completed + 1} de ${progress.total}...`
    : 'enviando para auditoria...';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 60px)', flex: 1, paddingBottom: isMobile ? '80px' : '0' }}>
      
      {/* Scrollable chat body */}
      <div style={{ flex: 1, padding: isMobile ? '12px 10px' : '24px 16px', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: isMobile ? '30px 0 20px' : '60px 0 40px' }}>
            <div style={{ fontSize: isMobile ? 36 : 48, marginBottom: 16 }}><Icon name="clipboard" size={isMobile ? 36 : 48} /></div>
            <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.03em' }}>
              Auditoria Inteligente de Prontuários
            </h1>
            <p style={{ color: 'var(--text2)', fontSize: isMobile ? 13 : 14, maxWidth: 440, margin: '0 auto 28px', lineHeight: 1.6 }}>
              Cole o JSON dos registros médicos no campo abaixo para iniciar uma auditoria real.
              Você pode enviar múltiplos prontuários simultaneamente.
            </p>
            <div style={{
              display: 'flex',
              gap: 16,
              justifyContent: 'center',
              flexWrap: 'wrap',
              marginTop: 24
            }}>
              <div style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '16px 20px',
                textAlign: 'center',
                minWidth: 140
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}><Icon name="upload" size={24} /></div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Enviar</div>
                <div style={{ fontSize: 10, color: 'var(--text2)' }}>Cole o JSON dos registros</div>
              </div>
              <div style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '16px 20px',
                textAlign: 'center',
                minWidth: 140
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}><Icon name="bot" size={24} /></div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Processar</div>
                <div style={{ fontSize: 10, color: 'var(--text2)' }}>Motor de IA audita os dados</div>
              </div>
              <div style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '16px 20px',
                textAlign: 'center',
                minWidth: 140
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}><Icon name="chart" size={24} /></div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Resultado</div>
                <div style={{ fontSize: 10, color: 'var(--text2)' }}>Relatório individualizado</div>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') return (
            <UserMessage key={i} content={msg.content} isMobile={isMobile} />
          );
          if (msg.type === 'error') return (
            <div key={i} style={{ marginBottom: 20 }}>
              <div style={{
                background: 'var(--red-bg)', border: '1px solid var(--red)',
                borderRadius: '2px 12px 12px 12px', padding: '12px 16px', color: 'var(--red)', fontSize: 13
              }}>
                <Icon name="alert" size={14} /> {msg.content}
              </div>
            </div>
          );
          if (msg.type === 'result') return (
            <div key={i} style={{ marginBottom: 24 }}>
              {msg.content._parcial && (
                <div role="alert" style={{
                  background: 'var(--yellow-bg)', border: '1px solid color-mix(in srgb, var(--yellow) 38%, transparent)', borderRadius: 10,
                  padding: '10px 14px', marginBottom: 10, fontSize: 12, color: 'var(--yellow)'
                }}>
                  <b>Auditoria incompleta.</b> A IA falhou em alguns campos deste prontuário; os itens que dependiam dela podem aparecer como não registrados.
                  {msg.content._aviso_ia && <div style={{ marginTop: 4, color: 'var(--text2)', fontFamily: 'var(--mono)', wordBreak: 'break-word' }}>{msg.content._aviso_ia}</div>}
                </div>
              )}
              <ResultCard r={msg.content} isMobile={isMobile} />
            </div>
          );
          return null;
        })}

        {loading && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: '2px 12px 12px 12px', padding: '16px 20px',
              display: 'flex', flexDirection: 'column', gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                      animation: 'pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s`
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 13, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
                  {progressText}
                </span>
              </div>
              {progress.total > 1 && (
                <div style={{ width: '100%', height: 4, background: 'var(--bg4)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    borderRadius: 2,
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input panel at the bottom */}
      <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg2)', padding: isMobile ? '10px' : '16px', position: 'sticky', bottom: isMobile ? 60 : 0 }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.15s' }}
            onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border2)'}>
            <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={isMobile ? 'Cole o JSON dos registros médicos...' : 'Cole o array JSON com os registros do atendimento...'}
              rows={isMobile ? 3 : 4}
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text)',
                fontFamily: 'var(--mono)', fontSize: 12,
                padding: '14px 16px', resize: 'none', lineHeight: 1.6
              }} />
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderTop: '1px solid var(--border)'
            }}>
              <div style={{ display: 'flex', gap: isMobile ? 4 : 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {input && (
                  <button onClick={() => { setInput(''); setMessages([]); }} style={{
                    background: 'transparent', border: '1px solid var(--border)',
                    color: 'var(--text3)', padding: '4px 8px', borderRadius: 6,
                    fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer'
                  }}>limpar</button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10 }}>
                {!isMobile && <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>Ctrl+Enter</span>}
                <button onClick={handleSend} disabled={!input.trim() || loading} style={{
                  background: input.trim() && !loading ? 'var(--accent)' : 'var(--bg4)',
                  border: 'none', color: input.trim() && !loading ? 'var(--on-accent)' : 'var(--text3)',
                  padding: isMobile ? '6px 12px' : '7px 18px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  transition: 'all 0.15s', fontFamily: 'var(--sans)'
                }}>
                  {loading ? 'processando...' : 'Auditar →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  );
}
