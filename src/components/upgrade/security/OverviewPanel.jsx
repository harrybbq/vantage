/**
 * Overview: is anything wrong, and where. A one-sentence verdict first
 * ("All systems operational" / "2 issues need attention") with its
 * countdown, then the three systems, then six stat tiles that each open
 * their tab, then the newest tickets and reports.
 *
 * Polls while the page is visible: every `nextRefreshSec` the server
 * suggests (60 s by default, clamped 30 s – 5 min). The two lists load
 * once (and on Refresh); they are the expensive part.
 */
import { useEffect, useMemo, useState } from 'react';
import Icon from '../../Icon';
import { usePanel } from './usePanel';
import { Pill, CardHead, Gate, Tile, Calm, Verdict } from './parts';
import { TicketLine } from './TicketsPanel';
import { pillState, normaliseTicket, sortTickets, verdictOf } from '../../../lib/security/status';
import { fmtInt, num, ago, toMs, stamp } from '../../../lib/security/format';
import { normaliseReport } from '../../../lib/moderation/queue';

const SYSTEMS = [
  { id: 'db', name: 'Database', sub: 'Supabase · Postgres', tab: 'database' },
  { id: 'netlify', name: 'Netlify', sub: 'Deploys · functions', tab: 'netlify' },
  { id: 'app', name: 'App', sub: 'Client errors · vitals', tab: 'netlify' },
];
const WHERE = { leaderboard: 'Leaderboard', group: 'Group board', messages: 'Messages', 'friend-card': 'Friend card' };

