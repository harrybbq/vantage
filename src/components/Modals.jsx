import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import AddMobileWidgetModal from './mobile/AddMobileWidgetModal';
import { APP_PRESETS, appPresetToLink } from '../data/appPresets';
import { periodStart } from '../lib/habits/strikes';
import { useSubscriptionContext } from '../context/SubscriptionContext';

function Modal({ id, openId, onClose, children, style }) {
  return (
    <div
      className={`modal-overlay${openId === id ? ' open' : ''}`}
      id={id}
      onClick={e => { if (e.target === e.currentTarget) onClose(id); }}
    >
      <div className="modal" style={style}>
        {children}
      </div>
    </div>
  );
}

// ── Add Widget picker ──
function AddLinkModal({ openId, onClose, onSwitchModal, onAddNotepad, onAddApp, onAddHubWidget }) {
  // Our Apps presets are a Pro bonus. Free users see them locked with
  // a PRO badge; clicking routes to the paywall instead of adding.
  const { hasPro } = useSubscriptionContext();
  function openPaywall() {
    onClose('addLinkModal');
    onSwitchModal('paywall:ourApps');
  }
  return (
    <Modal id="addLinkModal" openId={openId} onClose={onClose}>
      <h3>Add Widget</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '6px' }}>
        <button className="btn btn-ghost" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', borderRadius: '12px', height: 'auto' }}
          onClick={() => onSwitchModal('addLinkOnlyModal')}>
          <span style={{ fontSize: '22px' }}>🔗</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>Default Link</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>URL bookmark or GitHub profile</span>
        </button>
        <button className="btn btn-ghost" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', borderRadius: '12px', height: 'auto' }}
          onClick={() => { onClose('addLinkModal'); onAddNotepad(); }}>
          <span style={{ fontSize: '22px' }}>📝</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>Notepad</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Quick notes & tasks for today</span>
        </button>
        <button className="btn btn-ghost" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', borderRadius: '12px', height: 'auto' }}
          onClick={() => { onClose('addLinkModal'); onAddHubWidget('habits'); }}>
          <span style={{ fontSize: '22px' }}>◷</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>Habits</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Longest streaks · live timers</span>
        </button>
        <button className="btn btn-ghost" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', borderRadius: '12px', height: 'auto' }}
          onClick={() => { onClose('addLinkModal'); onAddHubWidget('holidays'); }}>
          <span style={{ fontSize: '22px' }}>✈</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>Holidays</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Closest upcoming trips</span>
        </button>
        <button className="btn btn-ghost" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', borderRadius: '12px', height: 'auto' }}
          onClick={() => { onClose('addLinkModal'); onAddHubWidget('leaderboard'); }}>
          <span style={{ fontSize: '22px' }}>⊿</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>Leaderboard</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Top friends, at a glance</span>
        </button>
      </div>

      {/* Our Apps — one-click presets for our own apps, a Pro bonus.
          Free users see them locked (PRO badge → paywall). For Pro
          users, a preset with no URL yet (not deployed) renders
          disabled with its deploy hint instead. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        margin: '14px 0 8px',
      }}>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.6,
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>Our Apps</span>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 8.5, fontWeight: 700,
          letterSpacing: 1, padding: '1px 6px', borderRadius: 4,
          background: 'rgba(200,151,10,.14)', color: 'var(--gold, #c8970a)',
          border: '1px solid rgba(200,151,10,.30)',
        }}>PRO</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {APP_PRESETS.map(preset => {
          // For Pro users: enabled unless the app isn't deployed yet.
          // For free users: always locked (clicking opens the paywall).
          const notDeployed = !preset.url;
          const locked = !hasPro;
          const dim = locked || notDeployed;
          const title = locked
            ? `${preset.name} is a Pro bonus — upgrade to add it`
            : notDeployed ? preset.requires : `Add ${preset.name} to your hub`;
          return (
            <button
              key={preset.id}
              className="btn btn-ghost"
              // Locked tiles stay clickable (→ paywall); only an
              // undeployed app for a Pro user is truly disabled.
              disabled={!locked && notDeployed}
              title={title}
              style={{
                padding: '16px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '6px', borderRadius: '12px', height: 'auto',
                position: 'relative',
                opacity: dim ? 0.6 : 1,
                cursor: (!locked && notDeployed) ? 'not-allowed' : 'pointer',
              }}
              onClick={() => {
                if (locked) { openPaywall(); return; }
                if (!notDeployed) onAddApp(preset);
              }}
            >
              {locked && (
                <span style={{
                  position: 'absolute', top: 8, right: 8,
                  fontSize: 11, lineHeight: 1, color: 'var(--gold, #c8970a)',
                }}>🔒</span>
              )}
              <span style={{
                width: 36, height: 36, borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, lineHeight: 1,
                background: preset.color + '1a',
                border: '1px solid ' + preset.color + '55',
              }}>{preset.icon}</span>
              <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{preset.name}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                {locked ? 'Pro bonus tool' : notDeployed ? 'Deploy first to enable' : preset.tagline}
              </span>
            </button>
          );
        })}
      </div>

      <div className="modal-actions" style={{ marginTop: '14px' }}>
        <button className="btn btn-ghost" onClick={() => onClose('addLinkModal')}>Cancel</button>
      </div>
    </Modal>
  );
}

// ── Add Link ──
function AddLinkOnlyModal({ openId, onClose, onAdd }) {
  const [form, setForm] = useState({ name: '', url: '', icon: '', color: '#1a7a4a', notes: '' });
  function submit() {
    if (!form.name || !form.url) return;
    const ghMatch = form.url.match(/github\.com\/([^\/\?#]+)/);
    const ghUser = ghMatch ? ghMatch[1] : null;
    onAdd({ id: 'l' + Date.now(), name: form.name, url: form.url, icon: form.icon || '🔗', color: form.color, notes: form.notes, ghUser });
    setForm({ name: '', url: '', icon: '', color: '#1a7a4a', notes: '' });
    onClose('addLinkOnlyModal');
  }
  return (
    <Modal id="addLinkOnlyModal" openId={openId} onClose={onClose}>
      <h3>Add Link</h3>
      <div className="fg"><label>Name</label><input type="text" placeholder="e.g. Twitter" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg"><label>URL</label><input type="url" placeholder="https://..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} /></div>
      <div className="fg"><label>Icon (emoji)</label><input type="text" placeholder="🔗" maxLength={2} value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} /></div>
      <div className="fg"><label>Colour</label><input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} /></div>
      <div className="fg"><label>Notes (optional)</label><input type="text" placeholder="Brief description..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addLinkOnlyModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add</button>
      </div>
    </Modal>
  );
}

// ── Add YouTube Widget ──
function AddYouTubeModal({ openId, onClose, onAdd }) {
  const [apiKey, setApiKey] = useState('');
  const [channelList, setChannelList] = useState('');
  function submit() {
    if (!apiKey || !channelList.trim()) return;
    const channels = channelList.split('\n').map(s => s.trim()).filter(Boolean);
    if (!channels.length) return;
    onAdd({ id: 'yt' + Date.now(), apiKey, channels });
    setApiKey(''); setChannelList('');
    onClose('addYouTubeModal');
  }
  return (
    <Modal id="addYouTubeModal" openId={openId} onClose={onClose} style={{ maxWidth: '500px' }}>
      <h3>▶ YouTube Subscriptions Feed</h3>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: '1.6' }}>
        Shows the 5 newest uploads from each of your subscribed channels. Requires a free <strong style={{ color: 'var(--text)' }}>YouTube Data API v3</strong> key from <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--em)' }}>Google Cloud Console</a>.
      </p>
      <div className="fg"><label>YouTube Data API v3 Key</label><input type="text" placeholder="AIzaSy..." value={apiKey} onChange={e => setApiKey(e.target.value)} /></div>
      <div className="fg">
        <label>Channel IDs or Handles (one per line)</label>
        <textarea
          placeholder={"@mkbhd\nUCBcRF18a7Qf58cCRy5xuWwQ\n@veritasium"}
          value={channelList}
          onChange={e => setChannelList(e.target.value)}
          style={{ height: '110px', resize: 'vertical', width: '100%', background: '#fff', border: '1px solid var(--border)', borderRadius: '9px', padding: '10px 13px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px', outline: 'none' }}
        />
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addYouTubeModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add Feed Widget</button>
      </div>
    </Modal>
  );
}

// ── Coin History ──
function CoinHistoryModal({ openId, onClose, coins, coinHistory }) {
  return (
    <Modal id="coinHistoryModal" openId={openId} onClose={onClose} style={{ maxWidth: '420px' }}>
      <h3>⬡ Coin Wallet</h3>
      <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '42px', fontWeight: 700, color: 'var(--gold)' }}>{coins}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '2px', textTransform: 'uppercase', marginTop: '4px' }}>Available Coins</div>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: '8px' }}>History</div>
      <div className="coin-history-list">
        {(!coinHistory || coinHistory.length === 0)
          ? <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-muted)', padding: '20px' }}>No transactions yet — complete achievements to earn coins!</div>
          : coinHistory.slice(0, 30).map((h, i) => {
            const pos = h.amount > 0;
            const label = h.type === 'earn' ? '⬡ Earned — ' : h.type === 'spend' ? '⬡ Spent on ' : '⬡ Refund — ';
            const ts = new Date(h.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            return (
              <div key={i} className="coin-hist-row">
                <div>
                  <div className="coin-hist-label">{label}{h.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>{ts}</div>
                </div>
                <div className={`coin-hist-amount ${pos ? 'pos' : 'neg'}`}>{pos ? '+' : ''}{h.amount}</div>
              </div>
            );
          })
        }
      </div>
      <div className="modal-actions" style={{ marginTop: '16px' }}>
        <button className="btn btn-ghost" onClick={() => onClose('coinHistoryModal')}>Close</button>
      </div>
    </Modal>
  );
}

// ── Add Achievement ──
const PRESET_EMOJIS = [
  '🏆','⭐','💰','🏠','🏃','🎯','📚','💪','🎓','🚗',
  '✈️','🏅','🎮','💻','🎸','🏋️','🌟','💎','🔑','🧘',
  '🎨','🏊','🚴','🌍','📱','🎤','🧠','💼','🏡','🎉',
  '🤝','📈','🍎','⚽','🎵','🧗','🦋','🌱','🔥','👑',
];

// Ranked-category options (F5 Sprint 3). Stored on each achievement
// and tracker; powers the per-category rating in src/lib/ratings.
const CATEGORY_OPTIONS = [
  { id: 'general', label: 'General',  desc: 'Not tied to a category — won\'t count toward ratings.' },
  { id: 'brain',   label: 'Brain',    desc: 'Knowledge, cognition, learning.' },
  { id: 'finance', label: 'Finance',  desc: 'Saving, earning, money management.' },
  { id: 'fitness', label: 'Fitness',  desc: 'Movement, health, physical practice.' },
  { id: 'social',  label: 'Social',   desc: 'Friends, connection, community.' },
];

function CategoryPicker({ value, onChange }) {
  return (
    <div className="fg">
      <label>Category</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CATEGORY_OPTIONS.map(c => {
          const active = (value || 'general') === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              title={c.desc}
              style={{
                padding: '6px 12px', borderRadius: 6,
                fontFamily: 'var(--mono)', fontSize: 11,
                letterSpacing: 0.6, fontWeight: 600,
                cursor: 'pointer',
                border: active ? '2px solid var(--em)' : '2px solid var(--border)',
                background: active ? 'rgba(var(--em-rgb), 0.12)' : 'transparent',
                color: active ? 'var(--em)' : 'var(--text)',
                transition: 'all .12s',
              }}
            >{c.label}</button>
          );
        })}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
        {(CATEGORY_OPTIONS.find(c => c.id === (value || 'general')) || {}).desc}
      </div>
    </div>
  );
}

function AddAchievementModal({ openId, onClose, onAdd }) {
  const [form, setForm] = useState({ name: '', desc: '', icon: '', coins: '', category: 'general' });
  function submit() {
    if (!form.name) return;
    onAdd({
      id: 'a' + Date.now(),
      name: form.name,
      desc: form.desc,
      icon: form.icon || '🏆',
      x: 40 + Math.random() * 360,
      y: 40 + Math.random() * 260,
      completed: false,
      coins: parseInt(form.coins) || 0,
      category: form.category || 'general',
      createdAt: Date.now(),
    });
    setForm({ name: '', desc: '', icon: '', coins: '', category: 'general' });
    onClose('addAchievementModal');
  }
  return (
    <Modal id="addAchievementModal" openId={openId} onClose={onClose}>
      <h3>New Achievement</h3>
      <div className="fg"><label>Title</label><input type="text" placeholder="e.g. Save £10,000" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg"><label>Description</label><input type="text" placeholder="e.g. Build emergency fund" value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} /></div>
      <div className="fg">
        <label>Icon</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
          {PRESET_EMOJIS.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setForm(f => ({ ...f, icon: e }))}
              style={{
                fontSize: '18px', padding: '4px', borderRadius: '7px', cursor: 'pointer', lineHeight: 1,
                border: form.icon === e ? '2px solid var(--em)' : '2px solid transparent',
                background: form.icon === e ? 'rgba(42,158,98,0.15)' : 'rgba(0,0,0,0.06)',
                transition: 'all .12s',
              }}
            >{e}</button>
          ))}
        </div>
        <input type="text" placeholder="Or type a custom emoji…" maxLength={2} value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
      </div>
      <div className="fg"><label>⬡ Coin Reward on Completion</label><input type="number" placeholder="e.g. 50" min="0" value={form.coins} onChange={e => setForm(f => ({ ...f, coins: e.target.value }))} /></div>
      <CategoryPicker value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addAchievementModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Create</button>
      </div>
    </Modal>
  );
}

// ── Edit Achievement ──
function EditAchievementModal({ openId, onClose, achievements, onEdit, onDelete }) {
  // openId format: 'editAchievementModal:${id}'. Mirrors EditHabitModal
  // — keeps the parsing pattern consistent across edit modals.
  const isOpen = typeof openId === 'string' && openId.startsWith('editAchievementModal:');
  const achId = isOpen ? openId.split(':')[1] : null;
  const ach = achId ? (achievements || []).find(a => a.id === achId) : null;

  const [form, setForm] = useState({ name: '', desc: '', icon: '', coins: '', category: 'general' });

  // Sync form when the target achievement changes (i.e. modal opens
  // for a new id). Don't sync on every render — that wipes user edits.
  useEffect(() => {
    if (ach) {
      setForm({
        name: ach.name || '',
        desc: ach.desc || '',
        icon: ach.icon || '',
        coins: ach.coins != null ? String(ach.coins) : '',
        category: ach.category || 'general',
      });
    }
  }, [achId]);

  if (!isOpen || !ach) return null;

  function submit() {
    if (!form.name.trim()) return;
    onEdit(achId, {
      name: form.name.trim(),
      desc: form.desc.trim(),
      icon: form.icon || ach.icon || '🏆',
      coins: parseInt(form.coins) || 0,
      category: form.category || 'general',
    });
    onClose(openId);
  }

  function handleDelete() {
    if (!window.confirm('Delete this achievement? Any connections to/from it will be removed too. This cannot be undone.')) return;
    onDelete(achId);
    onClose(openId);
  }

  return (
    <Modal id={openId} openId={openId} onClose={onClose}>
      <h3>Edit Achievement</h3>
      <div className="fg"><label>Title</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg"><label>Description</label><input type="text" value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} /></div>
      <div className="fg">
        <label>Icon</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
          {PRESET_EMOJIS.map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setForm(f => ({ ...f, icon: e }))}
              style={{
                fontSize: '18px', padding: '4px', borderRadius: '7px', cursor: 'pointer', lineHeight: 1,
                border: form.icon === e ? '2px solid var(--em)' : '2px solid transparent',
                background: form.icon === e ? 'rgba(42,158,98,0.15)' : 'rgba(0,0,0,0.06)',
                transition: 'all .12s',
              }}
            >{e}</button>
          ))}
        </div>
        <input type="text" placeholder="Or type a custom emoji…" maxLength={2} value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} />
      </div>
      <div className="fg"><label>⬡ Coin Reward on Completion</label><input type="number" min="0" value={form.coins} onChange={e => setForm(f => ({ ...f, coins: e.target.value }))} /></div>
      <CategoryPicker value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} />
      {ach.completed && (
        <div style={{
          padding: '10px 12px', borderRadius: '8px', marginBottom: '12px',
          background: 'rgba(200,151,10,0.10)', border: '1px solid rgba(200,151,10,0.32)',
          fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text)',
          lineHeight: 1.5,
        }}>
          This achievement is completed. Editing the coin reward won't refund or re-award coins —
          that's intentional so historical reward totals stay honest.
        </div>
      )}
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-ghost" onClick={handleDelete} style={{ color: 'rgb(220,60,60)' }}>Delete</button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add Savings Goal (F4 Sprint 2) ──
function AddSavingsGoalModal({ openId, onClose, achievements, onAdd }) {
  const [form, setForm] = useState({ name: '', icon: '💰', target: '', achievementId: '', targetDate: '', image: null });
  function submit() {
    const target = parseFloat(form.target);
    if (!form.name.trim() || !target || target <= 0) return;
    onAdd({
      id: 'sv' + Date.now(),
      name: form.name.trim(),
      icon: form.icon || '💰',
      target,
      current: 0,
      contributions: [],
      achievementId: form.achievementId || null,
      targetDate: form.targetDate || null,
      image: form.image || null,
      createdAt: new Date().toISOString(),
    });
    setForm({ name: '', icon: '💰', target: '', achievementId: '', targetDate: '', image: null });
    onClose('addSavingsGoalModal');
  }
  const linkable = (achievements || []).filter(a => !a.completed);
  return (
    <Modal id="addSavingsGoalModal" openId={openId} onClose={onClose}>
      <h3>New Savings Goal</h3>
      <div className="fg"><label>Name</label><input type="text" placeholder="e.g. First Home" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg">
        <label>Icon</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {['💰','🏠','🚗','💍','✈️','🎓','🏥','📱','🎮','💸'].map(e => (
            <button key={e} type="button" onClick={() => setForm(f => ({ ...f, icon: e }))}
              style={{ fontSize: '18px', padding: '4px', borderRadius: '7px', cursor: 'pointer', lineHeight: 1,
                border: form.icon === e ? '2px solid var(--em)' : '2px solid transparent',
                background: form.icon === e ? 'rgba(42,158,98,0.15)' : 'rgba(0,0,0,0.06)',
              }}>{e}</button>
          ))}
        </div>
      </div>
      <div className="fg"><label>Target (£)</label><input type="number" min="1" step="any" placeholder="10000" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} /></div>
      <div className="fg">
        <label>Target date (optional)</label>
        <input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Lets the card show a monthly contribution target.
        </div>
      </div>
      <SavingsImagePicker
        image={form.image}
        onChange={img => setForm(f => ({ ...f, image: img }))}
      />
      {linkable.length > 0 && (
        <div className="fg">
          <label>Link to an achievement (optional)</label>
          <select value={form.achievementId} onChange={e => setForm(f => ({ ...f, achievementId: e.target.value }))}>
            <option value="">— none —</option>
            {linkable.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Linked achievement auto-completes when this goal hits target.
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addSavingsGoalModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Create</button>
      </div>
    </Modal>
  );
}

/**
 * Image picker for savings goals. Resizes client-side to 600px on the
 * long edge as JPEG @ 0.78 so we don't blow up the user_data JSON blob.
 * Typical output: 30-60 KB. The original file is never persisted.
 */
function SavingsImagePicker({ image, onChange }) {
  // Ref instead of a shared element id — the Add and Edit modals are
  // both mounted, so a hardcoded id collided (getElementById returned
  // the wrong modal's input and the picker silently did nothing).
  const inputRef = useRef(null);
  function pick() { inputRef.current?.click(); }
  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const MAX = 600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        onChange(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  return (
    <div className="fg">
      <label>Photo (optional)</label>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          onClick={pick}
          style={{
            width: 64, height: 64, borderRadius: 10, cursor: 'pointer',
            border: '1px dashed var(--border)',
            background: image
              ? `center/cover no-repeat url(${image})`
              : 'linear-gradient(135deg, rgba(var(--em-rgb),.18), rgba(var(--em-rgb),.06))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, color: 'var(--em)', overflow: 'hidden',
          }}
          title="Click to choose a photo"
        >{!image && '🖼'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={pick} style={{ padding: '6px 12px' }}>
            {image ? 'Change photo' : 'Choose photo'}
          </button>
          {image && (
            <button type="button" className="btn btn-ghost" onClick={() => onChange(null)} style={{ padding: '4px 12px', color: 'rgb(220,60,60)', fontSize: 12 }}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add Contribution to a Savings Goal ──
function AddContributionModal({ openId, onClose, savings, onAdd }) {
  // openId format: 'addContributionModal:<savingsId>'
  const isOpen = typeof openId === 'string' && openId.startsWith('addContributionModal:');
  const goalId = isOpen ? openId.split(':')[1] : null;
  const goal = goalId ? (savings || []).find(g => g.id === goalId) : null;
  const [form, setForm] = useState({ amount: '', note: '' });
  useEffect(() => { if (goalId) setForm({ amount: '', note: '' }); }, [goalId]);
  if (!isOpen || !goal) return null;
  function submit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount === 0) return;
    onAdd(goalId, { id: 'c' + Date.now(), amount, note: form.note.trim() || null, ts: new Date().toISOString() });
    onClose(openId);
  }
  return (
    <Modal id={openId} openId={openId} onClose={onClose}>
      <h3>Add to {goal.name}</h3>
      <div className="fg"><label>Amount (£) — negative to subtract</label><input type="number" step="any" placeholder="200" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} autoFocus /></div>
      <div className="fg"><label>Note (optional)</label><input type="text" placeholder="e.g. Bonus, Tax refund" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add</button>
      </div>
    </Modal>
  );
}

// ── Edit Savings Goal ──
function EditSavingsGoalModal({ openId, onClose, savings, achievements, onEdit, onDelete }) {
  const isOpen = typeof openId === 'string' && openId.startsWith('editSavingsGoalModal:');
  const goalId = isOpen ? openId.split(':')[1] : null;
  const goal = goalId ? (savings || []).find(g => g.id === goalId) : null;
  const [form, setForm] = useState({ name: '', icon: '💰', target: '', achievementId: '', targetDate: '', image: null });
  useEffect(() => {
    if (goal) setForm({
      name: goal.name || '',
      icon: goal.icon || '💰',
      target: String(goal.target || ''),
      achievementId: goal.achievementId || '',
      targetDate: goal.targetDate || '',
      image: goal.image || null,
    });
  }, [goalId]);
  if (!isOpen || !goal) return null;
  function submit() {
    const target = parseFloat(form.target);
    if (!form.name.trim() || !target || target <= 0) return;
    onEdit(goalId, {
      name: form.name.trim(),
      icon: form.icon || '💰',
      target,
      achievementId: form.achievementId || null,
      targetDate: form.targetDate || null,
      image: form.image || null,
    });
    onClose(openId);
  }
  function handleDelete() {
    if (!window.confirm('Delete this savings goal? Contribution history will be lost. This cannot be undone.')) return;
    onDelete(goalId);
    onClose(openId);
  }
  const linkable = (achievements || []).filter(a => !a.completed || a.id === goal.achievementId);
  return (
    <Modal id={openId} openId={openId} onClose={onClose}>
      <h3>Edit Savings Goal</h3>
      <div className="fg"><label>Name</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg">
        <label>Icon</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {['💰','🏠','🚗','💍','✈️','🎓','🏥','📱','🎮','💸'].map(e => (
            <button key={e} type="button" onClick={() => setForm(f => ({ ...f, icon: e }))}
              style={{ fontSize: '18px', padding: '4px', borderRadius: '7px', cursor: 'pointer', lineHeight: 1,
                border: form.icon === e ? '2px solid var(--em)' : '2px solid transparent',
                background: form.icon === e ? 'rgba(42,158,98,0.15)' : 'rgba(0,0,0,0.06)',
              }}>{e}</button>
          ))}
        </div>
      </div>
      <div className="fg"><label>Target (£)</label><input type="number" min="1" step="any" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} /></div>
      <div className="fg">
        <label>Target date (optional)</label>
        <input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
      </div>
      <SavingsImagePicker
        image={form.image}
        onChange={img => setForm(f => ({ ...f, image: img }))}
      />
      <div className="fg">
        <label>Linked achievement</label>
        <select value={form.achievementId} onChange={e => setForm(f => ({ ...f, achievementId: e.target.value }))}>
          <option value="">— none —</option>
          {linkable.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
      </div>
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-ghost" onClick={handleDelete} style={{ color: 'rgb(220,60,60)' }}>Delete</button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add Tracker ──
function AddTrackerModal({ openId, onClose, onAdd }) {
  const [form, setForm] = useState({ name: '', type: 'boolean', unit: '', goal: '', color: '#1a7a4a', weeklyTarget: '', weeklyCoins: '', category: 'general' });
  const isNumber = form.type === 'number';
  function submit() {
    if (!form.name) return;
    onAdd({
      id: 't' + Date.now(),
      name: form.name,
      type: form.type,
      unit: form.unit,
      goal: parseFloat(form.goal) || null,
      color: form.color,
      weeklyTarget: parseInt(form.weeklyTarget) || null,
      weeklyCoins: parseInt(form.weeklyCoins) || null,
      category: form.category || 'general',
    });
    setForm({ name: '', type: 'boolean', unit: '', goal: '', color: '#1a7a4a', weeklyTarget: '', weeklyCoins: '', category: 'general' });
    onClose('addTrackerModal');
  }
  return (
    <Modal id="addTrackerModal" openId={openId} onClose={onClose}>
      <h3>New Tracker</h3>
      <div className="fg"><label>Name</label><input type="text" placeholder="e.g. Gym Session" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg">
        <label>Type</label>
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
          <option value="boolean">✓ / ✗  (Yes or No)</option>
          <option value="number">Number (e.g. amount saved)</option>
        </select>
      </div>
      {isNumber && <div className="fg"><label>Unit</label><input type="text" placeholder="£, g, km..." value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} /></div>}
      {isNumber && <div className="fg"><label>Monthly Target</label><input type="number" placeholder="500" value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} /></div>}
      <div className="fg"><label>Colour</label><input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} /></div>
      <div style={{ borderTop: '1px solid var(--border-lt)', margin: '14px 0' }}></div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--em-mid)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px' }}>⬡ Weekly Coin Challenge (optional)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="fg" style={{ marginBottom: 0 }}><label>Times per week</label><input type="number" placeholder="e.g. 5" min="1" max="7" value={form.weeklyTarget} onChange={e => setForm(f => ({ ...f, weeklyTarget: e.target.value }))} /></div>
        <div className="fg" style={{ marginBottom: 0 }}><label>⬡ Coins reward</label><input type="number" placeholder="e.g. 10" min="1" value={form.weeklyCoins} onChange={e => setForm(f => ({ ...f, weeklyCoins: e.target.value }))} /></div>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', marginTop: '6px' }}>Hit the weekly target to earn coins every week.</div>
      <div style={{ borderTop: '1px solid var(--border-lt)', margin: '14px 0' }}></div>
      <CategoryPicker value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addTrackerModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add</button>
      </div>
    </Modal>
  );
}

// ── Multi-log modal ──
function MultiLogModal({ openId, onClose, trackers, multiSelectedDays, onSave }) {
  function submit() {
    const logs = {};
    trackers.forEach(t => {
      const el = document.getElementById('mlog-' + t.id);
      if (!el) return;
      if (t.type === 'boolean') { if (el.checked) logs[t.id] = true; }
      else { const v = parseFloat(el.value); if (!isNaN(v) && v !== 0) logs[t.id] = v; }
    });
    onSave(logs);
    onClose('multiLogModal');
  }
  return (
    <Modal id="multiLogModal" openId={openId} onClose={onClose}>
      <h3>Log for {multiSelectedDays.length} selected day{multiSelectedDays.length !== 1 ? 's' : ''}</h3>
      <div>
        {!trackers.length
          ? <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: '12px' }}>Add trackers first.</div>
          : trackers.map(t => (
            <div key={t.id} className="log-entry-row">
              <label className="log-entry-label">
                <div className="log-dot" style={{ background: t.color }}></div>
                {t.name}
              </label>
              {t.type === 'boolean'
                ? <input type="checkbox" className="log-checkbox" id={`mlog-${t.id}`} />
                : <input type="number" className="log-number-input" id={`mlog-${t.id}`} placeholder={t.unit || '0'} />
              }
            </div>
          ))
        }
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('multiLogModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Apply to All</button>
      </div>
    </Modal>
  );
}

// ── Add Shop Item ──
function AddShopModal({ openId, onClose, onAdd, categories = [] }) {
  const [form, setForm] = useState({ name: '', price: '', url: '', imageUrl: '', priority: 'med', notes: '', coinCost: '', categoryId: '' });
  const [status, setStatus] = useState('');
  const [fetching, setFetching] = useState(false);
  const timerRef = useRef(null);

  async function runAutofill(url) {
    if (!url || !url.startsWith('http')) return;
    setStatus('⏳ Fetching product info…');
    setFetching(true);
    try {
      // Routed through a Netlify function — calling Anthropic / fetching
      // arbitrary URLs from the browser is blocked by CORS and would
      // also leak the API key. The function does OG / JSON-LD / Twitter
      // Card extraction server-side. No API spend.
      const resp = await fetch('/.netlify/functions/shop-autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await resp.json();
      if (data && data.ok && (data.name || data.imageUrl)) {
        setForm(f => ({
          ...f,
          name:     f.name     || data.name     || '',
          price:    f.price    || data.price    || '',
          imageUrl: data.imageUrl || f.imageUrl || '',
          notes:    f.notes    || data.notes    || '',
        }));
        setStatus('✓ Auto-filled from URL');
      } else {
        setStatus('Could not extract info — fill in manually');
      }
    } catch {
      setStatus('Auto-fill unavailable — fill in manually');
    }
    setFetching(false);
  }

  function handleUrlChange(val) {
    setForm(f => ({ ...f, url: val }));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runAutofill(val), 900);
  }

  function submit() {
    if (!form.name) return;
    onAdd({
      id: 's' + Date.now(),
      name: form.name,
      categoryId: form.categoryId || null,
      price: form.price,
      url: form.url,
      imageUrl: form.imageUrl,
      priority: form.priority,
      notes: form.notes,
      coinCost: parseInt(form.coinCost) || 0,
      bought: false,
    });
    setForm({ name: '', price: '', url: '', imageUrl: '', priority: 'med', notes: '', coinCost: '', categoryId: '' });
    setStatus('');
    onClose('addShopModal');
  }

  return (
    <Modal id="addShopModal" openId={openId} onClose={onClose}>
      <h3>Add Item</h3>
      <div className="fg">
        <label>Link (optional — paste to auto-fill)</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input type="url" placeholder="https://amazon.co.uk/..." style={{ flex: 1 }} value={form.url} onChange={e => handleUrlChange(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={fetching} onClick={() => runAutofill(form.url)} style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>Fill ↓</button>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: status.startsWith('✓') ? 'var(--em)' : 'var(--text-muted)', marginTop: '5px', minHeight: '14px' }}>{status}</div>
      </div>
      <div className="fg"><label>Item Name</label><input type="text" placeholder="e.g. AirPods Pro" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg"><label>Price (optional)</label><input type="text" placeholder="£149.99" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
      <div className="fg"><label>Image URL (optional)</label><input type="url" placeholder="Auto-filled from link, or paste directly" value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} /></div>
      <div className="fg">
        <label>Priority</label>
        <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
          <option value="high">🔴 High — want soon</option>
          <option value="med">🟡 Medium</option>
          <option value="low">🟢 Low — nice to have</option>
        </select>
      </div>
      <div className="fg">
        <label>Category</label>
        <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
          <option value="">Uncategorised</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="fg"><label>Notes</label><input type="text" placeholder="Why you want it, alternatives..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="fg"><label>⬡ Coin Cost (optional)</label><input type="number" placeholder="e.g. 100" min="0" value={form.coinCost} onChange={e => setForm(f => ({ ...f, coinCost: e.target.value }))} /></div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addShopModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add Item</button>
      </div>
    </Modal>
  );
}

