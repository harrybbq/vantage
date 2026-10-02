/**
 * Tickets — what the hourly sweep raised, what users reported through
 * Settings → Report a problem, and what the owner raised by hand.
 *
 * A repeating condition bumps one ticket's count (×N) and "last seen"
 * rather than stacking duplicates (the sweep keys on a fingerprint), so
 * the list stays a list of problems, not of occurrences. Severity is the
 * left stripe; status is the pill. Every state change can carry a note
 * and every one is reversible (Reopen) — a resolved ticket also re-opens
 * by itself if the sweep sees the condition again.
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { usePanel } from './usePanel';
import { Pill, Updated, Gate, Calm, CardHead } from './parts';
import { postAction } from '../../../lib/security/api';
import {
  normaliseTicket, sortTickets, filterTickets, detailRows, ticketTrend, SEVERITIES,
} from '../../../lib/security/status';
import { ago, stamp, fmtInt, fmtAge, num } from '../../../lib/security/format';

const STATUS_PILL = {
  open: { key: 'degraded', label: 'Open' },
  ack: { key: 'busy', label: 'Ack' },
  resolved: { key: 'ok', label: 'Resolved' },
};
const SOURCE = { auto: 'sweep', user: 'user', owner: 'you' };
const TITLE_MAX = 120, DETAIL_MAX = 2000;

/**
 * One ticket as a dense row (Sentry's grammar) — also used by Overview:
 * bold title + status pill, a muted line of severity · source · kind,
 * then right-aligned last seen / age, the count ×N with a trend word
 * under it, and a chevron. Severity is the left stripe.
 */
export function TicketLine({ t, raw, onClick, open }) {
  const trend = ticketTrend(t, Date.now(), raw || {});
  return (
    <button type="button" className={`sec-row sec-tline sev-${t.severity}${open ? ' is-open' : ''}${t.status === 'resolved' ? ' is-done' : ''}`}
            onClick={onClick} aria-expanded={open}>
      <span className="sec-row-main">
        <span className="sec-row-top">
          <b className="sec-row-id">{t.title}</b>
          <Pill p={STATUS_PILL[t.status]} />
        </span>
        <span className="sec-row-sub">
          <span className={`sec-sev sev-${t.severity}`}>{t.severity}</span>
          <span>{SOURCE[t.source] || t.source}{t.kind ? ` · ${t.kind}` : ''}</span>
        </span>
      </span>
      <span className="sec-row-side">
        <span title={`Last seen ${stamp(t.lastSeenAt)}`}>{ago(t.lastSeenAt)}</span>
        <span className="sec-row-faint" title={`Raised ${stamp(t.createdAt)}`}>age {fmtAge(t.createdAt)}</span>
      </span>
      <span className="sec-row-count">
        <b title={`Seen ${t.count} time${t.count === 1 ? '' : 's'}`}>×{fmtInt(t.count)}</b>
        {trend && <span className={`sec-trend is-${trend.toLowerCase()}`}>{trend}</span>}
      </span>
      <Icon name="chevron-right" size={14} className="sec-row-chev" />
    </button>
  );
}

function Drawer({ t, onAct, busy }) {
  const [note, setNote] = useState(t.note || '');
  const rows = detailRows(t.detail);
  const act = status => onAct(t, status, note.trim());
  return (
    <div className="sec-drawer">
      <dl className="sec-dl">
        <div><dt>Raised</dt><dd title={stamp(t.createdAt)}>{ago(t.createdAt)}</dd></div>
        <div><dt>Last seen</dt><dd title={stamp(t.lastSeenAt)}>{ago(t.lastSeenAt)}</dd></div>
        <div><dt>Seen</dt><dd>{fmtInt(t.count)}×</dd></div>
        <div><dt>Source</dt><dd>{SOURCE[t.source] || t.source}</dd></div>
        {rows.map(([k, v], i) => (
          <div key={i} className={k ? '' : 'is-wide'}>{k && <dt>{k}</dt>}<dd>{v}</dd></div>
        ))}
      </dl>
      <label className="sec-field">
        <span>Note (optional, kept with the ticket)</span>
        <textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)}
                  placeholder="What you found, what you did" />
      </label>
      <div className="sec-acts">
        {t.status === 'open' && <button type="button" className="sec-btn" disabled={busy} onClick={() => act('ack')}>Acknowledge</button>}
        {t.status !== 'resolved' && <button type="button" className="sec-btn is-good" disabled={busy} onClick={() => act('resolved')}><Icon name="check" size={12} /> Resolve</button>}
        {t.status !== 'open' && <button type="button" className="sec-btn" disabled={busy} onClick={() => act('open')}>Reopen</button>}
      </div>
    </div>
  );
}