export default function OverviewPanel({ go }) {
  // Poll at the interval the server last suggested, if any.
  const [pollMs, setPollMs] = useState(60000);
  const ov = usePanel('overview', { pollMs });
  const suggested = num(ov.res && ov.res.data && ov.res.data.nextRefreshSec);
  useEffect(() => {
    setPollMs(suggested ? Math.max(30, Math.min(300, suggested)) * 1000 : 60000);
  }, [suggested]);
  const tk = usePanel('tickets', { params: { status: 'open' } });
  const md = usePanel('moderation');
  const refresh = () => { ov.reload(); tk.reload(); md.reload(); };

  const tickets = useMemo(() => {
    const d = tk.res && tk.res.state === 'ok' ? tk.res.data : null;
    const raw = d && Array.isArray(d.tickets) ? d.tickets : [];
    return sortTickets(raw.map(t => { const n = normaliseTicket(t); return n && { ...n, raw: t }; }).filter(Boolean)).slice(0, 5);
  }, [tk.res]);
  const reports = useMemo(() => {
    const d = md.res && md.res.state === 'ok' ? md.res.data : null;
    const list = (d && Array.isArray(d.reports) ? d.reports : []).map(normaliseReport).filter(Boolean);
    return list.filter(r => r.status === 'open')
      .sort((a, b) => (toMs(b.at) ?? 0) - (toMs(a.at) ?? 0)).slice(0, 3);
  }, [md.res]);

  const data = ov.res && ov.res.state === 'ok' ? ov.res.data : null;
  const v = verdictOf(data);

  return (
    <div className="sec-pane">
      {ov.res && ov.res.state !== 'ok'
        ? <Gate res={ov.res}>{() => null}</Gate>
        : (
          <Verdict v={ov.res ? v : { key: 'unknown', text: 'Checking…', issues: [] }}
                   at={ov.updatedAt} nextAt={ov.updatedAt ? ov.updatedAt + pollMs : null}
                   loading={ov.loading} onRefresh={refresh} error={ov.res && ov.res.staleError} />
        )}
      {data && (() => {
        const st = data.status || {};
        const c = data.counts || {};
        const n = k => num(c[k]);
        const tone = (val, t) => (val == null ? 'none' : val ? t : 'ok');
        const series = data.series && typeof data.series === 'object' ? data.series : {};
        const crit = n('criticalTickets'), open = n('openTickets');
        return (
          <>
            <div className="sec-strip" role="list">
              {SYSTEMS.map(s => {
                const p = pillState(st[s.id]);
                return (
                  <button key={s.id} type="button" role="listitem" className={`sec-sys is-${p.key}`} onClick={() => go(s.tab)}>
                    <span className="sec-sys-top">
                      <span className="sec-sys-name">{s.name}</span>
                      <Pill p={p} />
                    </span>
                    <span className="sec-sys-sub">{p.detail || s.sub}</span>
                  </button>
                );
              })}
            </div>
            {data.generatedAt && <div className="sec-fine" title={stamp(data.generatedAt)}>Server checked {ago(data.generatedAt)}.</div>}
            <div className="sec-tiles">
              <Tile label="Critical tickets" value={fmtInt(crit)} of={open != null ? `/ ${fmtInt(open)} open` : null}
                    tone={tone(crit, 'bad')} onClick={() => go('tickets')} />
              <Tile label="Open tickets" value={fmtInt(open)} of={n('totalTickets') != null ? `/ ${fmtInt(n('totalTickets'))}` : 'tickets'}
                    tone={tone(open, 'warn')} onClick={() => go('tickets')} />
              <Tile label="Open reports" value={fmtInt(n('openReports'))} of="reports" sub="aim to decide within 24 h"
                    tone={tone(n('openReports'), 'warn')} onClick={() => go('moderation')} />
              <Tile label="Suspended" value={fmtInt(n('suspended'))} of="accounts" tone="none" onClick={() => go('moderation')} />
              <Tile label="Client errors" value={fmtInt(n('errors24h'))} of="in 24 h" tone={tone(n('errors24h'), 'warn')}
                    spark={Array.isArray(series.errors) ? series.errors : null} />
              <Tile label="Advisor errors" value={fmtInt(n('advisorsError'))}
                    of={n('advisorsTotal') != null ? `/ ${fmtInt(n('advisorsTotal'))} findings` : 'Supabase'}
                    sub={n('advisorsError') == null ? 'needs the Supabase token' : 'accepted findings excluded'}
                    tone={tone(n('advisorsError'), 'bad')} onClick={() => go('database')} />
            </div>
          </>
        );
      })()}

      <div className="sec-two">
        <section className="sec-card">
          <CardHead eyebrow="// newest open" title="Tickets"
                    right={<button type="button" className="sec-link" onClick={() => go('tickets')}>All tickets <Icon name="arrow-right" size={11} /></button>} />
          <Gate res={tk.res}>
            {() => (tickets.length
              ? <div className="sec-tlist">{tickets.map(t => <TicketLine key={t.id} t={t} raw={t.raw} onClick={() => go('tickets')} />)}</div>
              : <Calm>No open tickets. That is the normal state.</Calm>)}
          </Gate>
        </section>
        <section className="sec-card">
          <CardHead eyebrow="// newest open" title="Reports"
                    right={<button type="button" className="sec-link" onClick={() => go('moderation')}>Moderation <Icon name="arrow-right" size={11} /></button>} />
          <Gate res={md.res}>
            {() => (reports.length
              ? (
                <div className="sec-tlist">
                  {reports.map(r => (
                    <button key={r.id} type="button" className="sec-row" onClick={() => go('moderation')}>
                      <span className="sec-row-main">
                        <span className="sec-row-top">
                          <b className="sec-row-id">{r.name || (r.handle ? `@${r.handle}` : 'Deleted account')}</b>
                          {r.handle && r.name && <span className="sec-row-mono">@{r.handle}</span>}
                        </span>
                        <span className="sec-row-sub">{r.reason || 'No reason given'}{r.where ? ` · ${WHERE[r.where] || r.where}` : ''}</span>
                      </span>
                      <span className="sec-row-side">
                        <span title={stamp(r.at)}>{ago(r.at)}</span>
                      </span>
                      <Icon name="chevron-right" size={14} className="sec-row-chev" />
                    </button>
                  ))}
                </div>
              )
              : <Calm>No open reports.</Calm>)}
          </Gate>
        </section>
      </div>
    </div>
  );
}