// ── Edit Shop Item ──
function EditShopModal({ openId, onClose, shopItems, categories = [], onEdit, onDelete }) {
  const isOpen = typeof openId === 'string' && openId.startsWith('editShopModal:');
  const itemId = isOpen ? openId.split(':')[1] : null;
  const item = itemId ? (shopItems || []).find(s => s.id === itemId) : null;
  const [form, setForm] = useState({ name: '', price: '', url: '', imageUrl: '', priority: 'med', notes: '', coinCost: '', categoryId: '' });
  useEffect(() => {
    if (item) setForm({
      name: item.name || '',
      price: item.price || '',
      url: item.url || '',
      imageUrl: item.imageUrl || '',
      priority: item.priority || 'med',
      notes: item.notes || '',
      coinCost: item.coinCost ? String(item.coinCost) : '',
      categoryId: item.categoryId || '',
    });
  }, [itemId]);
  if (!isOpen || !item) return null;
  function submit() {
    if (!form.name) return;
    onEdit(itemId, {
      name: form.name,
      price: form.price,
      url: form.url,
      imageUrl: form.imageUrl,
      priority: form.priority,
      notes: form.notes,
      coinCost: parseInt(form.coinCost) || 0,
      categoryId: form.categoryId || null,
    });
    onClose(openId);
  }
  function handleDelete() {
    if (!window.confirm('Delete this item? This cannot be undone.')) return;
    onDelete(itemId);
    onClose(openId);
  }
  return (
    <Modal id={openId} openId={openId} onClose={onClose}>
      <h3>Edit Item</h3>
      <div className="fg"><label>Item Name</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg"><label>Price (optional)</label><input type="text" placeholder="£149.99" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
      <div className="fg"><label>Link (optional)</label><input type="url" placeholder="https://..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} /></div>
      <div className="fg"><label>Image URL (optional)</label><input type="url" placeholder="https://..." value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} /></div>
      <div className="fg">
        <label>Priority</label>
        <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
          <option value="high">🔴 High — want soon</option>
          <option value="med">🟡 Medium</option>
          <option value="low">🟢 Low — nice to have</option>
        </select>
      </div>
      <div className="fg">
        <label>Category</label>
        <select value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
          <option value="">Uncategorised</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="fg"><label>Notes</label><input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="fg"><label>⬡ Coin Cost (optional)</label><input type="number" min="0" value={form.coinCost} onChange={e => setForm(f => ({ ...f, coinCost: e.target.value }))} /></div>
      <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-ghost" onClick={handleDelete} style={{ color: 'rgb(220,60,60)' }}>Delete</button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add Category ──
function AddCategoryModal({ openId, onClose, onAdd }) {
  const [name, setName] = useState('');
  function submit() {
    if (!name.trim()) return;
    onAdd({ id: 'c' + Date.now(), name: name.trim() });
    setName('');
    onClose('addCategoryModal');
  }
  return (
    <Modal id="addCategoryModal" openId={openId} onClose={onClose}>
      <h3>New Category</h3>
      <div className="fg"><label>Category Name</label><input type="text" placeholder="e.g. Clothes, Tech, Books" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} /></div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addCategoryModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Create</button>
      </div>
    </Modal>
  );
}

