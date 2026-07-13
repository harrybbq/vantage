import { useEffect, useRef, useState, useCallback } from 'react';
import { listThread, sendMessage, markThreadRead } from '../../lib/friends/messages';

/**
 * MessagesModal — a 1:1 chat overlay with a single friend.
 *
 * Loads the thread, marks it read, and polls every 4s while open for
 * new messages (poll-based delivery — no Realtime dependency). Sending
 * is optimistic: the bubble appears immediately and reconciles when the
 * insert returns. Closes on backdrop click / Escape.
 */

const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}
function initials(name = '?') {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
}
function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}
function fmtDay(iso) {
  try {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const diff = Math.round((today - that) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

export default function MessagesModal({ open, userId, friend, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [errMsg, setErrMsg] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  // Only auto-scroll to the newest message when the user is already at
  // the bottom. Once they scroll up to read history, the 4s poll must
  // NOT yank them back down. `sigRef` also skips redundant state updates
  // when a poll returns an unchanged thread (no re-render, no scroll).
  const stickRef = useRef(true);
  const sigRef = useRef('');
  const friendId = friend?.id;

  function onScroll(e) {
    const el = e.currentTarget;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const refresh = useCallback(async (markRead = true) => {
    if (!userId || !friendId) return;
    try {
      const rows = await listThread(userId, friendId);
      const sig = `${rows.length}:${rows[rows.length - 1]?.id ?? ''}`;
      if (sig !== sigRef.current) { sigRef.current = sig; setMessages(rows); }
      setStatus('ready');
      if (markRead) markThreadRead(userId, friendId).catch(() => {});
    } catch (e) {
      setStatus('error');
      setErrMsg(e.message || 'Could not load messages.');
    }
  }, [userId, friendId]);

  // Load + poll while open.
  useEffect(() => {
    if (!open || !friendId) return undefined;
    setStatus('loading'); setMessages([]); setDraft('');
    sigRef.current = ''; stickRef.current = true;
    refresh(true);
    const id = setInterval(() => refresh(true), 4000);
    return () => clearInterval(id);
  }, [open, friendId, refresh]);

  // Escape to close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep pinned to the newest message ONLY when the user is at the
  // bottom — never interrupt them while they're scrolled up reading.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    // Sending always jumps you to the newest message.
    stickRef.current = true;
    // Optimistic bubble.
    const temp = { id: `tmp-${Date.now()}`, sender_id: userId, recipient_id: friendId, body: text, created_at: new Date().toISOString(), _pending: true };
    sigRef.current = ''; // force the next poll to reconcile
    setMessages(m => [...m, temp]);
    try {
      const saved = await sendMessage(userId, friendId, text);
      setMessages(m => m.map(x => x.id === temp.id ? saved : x));
    } catch (e) {
      // Roll the optimistic bubble back and surface why.
      setMessages(m => m.filter(x => x.id !== temp.id));
      setDraft(text);
      setErrMsg(e.message || 'Could not send.');
      setStatus('ready');
      window.setTimeout(() => setErrMsg(''), 4000);
    }
    setSending(false);
  }

  if (!open || !friend) return null;

  const name = friend.name || `@${friend.handle}`;

  return (
    <div className="msg-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="msg-modal" role="dialog" aria-label={`Messages with ${name}`}>
        <div className="msg-head">
          <div className="msg-head-who">
            {friend.avatar_url
              ? <img className="msg-avatar msg-avatar-img" src={friend.avatar_url} alt="" />
              : <div className="msg-avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>}
            <div>
              <div className="msg-head-name">{name}</div>
              <div className="msg-head-handle">@{friend.handle}</div>
            </div>
          </div>
          <button type="button" className="msg-close" onClick={() => onClose?.()} aria-label="Close">✕</button>
        </div>

        <div className="msg-scroll" ref={scrollRef} onScroll={onScroll}>
          {status === 'loading' && <div className="msg-empty">Loading…</div>}
          {status === 'error' && <div className="msg-empty msg-error">{errMsg}</div>}
          {status === 'ready' && messages.length === 0 && (
            <div className="msg-empty">No messages yet — say hi to {name.split(' ')[0]}.</div>
          )}
          {status === 'ready' && messages.map((m, i) => {
            const mine = m.sender_id === userId;
            const prev = messages[i - 1];
            const showDay = !prev || fmtDay(prev.created_at) !== fmtDay(m.created_at);
            return (
              <div key={m.id}>
                {showDay && <div className="msg-daysep">{fmtDay(m.created_at)}</div>}
                <div className={`msg-row ${mine ? 'mine' : 'theirs'}`}>
                  <div className={`msg-bubble${m._pending ? ' pending' : ''}`}>
                    {m.body}
                    <span className="msg-time">{fmtTime(m.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {errMsg && status === 'ready' && messages.length > 0 && (
          <div className="msg-inline-err">{errMsg}</div>
        )}

        <div className="msg-composer">
          <textarea
            className="msg-input"
            placeholder={`Message ${name.split(' ')[0]}…`}
            value={draft}
            rows={1}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            maxLength={2000}
          />
          <button type="button" className="msg-send" onClick={handleSend} disabled={!draft.trim() || sending} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
