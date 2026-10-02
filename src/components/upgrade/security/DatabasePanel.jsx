/**
 * Database: Supabase Postgres health, size, traffic and advisors.
 *
 * Health and tables come from the project's metrics (privileged
 * endpoint, Management API scrape, or the owner_db_stats() RPC). Traffic
 * and advisors need the scoped Management API token, so they fail soft
 * on their own: the rest of the panel stays useful without it.
 *
 * One time-range control (Supabase's own presets, sent as ?range=)
 * drives the traffic chart, with the absolute window it resolves to
 * beside it. Health is six stat tiles, each with its limit. Advisors are
 * counted tabs — Errors / Warnings / Info / Accepted — and a finding
 * opens a side panel with Entity · Issue · Description · Resolve, where
 * it can be accepted so it stops counting.
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { usePanel } from './usePanel';
import { Updated, Gate, CardHead, Tile, SetupCard, Calm, NoData, Sheet } from './parts';
import TrafficChart from './TrafficChart';
import WidgetBoundary from '../../WidgetBoundary';
import { postAction } from '../../../lib/security/api';
import { part, meterTone, cacheTone, advisorBuckets } from '../../../lib/security/status';
import { RANGES, rangeHours, rangeText } from '../../../lib/security/chart';
import { fmtPct, fmtBytes, fmtDuration, fmtInt, fmtCompact, num } from '../../../lib/security/format';

const TOKEN = ['SUPABASE_ACCESS_TOKEN'];
const RANGE_KEY = 'vantage.upgrade.security.range';

function readRange() {
  try { const v = window.localStorage.getItem(RANGE_KEY); return RANGES.some(r => r.id === v) ? v : '1day'; } catch { return '1day'; }
}

function Health({ h }) {
  const conn = h.connections || {};
  const active = num(conn.active), idle = num(conn.idle), max = num(conn.max);
  const used = active != null || idle != null ? (active || 0) + (idle || 0) : null;
  const connPct = used != null && max ? (used / max) * 100 : null;
  const dead = num(h.deadTupleRatio);
  const deadPct = dead == null ? null : dead <= 1 ? dead * 100 : dead;
  const diskTotal = num(h.diskTotalBytes ?? h.diskSizeBytes);
  const memTotal = num(h.memTotalBytes);
  const dbSize = num(h.dbSizeBytes);
  return (
    <>
      <div className="sec-tiles">
        <Tile label="CPU" value={h.cpuPct == null && num(h.load1) != null ? `load ${num(h.load1).toFixed(2)}` : fmtPct(h.cpuPct)} of={num(h.cpuCores ?? h.cores) ? `of ${h.cpuCores ?? h.cores} vCPU` : 'used'}
              tone={meterTone(h.cpuPct) || 'none'} pct={num(h.cpuPct)} />
        <Tile label="Memory" value={fmtPct(h.memPct)} of={memTotal ? `of ${fmtBytes(memTotal)}` : 'used'}
              tone={meterTone(h.memPct, 75, 90) || 'none'} pct={num(h.memPct)} />
        <Tile label="Disk" value={fmtPct(h.diskUsedPct)} of={diskTotal ? `of ${fmtBytes(diskTotal)}` : 'used'}
              sub="a ticket is raised over 80%" tone={meterTone(h.diskUsedPct, 70, 80) || 'none'} pct={num(h.diskUsedPct)} />
        <Tile label="Connections" value={fmtInt(used)} of={max ? `/ ${fmtInt(max)}` : 'open'}
              sub={`${fmtInt(active)} active · ${fmtInt(idle)} idle`} tone={meterTone(connPct, 60, 80) || 'none'} pct={connPct} />
        <Tile label="Database size" value={fmtBytes(dbSize)} of={diskTotal ? `of ${fmtBytes(diskTotal)} disk` : 'on disk'}
              tone="none" pct={dbSize != null && diskTotal ? (dbSize / diskTotal) * 100 : null} />
        <Tile label="Cache hit" value={fmtPct(h.cacheHitPct, 2)} of="aim ≥ 99%" tone={cacheTone(h.cacheHitPct) || 'none'} pct={num(h.cacheHitPct)} />
      </div>
      <div className="sec-fine sec-health-fine">
        Up {fmtDuration(h.uptimeSec)} · dead tuples {fmtPct(deadPct)} of live rows
      </div>
    </>
  );
}

function Tables({ tables }) {
  const list = (Array.isArray(tables) ? tables : []).filter(t => t && t.name);
  if (!list.length) return <NoData>Table sizes appear once the metrics source answers.</NoData>;
  const top = Math.max(1, ...list.map(t => num(t.bytes) || 0));
  return (
    <div className="sec-scroll">
      <table className="sec-table">
        <thead><tr><th>Table</th><th className="is-num">Rows (est.)</th><th className="is-num">Size</th><th className="sec-col-bar" aria-label="Share of largest" /></tr></thead>
        <tbody>
          {list.map(t => (
            <tr key={t.name}>
              <td className="is-mono">{t.name}</td>
              <td className="is-num">{fmtCompact(t.rows)}</td>
              <td className="is-num">{fmtBytes(t.bytes)}</td>
              <td className="sec-col-bar"><span className="sec-hbar"><i style={{ width: `${((num(t.bytes) || 0) / top) * 100}%` }} /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ADV_TABS = [
  { id: 'bad', label: 'Errors', empty: 'No errors detected. Nothing here needs fixing.' },
  { id: 'warn', label: 'Warnings', empty: 'No warnings.' },
  { id: 'info', label: 'Info', empty: 'No suggestions.' },
  { id: 'accepted', label: 'Accepted', empty: 'Nothing accepted. Accept a finding you have checked and decided is fine, and it stops counting.' },
];

function AdvisorDetail({ l, onClose, onDone }) {
  const [note, setNote] = useState(l.acceptedNote || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const act = async on => {
    setBusy(true); setErr(null);
    const out = await postAction({ action: 'advisor.accept', cache_key: l.key, on, note: note.trim() || undefined });
    setBusy(false);
    if (!out.ok) { setErr(out.error); return; }
    onDone(l.key, on, note.trim());
  };
  return (
    <Sheet title={l.title} eyebrow={`// ${l.category || 'advisor'} · ${l.level === 'bad' ? 'error' : l.level === 'warn' ? 'warning' : 'info'}`} onClose={onClose}>
      <dl className="sec-facts">
        <dt>Entity</dt>
        <dd className="is-mono">{l.entity || '—'}{l.entityType ? <em> · {l.entityType}</em> : null}</dd>
        <dt>Issue</dt>
        <dd>{l.issue || '—'}</dd>
        <dt>Description</dt>
        <dd>{l.description || 'Supabase gave no longer description for this lint.'}</dd>
        <dt>Resolve</dt>
        <dd>
          {l.remediation
            ? <a className="sec-btn" href={l.remediation} target="_blank" rel="noopener noreferrer">Open the fix guide <Icon name="external-link" size={11} /></a>
            : 'No guide linked.'}
        </dd>
      </dl>
      <div className="sec-sheet-acts">
        <label className="sec-field">
          <span>Why it’s fine (kept with the acceptance)</span>
          <textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)}
                    placeholder="e.g. intended: RLS on, no policies = service role only" />
        </label>
        {err && <div className="sec-note is-bad">{err}</div>}
        <div className="sec-acts">
          {l.accepted
            ? <button type="button" className="sec-btn" disabled={busy} onClick={() => act(false)}>Un-accept · count it again</button>
            : <button type="button" className="sec-btn is-primary" disabled={busy} onClick={() => act(true)}><Icon name="check" size={12} /> Accept · stop counting</button>}
          <button type="button" className="sec-btn is-quiet" onClick={onClose}>Close</button>
        </div>
      </div>
    </Sheet>
  );
}

function Advisors({ adv }) {
  const [tab, setTab] = useState('bad');
  const [openKey, setOpenKey] = useState(null);
  const [local, setLocal] = useState({});             // cache_key → accepted (optimistic)
  const buckets = useMemo(() => {
    const b = advisorBuckets(adv);
    if (!Object.keys(local).length) return b;
    const all = [...b.bad, ...b.warn, ...b.info, ...b.accepted];
    const out = { bad: [], warn: [], info: [], accepted: [] };
    for (const l of all) {
      const acc = l.key in local ? local[l.key] : l.accepted;
      if (acc) out.accepted.push({ ...l, accepted: true }); else out[l.level].push({ ...l, accepted: false });
    }
    return out;
  }, [adv, local]);
  const list = buckets[tab];
  const open = openKey ? [...buckets.bad, ...buckets.warn, ...buckets.info, ...buckets.accepted].find(l => l.key === openKey) : null;
  const meta = ADV_TABS.find(t => t.id === tab);
  return (
    <>
      <div className="sec-advtabs" role="tablist" aria-label="Advisor findings">
        {ADV_TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                  className={`sec-advtab is-${t.id}${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
            <i aria-hidden="true" />{t.label}<b>{buckets[t.id].length}</b>
          </button>
        ))}
      </div>
      {list.length === 0
        ? <Calm>{meta.empty}</Calm>
        : (
          <div className="sec-tlist">
            {list.map(l => (
              <button key={l.key} type="button" className={`sec-row sec-advrow is-${l.accepted ? 'accepted' : l.level}`} onClick={() => setOpenKey(l.key)}>
                <span className="sec-row-main">
                  <span className="sec-row-top">
                    <b className="sec-row-id">{l.title}</b>
                    {l.category && <span className="sec-cat">{l.category.toLowerCase()}</span>}
                  </span>
                  <span className="sec-row-sub sec-row-mono">{l.entity || l.issue}</span>
                </span>
                <Icon name="chevron-right" size={14} className="sec-row-chev" />
              </button>
            ))}
          </div>
        )}
      {open && (
        <AdvisorDetail key={open.key} l={open} onClose={() => setOpenKey(null)}
                       onDone={(k, on) => { setLocal(s => ({ ...s, [k]: on })); setOpenKey(null); }} />
      )}
    </>
  );
}

function sectionGate(p, render, { compactSetup } = {}) {
  if (p.state === 'ok') return render(p.data);
  if (p.state === 'not_configured') return <SetupCard envs={TOKEN} hint={p.hint} compact={compactSetup} what={compactSetup ? 'Needs the same token' : undefined} />;
  if (p.state === 'missing') return <NoData />;
  return <div className="sec-note is-warn"><b>Unavailable right now.</b> {p.hint || ''}</div>;
}

export default function DatabasePanel() {
  const [range, setRangeState] = useState(readRange);
  const setRange = id => { setRangeState(id); try { window.localStorage.setItem(RANGE_KEY, id); } catch { /* private mode */ } };
  const db = usePanel('database', { params: { range } });
  return (
    <div className="sec-pane">
      <div className="sec-bar">
        <div className="sec-range">
          <div className="sec-seg" role="group" aria-label="Time range">
            {RANGES.map(r => (
              <button key={r.id} type="button" className={range === r.id ? 'is-on' : ''} aria-pressed={range === r.id}
                      onClick={() => setRange(r.id)}>{r.label}</button>
            ))}
          </div>
          <span className="sec-range-abs">{rangeText(range, db.updatedAt || Date.now())}</span>
        </div>
        <Updated at={db.updatedAt} loading={db.loading} onRefresh={db.reload} error={db.res && db.res.staleError} />
      </div>
      <Gate res={db.res} envs={TOKEN}>
        {data => {
          const health = part(data.health);
          const traffic = part(data.traffic);
          const adv = part(data.advisors);
          const src = data.source || {};
          const series = traffic.state === 'ok' && Array.isArray(traffic.data.series) ? traffic.data.series : [];
          return (
            <>
              <section className="sec-card">
                <CardHead eyebrow="// health · now" title="Postgres"
                          right={src.metrics && <span className="sec-src">via {src.metrics}</span>} />
                {sectionGate(health, h => <Health h={h} />)}
              </section>

              <section className="sec-card">
                <CardHead eyebrow={`// traffic · ${(RANGES.find(r => r.id === range) || {}).label || ''}`} title="API requests"
                          right={traffic.state === 'ok' && src.traffic && <span className="sec-src">via {src.traffic}</span>} />
                {sectionGate(traffic, t => (series.length
                  ? (
                    <WidgetBoundary name="security:traffic">
                      <TrafficChart series={series} windowHours={num(t.windowHours) || rangeHours(range)} />
                    </WidgetBoundary>
                  )
                  : <NoData>No requests recorded in this window yet. Supabase’s usage counts can lag by a few minutes.</NoData>))}
              </section>

              <div className="sec-two is-wide-right">
                <section className="sec-card">
                  <CardHead eyebrow="// largest first" title="Tables" />
                  <Tables tables={data.tables} />
                </section>
                <section className="sec-card">
                  <CardHead eyebrow="// supabase advisors" title="Advisors" />
                  {sectionGate(adv, a => <Advisors adv={a} />, { compactSetup: traffic.state === 'not_configured' })}
                </section>
              </div>
            </>
          );
        }}
      </Gate>
    </div>
  );
}