// ── Add Holiday ──
function AddHolidayModal({ openId, onClose, onAdd }) {
  const [form, setForm] = useState({ dest: '', from: '', to: '', accom: '', flight: '', budget: '', status: 'planning', notes: '', imageUrl: '' });
  function submit() {
    if (!form.dest.trim()) return;
    onAdd({ id: 'h' + Date.now(), ...form });
    setForm({ dest: '', from: '', to: '', accom: '', flight: '', budget: '', status: 'planning', notes: '', imageUrl: '' });
    onClose('addHolidayModal');
  }
  return (
    <Modal id="addHolidayModal" openId={openId} onClose={onClose} style={{ maxWidth: '480px' }}>
      <h3>Plan a Holiday</h3>
      <div className="fg"><label>Destination</label><input type="text" placeholder="e.g. Lisbon, Portugal" value={form.dest} onChange={e => setForm(f => ({ ...f, dest: e.target.value }))} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="fg"><label>Departure</label><input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></div>
        <div className="fg"><label>Return</label><input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></div>
      </div>
      <div className="fg"><label>Accommodation</label><input type="text" placeholder="e.g. Hotel Lisboa, Airbnb..." value={form.accom} onChange={e => setForm(f => ({ ...f, accom: e.target.value }))} /></div>
      <div className="fg"><label>Flight Info</label><input type="text" placeholder="e.g. EasyJet EZY1234, 06:30 LGW→LIS" value={form.flight} onChange={e => setForm(f => ({ ...f, flight: e.target.value }))} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="fg"><label>Total Budget</label><input type="text" placeholder="£1,200" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
        <div className="fg">
          <label>Status</label>
          <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="planning">🟡 Planning</option>
            <option value="booked">🟢 Booked</option>
            <option value="completed">✓ Completed</option>
          </select>
        </div>
      </div>
      <div className="fg"><label>Cover Image URL (optional)</label><input type="url" placeholder="https://… paste any photo URL" value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} /></div>
      <div className="fg"><label>Notes</label><input type="text" placeholder="Things to do, pack list, ideas..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={() => onClose('addHolidayModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Add Trip</button>
      </div>
    </Modal>
  );
}