function RaiseForm({ onDone, onCancel }) {
  const [severity, setSeverity] = useState('medium');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async e => {
    e.preventDefault();
    if (!title.trim()) { setErr('Give it a title.'); return; }
    setBusy(true); setErr(null);
    const out = await postAction({ action: 'ticket.create', severity, title: title.trim(), detail: detail.trim() || undefined });
    setBusy(false);
    if (!out.ok) { setErr(out.error); return; }
    onDone();
  };
  return (
    <form className="sec-card sec-raise" onSubmit={submit}>
      <CardHead eyebrow="// raise by hand" title="New ticket" />
      <div className="sec-field">
        <span>Severity</span>
        <div className="sec-chips">
          {SEVERITIES.map(s => (
            <button key={s} type="button" className={`sec-chip sev-${s}${severity === s ? ' is-on' : ''}`}
                    aria-pressed={severity === s} onClick={() => setSeverity(s)}><i aria-hidden="true" />{s}</button>
          ))}
        </div>
      </div>
      <label className="sec-field">
        <span>Title <em>{title.length}/{TITLE_MAX}</em></span>
        <input value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} placeholder="What needs looking at" />
      </label>
      <label className="sec-field">
        <span>Detail <em>{detail.length}/{DETAIL_MAX}</em></span>
        <textarea rows={3} value={detail} maxLength={DETAIL_MAX} onChange={e => setDetail(e.target.value)} />
      </label>
      {err && <div className="sec-note is-bad">{err}</div>}
      <div className="sec-acts">
        <button type="submit" className="sec-btn is-primary" disabled={busy}>{busy ? 'Raising…' : 'Raise ticket'}</button>
        <button type="button" className="sec-btn is-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function TicketsPanel() {
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [raising, setRaising] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const tk = usePanel('tickets', { params: { status } });

  const data = tk.res && tk.res.state === 'ok' ? tk.res.data : null;
  const all = useMemo(() => (data && Array.isArray(data.tickets) ? data.tickets : [])
    .map(t => { const n = normaliseTicket(t); return n && { ...n, raw: t }; }).filter(Boolean), [data]);
  const shown = useMemo(() => sortTickets(filterTickets(all, { status, severity })), [all, status, severity]);
  const counts = (data && data.counts) || {};
  const cnt = k => (k === 'all' ? ['open', 'ack', 'resolved'].reduce((s, x) => s + (num(counts[x]) || 0), 0) : num(counts[k]));
  const sevCount = s => all.filter(t => t.severity === s && (status === 'all' || t.status === status)).length;

  async function act(t, next, note) {
    setBusyId(t.id); setMsg(null);
    const out = await postAction({ action: 'ticket.update', id: t.id, status: next, note: note || undefined });
    setBusyId(null);
    if (!out.ok) { setMsg({ bad: true, text: out.error }); return; }
    tk.patch(d => ({
      ...d,
      tickets: (d.tickets || []).map(x => (x && x.id === t.id ? { ...x, status: next, note: note || x.note } : x)),
    }));
    setOpenId(null);
    tk.reload();
  }

  async function sweep() {
    setMsg(null);
    const out = await postAction({ action: 'sweep.run' });
    if (!out.ok) { setMsg({ bad: true, text: out.error }); return; }
    const raised = num(out.data && (out.data.raised ?? out.data.created));
    setMsg({ text: raised != null ? `Sweep done — ${raised} new or re-opened.` : 'Sweep done.' });
    tk.reload();
  }

  return (
    <div className="sec-pane">
      <div className="sec-bar">
        <div className="sec-chips" role="group" aria-label="Status">
          {['open', 'ack', 'resolved', 'all'].map(s => (
            <button key={s} type="button" className={`sec-chip${status === s ? ' is-on' : ''}`} aria-pressed={status === s}
                    onClick={() => { setStatus(s); setOpenId(null); }}>
              {s === 'ack' ? 'Acknowledged' : s}
              {cnt(s) != null && <b>{fmtInt(cnt(s))}</b>}
            </button>
          ))}
        </div>
        <Updated at={tk.updatedAt} loading={tk.loading} onRefresh={tk.reload} error={tk.res && tk.res.staleError} />
      </div>
      <div className="sec-bar">
        <div className="sec-chips" role="group" aria-label="Severity">
          <button type="button" className={`sec-chip${severity === 'all' ? ' is-on' : ''}`} aria-pressed={severity === 'all'}
                  onClick={() => setSeverity('all')}>Any severity</button>
          {SEVERITIES.map(s => (
            <button key={s} type="button" className={`sec-chip sev-${s}${severity === s ? ' is-on' : ''}`} aria-pressed={severity === s}
                    onClick={() => setSeverity(s)}>
              <i aria-hidden="true" />{s}{data && <b>{sevCount(s)}</b>}
            </button>
          ))}
        </div>
        <div className="sec-bar-acts">
          <button type="button" className="sec-link" onClick={sweep} title="Run the hourly checks now">Run sweep</button>
          <button type="button" className="sec-btn is-primary" onClick={() => setRaising(v => !v)}>
            <Icon name="plus" size={12} /> Raise ticket
          </button>
        </div>
      </div>

      {msg && <div className={`sec-note${msg.bad ? ' is-bad' : ''}`}>{msg.text}</div>}
      {raising && <RaiseForm onCancel={() => setRaising(false)} onDone={() => { setRaising(false); setStatus('open'); tk.reload(); }} />}

      <Gate res={tk.res}>
        {() => (shown.length
          ? (
            <div className="sec-tlist is-full">
              {shown.map(t => (
                <div key={t.id} className="sec-titem">
                  <TicketLine t={t} raw={t.raw} open={openId === t.id} onClick={() => setOpenId(id => (id === t.id ? null : t.id))} />
                  {openId === t.id && <Drawer t={t} onAct={act} busy={busyId === t.id} />}
                </div>
              ))}
            </div>
          )
          : <Calm>{status === 'open' || status === 'ack' ? `Nothing ${status === 'ack' ? 'acknowledged' : 'open'}${severity !== 'all' ? ` at ${severity}` : ''}. That is the normal state.` : 'No tickets here.'}</Calm>)}
      </Gate>
    </div>
  );
}
