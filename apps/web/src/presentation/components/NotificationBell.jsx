import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../data/notificationsClient.js';
import { lastNotificationId, mergeNotifications, notificationText, pollDelayMs } from '../../domain/notifications.js';

const TONE_COLORS = { ok: 'var(--green)', warn: 'var(--yellow)', bad: 'var(--red)' };
const WHEN = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

/**
 * The bell in the header: unread count and the list. It lives at the top of the app, so the polling
 * goes on while the user moves between screens.
 */
export default function NotificationBell({ onOpenAudit }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const itemsRef = useRef(items);
  const boxRef = useRef(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const poll = useCallback(async () => {
    try {
      const body = await fetchNotifications(lastNotificationId(itemsRef.current));
      setItems((current) => mergeNotifications(current, body.notifications));
      setUnread(body.unread_count);
    } catch {
      // The next round asks again; a lost connection must not break the screen.
    }
  }, []);

  useEffect(() => {
    let timer;
    let stopped = false;

    const schedule = () => {
      timer = setTimeout(async () => {
        await poll();
        if (!stopped) schedule();
      }, pollDelayMs(document.hidden));
    };

    poll().then(() => !stopped && schedule());
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function handleOpenItem(n) {
    setOpen(false);
    if (!n.read_at) {
      try {
        const body = await markNotificationRead(n.id);
        setUnread(body.unread_count);
        setItems((current) => current.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      } catch {
        // Reading it later still works.
      }
    }
    if (n.audit_id !== null && n.audit_id !== undefined) onOpenAudit({ id: n.audit_id });
  }

  async function handleReadAll() {
    try {
      const body = await markAllNotificationsRead();
      setUnread(body.unread_count);
      const now = new Date().toISOString();
      setItems((current) => current.map((x) => ({ ...x, read_at: x.read_at ?? now })));
    } catch {
      // Left as it was.
    }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notificações: ${unread} não lidas` : 'Notificações'}
        aria-expanded={open}
        style={{
          background: 'none', border: '1px solid var(--border2)', borderRadius: 8, color: 'var(--text2)',
          padding: '5px 10px', fontSize: 14, cursor: 'pointer', position: 'relative',
        }}
      >
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, background: 'var(--red)', color: '#fff',
            borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(340px, 92vw)', zIndex: 30,
          background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10,
          boxShadow: '0 8px 30px rgba(0,0,0,0.4)', maxHeight: 420, overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Notificações</span>
            <button
              onClick={handleReadAll}
              disabled={unread === 0}
              style={{ background: 'none', border: 'none', color: unread === 0 ? 'var(--text3)' : 'var(--accent)', fontSize: 11, cursor: unread === 0 ? 'default' : 'pointer' }}
            >
              Marcar todas como lidas
            </button>
          </div>
          {items.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
              Nenhuma notificação.
            </div>
          )}
          {items.map((n) => {
            const text = notificationText(n);
            return (
              <button
                key={n.id}
                onClick={() => handleOpenItem(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: n.read_at ? 'transparent' : 'var(--bg3)',
                  border: 'none', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${TONE_COLORS[text.tone]}`,
                  padding: '10px 14px', cursor: 'pointer', color: 'var(--text)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: n.read_at ? 400 : 600 }}>{text.title}</div>
                {text.detail && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{text.detail}</div>}
                <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                  {new Date(n.created_at).toLocaleString('pt-BR', WHEN)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