// ── Edit Holiday ──
function EditHolidayModal({ openId, onClose, holidays, onEdit, onDelete }) {
  // openId format: 'editHolidayModal:${id}'
  const isOpen = typeof openId === 'string' && openId.startsWith('editHolidayModal:');
  const holidayId = isOpen ? openId.split(':')[1] : null;
  const holiday = holidayId ? (holidays || []).find(h => h.id === holidayId) : null;

  const [form, setForm] = useState({ dest: '', from: '', to: '', accom: '', flight: '', budget: '', status: 'planning', notes: '', imageUrl: '' });

  // Sync form when holiday changes
  useEffect(() => {
    if (holiday) {
      setForm({
        dest: holiday.dest || '',
        from: holiday.from || '',
        to: holiday.to || '',
        accom: holiday.accom || '',
        flight: holiday.flight || '',
        budget: holiday.budget || '',
        status: holiday.status || 'planning',
        notes: holiday.notes || '',
        imageUrl: holiday.imageUrl || '',
      });
    }
  }, [holidayId]);

  function submit() {
    if (!form.dest.trim() || !holidayId) return;
    onEdit(holidayId, form);
    onClose(openId);
  }

  function handleDelete() {
    if (!holidayId) return;
    if (!window.confirm('Delete this trip? This cannot be undone.')) return;
    onDelete(holidayId);
    onClose(openId);
  }

  return (
    <div
      className={`modal-overlay${isOpen ? ' open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(openId); }}
    >
      <div className="modal" style={{ maxWidth: '480px' }}>
        <h3>Edit Trip</h3>
        <div className="fg"><label>Destination</label><input type="text" placeholder="e.g. Lisbon, Portugal" value={form.dest} onChange={e => setForm(f => ({ ...f, dest: e.target.value }))} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="fg"><label>Departure</label><input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></div>
          <div className="fg"><label>Return</label><input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></div>
        </div>
        <div className="fg"><label>Accommodation</label><input type="text" placeholder="e.g. Hotel Lisboa, Airbnb..." value={form.accom} onChange={e => setForm(f => ({ ...f, accom: e.target.value }))} /></div>
        <div className="fg"><label>Flight Info</label><input type="text" placeholder="e.g. EasyJet EZY1234, 06:30 LGW→LIS" value={form.flight} onChange={e => setForm(f => ({ ...f, flight: e.target.value }))} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="fg"><label>Total Budget</label><input type="text" placeholder="£1,200" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} /></div>
          <div className="fg">
            <label>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="planning">🟡 Planning</option>
              <option value="booked">🟢 Booked</option>
              <option value="completed">✓ Completed</option>
            </select>
          </div>
        </div>
        <div className="fg"><label>Cover Image URL (optional)</label><input type="url" placeholder="https://… paste any photo URL" value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} /></div>
        <div className="fg"><label>Notes</label><input type="text" placeholder="Things to do, pack list, ideas..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleDelete}
            style={{ marginRight: 'auto' }}
          >Delete Trip</button>
          <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Habit ──
function AddHabitModal({ openId, onClose, onAdd }) {
  const emptyMs = () => ({ _id: 'ms' + Date.now() + Math.random(), amount: '1', unit: 'weeks', coins: '' });
  const [form, setForm] = useState({ name: '', color: '#1a7a4a', endless: false, strikes: '0', strikesUnit: 'week', milestones: [emptyMs()] });

  function toDuration(amount, unit) {
    const mul = { hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
    return parseInt(amount) * (mul[unit] || mul.days);
  }
  function msLabel(amount, unit) {
    const n = parseInt(amount);
    const s = { hours: 'hour', days: 'day', weeks: 'week', months: 'month' };
    return `${n} ${n === 1 ? s[unit] : unit}`;
  }
  function updateMs(_id, key, val) {
    setForm(f => ({ ...f, milestones: f.milestones.map(m => m._id === _id ? { ...m, [key]: val } : m) }));
  }
  function removeMs(_id) {
    setForm(f => ({ ...f, milestones: f.milestones.filter(m => m._id !== _id) }));
  }

  function submit() {
    if (!form.name.trim()) return;
    const milestones = form.milestones
      .filter(m => m.amount && m.coins && parseInt(m.coins) > 0)
      .map((m, i) => ({
        id: 'm' + Date.now() + i,
        duration: toDuration(parseInt(m.amount), m.unit),
        coins: parseInt(m.coins),
        label: msLabel(parseInt(m.amount), m.unit),
        awarded: false,
      }))
      .sort((a, b) => a.duration - b.duration);
    onAdd({
      id: 'hb' + Date.now(),
      name: form.name.trim(),
      color: form.color,
      endless: form.endless,
      startTime: Date.now(),
      relapseCount: 0,
      strikesAllowed: parseInt(form.strikes) || 0,
      strikesPeriod: form.strikesUnit,
      strikeTimes: [],
      milestones,
    });
    setForm({ name: '', color: '#1a7a4a', endless: false, strikes: '0', strikesUnit: 'week', milestones: [emptyMs()] });
    onClose('addHabitModal');
  }

  return (
    <Modal id="addHabitModal" openId={openId} onClose={onClose} style={{ maxWidth: '460px' }}>
      <h3>New Habit</h3>
      <div className="fg"><label>Habit Name</label><input type="text" placeholder="e.g. Alcohol, Fast Food, Smoking..." value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="fg"><label>Colour</label><input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} /></div>

      <div style={{ borderTop: '1px solid var(--border-lt)', margin: '14px 0' }}></div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--em-mid)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>⬡ Reward Milestones</div>

      {form.milestones.map((m, i) => (
        <div key={m._id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '10px' }}>
          <div className="fg" style={{ flex: '0 0 54px', marginBottom: 0 }}>
            {i === 0 && <label style={{ fontSize: '9px' }}>After</label>}
            <input type="number" min="1" value={m.amount} onChange={e => updateMs(m._id, 'amount', e.target.value)} style={{ textAlign: 'center' }} />
          </div>
          <div className="fg" style={{ flex: 1, marginBottom: 0 }}>
            {i === 0 && <label style={{ fontSize: '9px' }}>Unit</label>}
            <select value={m.unit} onChange={e => updateMs(m._id, 'unit', e.target.value)}>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
            </select>
          </div>
          <div className="fg" style={{ flex: '0 0 72px', marginBottom: 0 }}>
            {i === 0 && <label style={{ fontSize: '9px' }}>⬡ Coins</label>}
            <input type="number" min="1" placeholder="e.g. 20" value={m.coins} onChange={e => updateMs(m._id, 'coins', e.target.value)} />
          </div>
          <button
            onClick={() => removeMs(m._id)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: '8px 4px', flexShrink: 0, lineHeight: 1, marginBottom: '1px' }}
          >✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, milestones: [...f.milestones, emptyMs()] }))} style={{ marginBottom: '14px', fontSize: '12px' }}>
        + Add Milestone
      </button>

      <div style={{ borderTop: '1px solid var(--border-lt)', margin: '4px 0 14px' }}></div>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={form.endless} onChange={e => setForm(f => ({ ...f, endless: e.target.checked }))} style={{ marginTop: '3px', accentColor: 'var(--em)', flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>∞ Endless</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Track this habit forever — the counter never ends, even after all milestones are earned</div>
        </div>
      </label>

      <div style={{ borderTop: '1px solid var(--border-lt)', margin: '14px 0' }}></div>
      <div className="fg" style={{ marginBottom: 0 }}>
        <label>Strike allowance</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type="number" min="0" value={form.strikes} onChange={e => setForm(f => ({ ...f, strikes: e.target.value }))} style={{ flex: '0 0 64px', textAlign: 'center' }} />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>relapse(s) per</span>
          <select value={form.strikesUnit} onChange={e => setForm(f => ({ ...f, strikesUnit: e.target.value }))} style={{ flex: 1 }}>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="ever">ever (total)</option>
          </select>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Your planned allowance — e.g. quit drinking but allow 1 night a week. Every relapse restarts the timer and spends a strike; the allowance replenishes each Monday (week) or on the 1st (month). Unscathed timers show green, struck turns amber, a spent allowance turns red until it replenishes.
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: '18px' }}>
        <button className="btn btn-ghost" onClick={() => onClose('addHabitModal')}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>Start Tracking</button>
      </div>
    </Modal>
  );
}

// ── Edit Habit ──
function EditHabitModal({ openId, onClose, habits, onEdit, onDelete }) {
  // openId format: 'editHabitModal:${id}'
  const isOpen = typeof openId === 'string' && openId.startsWith('editHabitModal:');
  const habitId = isOpen ? openId.split(':')[1] : null;
  const habit = habitId ? (habits || []).find(h => h.id === habitId) : null;

  const emptyMs = () => ({ _id: 'ms' + Date.now() + Math.random(), _existingId: null, amount: '1', unit: 'weeks', coins: '' });
  const [form, setForm] = useState({ name: '', color: '#1a7a4a', endless: false, milestones: [emptyMs()] });

  // Convert a stored milestone back into form shape (best-effort unit detection)
  function msFromStored(m) {
    const ms = m.duration;
    const units = [
      { k: 'months', v: 2592000000 },
      { k: 'weeks',  v: 604800000  },
      { k: 'days',   v: 86400000   },
      { k: 'hours',  v: 3600000    },
    ];
    for (const u of units) {
      if (ms % u.v === 0) return { unit: u.k, amount: String(ms / u.v) };
    }
    return { unit: 'days', amount: String(Math.max(1, Math.round(ms / 86400000))) };
  }

  // Sync form when habit changes
  useEffect(() => {
    if (habit) {
      setForm({
        name: habit.name || '',
        color: habit.color || '#1a7a4a',
        endless: !!habit.endless,
        milestones: (habit.milestones || []).length
          ? habit.milestones.map(m => {
              const parsed = msFromStored(m);
              return { _id: m.id, _existingId: m.id, amount: parsed.amount, unit: parsed.unit, coins: String(m.coins) };
            })
          : [emptyMs()],
      });
    }
  }, [habitId]);

  function toDuration(amount, unit) {
    const mul = { hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
    return parseInt(amount) * (mul[unit] || mul.days);
  }
  function msLabel(amount, unit) {
    const n = parseInt(amount);
    const s = { hours: 'hour', days: 'day', weeks: 'week', months: 'month' };
    return `${n} ${n === 1 ? s[unit] : unit}`;
  }
  function updateMs(_id, key, val) {
    setForm(f => ({ ...f, milestones: f.milestones.map(m => m._id === _id ? { ...m, [key]: val } : m) }));
  }
  function removeMs(_id) {
    setForm(f => ({ ...f, milestones: f.milestones.filter(m => m._id !== _id) }));
  }

  function submit() {
    if (!form.name.trim() || !habitId) return;
    // Preserve awarded status for existing milestones (match by _existingId)
    const existingAwarded = new Map((habit?.milestones || []).map(m => [m.id, m.awarded]));
    const milestones = form.milestones
      .filter(m => m.amount && m.coins && parseInt(m.coins) > 0)
      .map((m, i) => ({
        id: m._existingId || 'm' + Date.now() + i,
        duration: toDuration(parseInt(m.amount), m.unit),
        coins: parseInt(m.coins),
        label: msLabel(parseInt(m.amount), m.unit),
        awarded: existingAwarded.get(m._existingId) ?? false,
      }))
      .sort((a, b) => a.duration - b.duration);
    onEdit(habitId, {
      name: form.name.trim(),
      color: form.color,
      endless: form.endless,
      milestones,
    });
    onClose(openId);
  }

  function handleDelete() {
    if (!habitId) return;
    if (!window.confirm('Delete this habit? This cannot be undone.')) return;
    onDelete(habitId);
    onClose(openId);
  }

  return (
    <div
      className={`modal-overlay${isOpen ? ' open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(openId); }}
    >
      <div className="modal" style={{ maxWidth: '460px' }}>
        <h3>Edit Habit</h3>
        <div className="fg"><label>Habit Name</label><input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div className="fg"><label>Colour</label><input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} /></div>

        <div style={{ borderTop: '1px solid var(--border-lt)', margin: '14px 0' }}></div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--em-mid)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px' }}>⬡ Reward Milestones</div>

        {form.milestones.map((m, i) => (
          <div key={m._id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '10px' }}>
            <div className="fg" style={{ flex: '0 0 54px', marginBottom: 0 }}>
              {i === 0 && <label style={{ fontSize: '9px' }}>After</label>}
              <input type="number" min="1" value={m.amount} onChange={e => updateMs(m._id, 'amount', e.target.value)} style={{ textAlign: 'center' }} />
            </div>
            <div className="fg" style={{ flex: 1, marginBottom: 0 }}>
              {i === 0 && <label style={{ fontSize: '9px' }}>Unit</label>}
              <select value={m.unit} onChange={e => updateMs(m._id, 'unit', e.target.value)}>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
              </select>
            </div>
            <div className="fg" style={{ flex: '0 0 72px', marginBottom: 0 }}>
              {i === 0 && <label style={{ fontSize: '9px' }}>⬡ Coins</label>}
              <input type="number" min="1" value={m.coins} onChange={e => updateMs(m._id, 'coins', e.target.value)} />
            </div>
            <button
              onClick={() => removeMs(m._id)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', padding: '8px 4px', flexShrink: 0, lineHeight: 1, marginBottom: '1px' }}
            >✕</button>
          </div>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, milestones: [...f.milestones, emptyMs()] }))} style={{ marginBottom: '14px', fontSize: '12px' }}>
          + Add Milestone
        </button>

        <div style={{ borderTop: '1px solid var(--border-lt)', margin: '4px 0 14px' }}></div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.endless} onChange={e => setForm(f => ({ ...f, endless: e.target.checked }))} style={{ marginTop: '3px', accentColor: 'var(--em)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>∞ Endless</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Track this habit forever — the counter never ends, even after all milestones are earned</div>
          </div>
        </label>

        <div className="modal-actions" style={{ marginTop: '18px', justifyContent: 'space-between' }}>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleDelete}
            style={{ marginRight: 'auto' }}
          >Delete Habit</button>
          <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── Relapse (back-date support) ──
function RelapseModal({ openId, onClose, habits, onRelapse }) {
  // openId format: 'relapseModal:${id}'
  const isOpen = typeof openId === 'string' && openId.startsWith('relapseModal:');
  const habitId = isOpen ? openId.split(':')[1] : null;
  const habit = habitId ? (habits || []).find(h => h.id === habitId) : null;

  // Local datetime input needs 'YYYY-MM-DDTHH:MM' in local tz
  function toLocalInput(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [error, setError] = useState('');

  // Reset input to "now" each time the modal opens for a different habit
  useEffect(() => {
    if (isOpen) {
      setWhen(toLocalInput(new Date()));
      setError('');
    }
  }, [habitId, isOpen]);

  function submit() {
    if (!habitId) return;
    const ts = new Date(when).getTime();
    if (isNaN(ts)) { setError('Please pick a valid time.'); return; }
    const now = Date.now();
    if (ts > now) { setError('Relapse time can’t be in the future.'); return; }
    onRelapse(habitId, ts);
    onClose(openId);
  }

  const maxInput = toLocalInput(new Date()); // disables future in supporting browsers

  return (
    <div
      className={`modal-overlay${isOpen ? ' open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(openId); }}
    >
      <div className="modal" style={{ maxWidth: '420px' }}>
        <h3>Log Relapse{habit ? ` — ${habit.name}` : ''}</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.5 }}>
          Pick when the relapse actually happened. Your streak restarts from that moment, so if you already spent time clean since then, it counts.
        </p>
        <div className="fg">
          <label>When did it happen?</label>
          <input
            type="datetime-local"
            value={when}
            max={maxInput}
            onChange={e => { setWhen(e.target.value); setError(''); }}
          />
        </div>
        {error && <div style={{ fontSize: '12px', color: '#b92020', marginTop: '-6px', marginBottom: '8px' }}>{error}</div>}
        <div className="modal-actions" style={{ marginTop: '18px' }}>
          <button className="btn btn-ghost" onClick={() => onClose(openId)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Log Relapse</button>
        </div>
      </div>
    </div>
  );
}

// ── Waitlist ──
function WaitlistModal({ openId, onClose, userId, userEmail }) {
  const [email, setEmail] = useState(userEmail || '');
  const [status, setStatus] = useState('idle'); // idle | submitting | success | already
  const [count, setCount] = useState(null);

  // Prefill email if it arrives after mount
  useEffect(() => {
    if (userEmail && !email) setEmail(userEmail);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // Fetch count + check existing whenever modal opens
  useEffect(() => {
    if (openId !== 'waitlistModal') return;
    setStatus('idle');

    async function loadCount() {
      const { data } = await supabase.from('waitlist_count').select('total').single();
      if (data?.total != null) setCount(Number(data.total));
    }

    async function checkExisting() {
      if (!userId) return;
      const { data } = await supabase
        .from('waitlist')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) setStatus('already');
    }

    loadCount();
    checkExisting();
  }, [openId, userId]);

  async function handleSubmit() {
    if (!email.trim()) return;
    setStatus('submitting');
    const { error } = await supabase.from('waitlist').insert({
      user_id: userId || null,
      email: email.trim(),
    });
    if (error?.code === '23505') {
      // Unique constraint — already on list
      setStatus('already');
    } else if (error) {
      setStatus('idle');
    } else {
      setStatus('success');
      setCount(c => (c != null ? c + 1 : null));
      setTimeout(() => onClose('waitlistModal'), 2000);
    }
  }

  const isDone = status === 'success' || status === 'already';

  return (
    <Modal id="waitlistModal" openId={openId} onClose={onClose} style={{ maxWidth: '380px' }}>
      <div style={{ textAlign: 'center', paddingTop: '8px' }}>
        <div style={{ fontSize: '28px', marginBottom: '8px' }}>✦</div>
        <h3 style={{ margin: '0 0 6px', fontSize: '17px' }}>AI Coach — Early Access</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.6 }}>
          Be the first to know when AI Coach launches.
        </p>
      </div>

      {isDone ? (
        <div style={{ textAlign: 'center', padding: '16px 0 20px', fontFamily: 'var(--mono)', fontSize: '14px', color: 'var(--em)' }}>
          {status === 'already' ? "You're already on the list ✓" : "You're on the list ✓"}
        </div>
      ) : (
        <>
          <div className="fg">
            <label>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              disabled={status === 'submitting'}
            />
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => onClose('waitlistModal')}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Sending…' : 'Notify me'}
            </button>
          </div>
        </>
      )}

      {count != null && (
        <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px', letterSpacing: '0.5px' }}>
          {count} {count === 1 ? 'person' : 'people'} already waiting
        </div>
      )}

      {/* Subscription transparency */}
      <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,255,255,.04)', borderRadius: '10px', border: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.7, letterSpacing: '0.3px' }}>
          <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '4px' }}>Subscription transparency</strong>
          Joining the waitlist is free — no payment details required. If AI Coach launches as a paid feature, you will be told the price and what is included before any charge. You can cancel at any time. Free features remain free.
        </div>
      </div>
    </Modal>
  );
}

// ── Main Modals container ──
export default function Modals({ openModal, S, update, onClose, onOpen, onShowCoinToast, userId, userEmail }) {
  const { hasPro } = useSubscriptionContext();
  function handleAddLink(link) {
    update(prev => ({ ...prev, links: [...prev.links, link] }));
  }
  function handleAddYT(yt) {
    update(prev => ({ ...prev, ytWidgets: [...(prev.ytWidgets || []), yt] }));
  }
  function handleAddAchievement(ach) {
    // createdAt stamped server-time so the rating engine's time-spacing
    // rule (≥7 days created→completed) has a reliable signal.
    //
    // Anti-gaming rate limit: cap new achievements per rolling 24h.
    // Pro users get a higher cap. (The diminishing-returns curve in
    // derive.js makes bulk spam mostly worthless anyway; this also
    // keeps the canvas usable.)
    const DAILY_CREATE_CAP = hasPro ? 40 : 15;
    const since = Date.now() - 86_400_000;
    update(prev => {
      const recent = (prev.achievements || []).filter(a => (a.createdAt || 0) > since).length;
      if (recent >= DAILY_CREATE_CAP) {
        if (typeof window !== 'undefined') {
          alert(`Daily limit reached: max ${DAILY_CREATE_CAP} new achievements per 24 hours. This prevents inflated ratings — try again later.`);
        }
        return prev;
      }
      const withTimestamp = { ...ach, createdAt: ach.createdAt || Date.now() };
      return { ...prev, achievements: [...prev.achievements, withTimestamp] };
    });
  }
  function handleEditAchievement(id, patch) {
    // Preserve x/y/completed/locked/coinAwarded — only swap user-editable
    // fields so editing doesn't accidentally reset position or lose
    // completion state.
    update(prev => ({
      ...prev,
      achievements: (prev.achievements || []).map(a =>
        a.id === id ? { ...a, ...patch } : a
      ),
    }));
  }
  function handleAddMobileWidget(widget) {
    update(prev => ({
      ...prev,
      mobileWidgets: [...(prev.mobileWidgets || []), widget],
    }));
  }

  // ── Savings goals (F4 Sprint 2) ──
  function handleAddSavingsGoal(goal) {
    update(prev => ({ ...prev, savings: [...(prev.savings || []), goal] }));
  }
  function handleEditSavingsGoal(id, patch) {
    update(prev => ({
      ...prev,
      savings: (prev.savings || []).map(g => g.id === id ? { ...g, ...patch } : g),
    }));
  }
  function handleDeleteSavingsGoal(id) {
    update(prev => ({
      ...prev,
      savings: (prev.savings || []).filter(g => g.id !== id),
    }));
  }
  function handleAddContribution(goalId, contribution) {
    // Append contribution + recompute current. If the new total
    // crosses the target AND a linked achievement exists AND it's
    // not already completed, fire the achievement-complete pipeline
    // so the user gets the same coin reward + vision check as
    // completing it manually on the achievement board.
    update(prev => {
      const goals = prev.savings || [];
      const goal = goals.find(g => g.id === goalId);
      if (!goal) return prev;
      const nextContribs = [contribution, ...(goal.contributions || [])];
      const nextCurrent = nextContribs.reduce((sum, c) => sum + (c.amount || 0), 0);
      const justHit = nextCurrent >= goal.target && goal.current < goal.target;

      let next = {
        ...prev,
        savings: goals.map(g => g.id === goalId
          ? { ...g, current: nextCurrent, contributions: nextContribs }
          : g),
      };

      if (justHit && goal.achievementId) {
        const linked = (prev.achievements || []).find(a => a.id === goal.achievementId);
        if (linked && !linked.completed) {
          next.achievements = (prev.achievements || []).map(a =>
            a.id === goal.achievementId ? { ...a, completed: true } : a
          );
          // Fire the same coin-reward path as manual completion.
          if (linked.coins && linked.coins > 0) {
            next.coins = (prev.coins || 0) + linked.coins;
            next.coinHistory = [
              { type: 'earn', label: linked.name, amount: linked.coins, ts: Date.now() },
              ...(prev.coinHistory || []),
            ];
          }
        }
      }
      return next;
    });
  }

  function handleDeleteAchievement(id) {
    // Drop the achievement and any connections that touch it. Without
    // the connection sweep, orphaned edges would render with broken
    // endpoints in the SVG.
    update(prev => ({
      ...prev,
      achievements: (prev.achievements || []).filter(a => a.id !== id),
      connections: (prev.connections || []).filter(([f, t]) => f !== id && t !== id),
    }));
  }
  function handleAddTracker(tracker) {
    update(prev => ({ ...prev, trackers: [...prev.trackers, tracker] }));
  }
  function handleAddNotepad() {
    // Set a flag so HubSection knows to render the notepad widget
    update(prev => ({ ...prev, _showNotepad: true }));
  }
  function handleAddHubWidget(type) {
    // Desktop content widgets (habits / holidays) added to the canvas.
    update(prev => ({
      ...prev,
      hubWidgets: [...(prev.hubWidgets || []), { id: 'hw' + Date.now(), type }],
    }));
  }
  function handleMultiLogSave(logs) {
    update(prev => {
      const newLogs = { ...prev.logs };
      (prev.multiSelectedDays || []).forEach(key => {
        if (Object.keys(logs).length) newLogs[key] = { ...(newLogs[key] || {}), ...logs };
      });
      return { ...prev, logs: newLogs, multiSelectMode: false, multiSelectedDays: [], _multiLogOpen: false };
    });
  }
  function handleAddShopItem(item) {
    update(prev => ({ ...prev, shopItems: [...prev.shopItems, item] }));
  }
  function handleEditShopItem(id, patch) {
    update(prev => ({
      ...prev,
      shopItems: prev.shopItems.map(s => s.id === id ? { ...s, ...patch } : s),
    }));
  }
  function handleDeleteShopItem(id) {
    update(prev => ({ ...prev, shopItems: prev.shopItems.filter(s => s.id !== id) }));
  }
  function handleAddCategory(cat) {
    update(prev => ({ ...prev, shopCategories: [...prev.shopCategories, cat] }));
  }
  function handleAddHoliday(holiday) {
    update(prev => ({ ...prev, holidays: [...(prev.holidays || []), holiday] }));
  }
  function handleEditHoliday(id, data) {
    update(prev => ({
      ...prev,
      holidays: (prev.holidays || []).map(h => h.id === id ? { ...h, ...data } : h),
    }));
  }
  function handleDeleteHoliday(id) {
    update(prev => ({ ...prev, holidays: (prev.holidays || []).filter(h => h.id !== id) }));
  }
  function handleAddHabit(habit) {
    update(prev => ({ ...prev, habits: [...(prev.habits || []), habit] }));
  }
  function handleEditHabit(id, data) {
    update(prev => ({
      ...prev,
      habits: (prev.habits || []).map(h => h.id === id ? { ...h, ...data } : h),
    }));
  }
  function handleDeleteHabit(id) {
    update(prev => ({ ...prev, habits: (prev.habits || []).filter(h => h.id !== id) }));
  }
  function handleRelapseHabit(id, whenTs) {
    // Every relapse restarts the timer — strikes are the period's
    // planned allowance (e.g. 1 night a week), replenishing at the
    // calendar boundary. The strike banks (so the card shows 1/1, not
    // 0/1); counting + reset logic lives in src/lib/habits/strikes.js.
    // We keep only current-period timestamps — older ones can never
    // count again, so they're dead weight.
    update(prev => ({
      ...prev,
      habits: (prev.habits || []).map(h => {
        if (h.id !== id) return h;
        const start = periodStart(h.strikesPeriod, Date.now());
        const recent = [...(h.strikeTimes || []).filter(t => t >= start), whenTs];
        return {
          ...h, startTime: whenTs, strikeTimes: recent,
          relapseCount: (h.relapseCount || 0) + 1,
          milestones: (h.milestones || []).map(m => ({ ...m, awarded: false })),
        };
      }),
    }));
  }

  // Determine effective openId — _multiLogOpen overrides
  // editHolidayModal uses a compound id (editHolidayModal:id) so check for prefix
  const effectiveOpen = S._multiLogOpen ? 'multiLogModal' : openModal;

  return (
    <>
      <AddLinkModal
        openId={effectiveOpen}
        onClose={onClose}
        onSwitchModal={onOpen}
        onAddNotepad={handleAddNotepad}
        onAddApp={preset => { handleAddLink(appPresetToLink(preset)); onClose('addLinkModal'); }}
        onAddHubWidget={handleAddHubWidget}
      />
      <AddLinkOnlyModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddLink} />
      <AddYouTubeModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddYT} />
      <CoinHistoryModal openId={effectiveOpen} onClose={onClose} coins={S.coins || 0} coinHistory={S.coinHistory || []} />
      <AddAchievementModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddAchievement} />
      <EditAchievementModal openId={effectiveOpen} onClose={onClose} achievements={S.achievements} onEdit={handleEditAchievement} onDelete={handleDeleteAchievement} />
      <AddSavingsGoalModal openId={effectiveOpen} onClose={onClose} achievements={S.achievements} onAdd={handleAddSavingsGoal} />
      <AddContributionModal openId={effectiveOpen} onClose={onClose} savings={S.savings} onAdd={handleAddContribution} />
      <EditSavingsGoalModal openId={effectiveOpen} onClose={onClose} savings={S.savings} achievements={S.achievements} onEdit={handleEditSavingsGoal} onDelete={handleDeleteSavingsGoal} />
      <AddMobileWidgetModal
        openId={effectiveOpen}
        onClose={onClose}
        existingTypes={(S.mobileWidgets || []).map(w => w.type)}
        onAdd={handleAddMobileWidget}
        onUpgrade={() => onOpen('paywall:ourApps')}
      />
      <AddTrackerModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddTracker} />
      <MultiLogModal
        openId={effectiveOpen}
        onClose={id => { update(prev => ({ ...prev, _multiLogOpen: false })); onClose(id); }}
        trackers={S.trackers}
        multiSelectedDays={S.multiSelectedDays || []}
        onSave={handleMultiLogSave}
      />
      <AddShopModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddShopItem} categories={S.shopCategories} />
      <EditShopModal openId={effectiveOpen} onClose={onClose} shopItems={S.shopItems} categories={S.shopCategories} onEdit={handleEditShopItem} onDelete={handleDeleteShopItem} />
      <AddCategoryModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddCategory} />
      <AddHolidayModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddHoliday} />
      <EditHolidayModal openId={effectiveOpen} onClose={onClose} holidays={S.holidays} onEdit={handleEditHoliday} onDelete={handleDeleteHoliday} />
      <AddHabitModal openId={effectiveOpen} onClose={onClose} onAdd={handleAddHabit} />
      <EditHabitModal openId={effectiveOpen} onClose={onClose} habits={S.habits} onEdit={handleEditHabit} onDelete={handleDeleteHabit} />
      <RelapseModal openId={effectiveOpen} onClose={onClose} habits={S.habits} onRelapse={handleRelapseHabit} />
      <WaitlistModal openId={effectiveOpen} onClose={onClose} userId={userId} userEmail={userEmail} />
    </>
  );
}
