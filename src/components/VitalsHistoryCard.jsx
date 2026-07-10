/**
 * VitalsHistoryCard — line chart + recent-entries table for the daily
 * vitals log (S.vitalsLog, written by the mobile Vitals widget).
 *
 * One metric plotted at a time (Weight / Sleep / Rest HR) over a
 * selectable range (7D / 30D / All). Single series → no legend; the
 * controls row names what's plotted. Crosshair + tooltip on hover,
 * endpoint direct-labeled, and the table below keeps every value
 * reachable without hovering. Line/marks wear the theme accent
 * (var(--em)); all text wears text tokens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseHealthExport, applyHealthImport } from '../lib/appleHealth';

const METRICS = [
  { key: 'weight', label: 'Weight',  unit: 'kg',  src: 'vitals' },
  { key: 'sleep',  label: 'Sleep',   unit: 'h',   src: 'vitals' },
  { key: 'rhr',    label: 'Rest HR', unit: 'bpm', src: 'vitals' },
  // WHOOP-fed metrics (whoop-sync writes them into vitalsLog).
  { key: 'hrv',      label: 'HRV',      unit: 'ms', src: 'vitals' },
  { key: 'recovery', label: 'Recovery', unit: '%',  src: 'vitals' },
  { key: 'strain',   label: 'Strain',   unit: '',   src: 'vitals' },
  // Macro % history — written by NutritionSection into S.macroHistory
  // as "% of goal hit" per day (survives later goal changes).
  { key: 'cal',  label: 'Cal %',     unit: '%', src: 'macro' },
  { key: 'pro',  label: 'Protein %', unit: '%', src: 'macro' },
  { key: 'carb', label: 'Carbs %',   unit: '%', src: 'macro' },
  { key: 'fat',  label: 'Fat %',     unit: '%', src: 'macro' },
];
const RANGES = [
  { key: '7d',  label: '7D',  days: 7  },
  { key: '30d', label: '30D', days: 30 },
  { key: 'all', label: 'All', days: null },
];

const DAY_MS = 86400000;
const W = 640, H = 200, PAD_L = 44, PAD_R = 16, PAD_T = 14, PAD_B = 26;

function niceTicks(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = [1, 2, 2.5, 5, 10].map(s => s * Math.pow(10, Math.floor(Math.log10(span / 3))))
    .find(s => span / s <= 4) || span / 3;
  const t0 = Math.ceil(min / step) * step;
  const out = [];
  for (let t = t0; t <= max + 1e-9; t += step) out.push(+t.toFixed(4));
  return out;
}
function fmtDay(ts) {
  const d = new Date(ts);
  return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
}

// Owner-only Apple Health import panel. Live HealthKit isn't possible
// on the web; this parses the manual Health export and fills the
// vitals/burn stores. Gated on the same window.__vantageOwner flag as
// other owner tools.
function AppleHealthImport({ S, update }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | parsing | done | error
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const token = S?.healthToken || null;
  const syncUrl = token && typeof window !== 'undefined'
    ? `${window.location.origin}/.netlify/functions/health-sync?token=${token}`
    : null;
  function enableSync() {
    const t = (window.crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2))).replace(/-/g, '');
    update(prev => ({ ...prev, healthToken: t }));
  }
  function copyUrl() {
    if (!syncUrl) return;
    navigator.clipboard?.writeText(syncUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatus('parsing'); setPct(0); setMsg('');
    try {
      const res = await parseHealthExport(file, setPct);
      applyHealthImport(update, res);
      const c = res.counts;
      setStatus('done');
      setMsg(`Imported ${c.weight} weight · ${c.sleep} sleep · ${c.rhr} HR · ${c.steps} step days.`);
    } catch (err) {
      setStatus('error');
      setMsg(err?.message || 'Could not read that file. Make sure it’s export.zip or export.xml from Apple Health.');
    }
  }

  return (
    <div className="vitals-ah">
      <div className="vitals-ah-row">
        <input ref={inputRef} type="file" accept=".zip,.xml" style={{ display: 'none' }} onChange={onFile} />
        <button type="button" className="vitals-ah-btn" disabled={status === 'parsing'} onClick={() => inputRef.current?.click()}>
          {status === 'parsing' ? `Importing… ${Math.round(pct * 100)}%` : 'Import from Apple Health'}
        </button>
        <span className="vitals-ah-hint">
          {status === 'done' ? msg
            : status === 'error' ? msg
            : 'One-off: Health app → profile → Export All Health Data → pick the export.zip.'}
        </span>
      </div>
      <div className="vitals-ah-row vitals-ah-sync">
        {!syncUrl ? (
          <>
            <button type="button" className="vitals-ah-btn vitals-ah-btn-alt" onClick={enableSync}>Enable live sync</button>
            <span className="vitals-ah-hint">Auto-import daily via an iOS Shortcut — no App Store needed.</span>
          </>
        ) : (
          <>
            <button type="button" className="vitals-ah-btn vitals-ah-btn-alt" onClick={copyUrl}>{copied ? 'Copied ✓' : 'Copy sync URL'}</button>
            <span className="vitals-ah-hint">Paste this into your “Vantage Health Sync” Shortcut’s <strong>Get Contents of URL</strong> step (POST). Keep it secret.</span>
          </>
        )}
      </div>
    </div>
  );
}

// Owner-only WHOOP panel — OAuth connect + pull-based sync. The
// function returns mapped data and WE merge it via update(), so every
// write flows through the normal save pipeline + anti-wipe guards.
function WhoopPanel({ S, update }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const connected = !!S.whoopConnected;

  async function syncNow(days = 7, silent = false) {
    setBusy(true);
    if (!silent) setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/whoop-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ days }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'sync failed');
      update(prev => {
        const vitalsLog = { ...(prev.vitalsLog || {}) };
        for (const [d, v] of Object.entries(body.vitals || {})) vitalsLog[d] = { ...(vitalsLog[d] || {}), ...v };
        const burnLog = { ...(prev.burnLog || {}) };
        for (const [d, entries] of Object.entries(body.burn || {})) {
          const others = (burnLog[d] || []).filter(a => !String(a.id || '').startsWith('whoop-'));
          burnLog[d] = [...others, ...entries];
        }
        return { ...prev, vitalsLog, burnLog, whoopConnected: true };
      });
      const vDays = Object.keys(body.vitals || {}).length;
      const bDays = Object.keys(body.burn || {}).length;
      setMsg(`Synced ${vDays} day${vDays === 1 ? '' : 's'} of vitals · ${bDays} workout day${bDays === 1 ? '' : 's'}.`);
    } catch (e) {
      setMsg(e.message || 'WHOOP sync failed.');
    }
    setBusy(false);
  }

  // Handle the OAuth redirect (?whoop=connected) and auto-sync once
  // per session when already connected.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('whoop');
    if (r) {
      p.delete('whoop');
      const qs = p.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
      if (r === 'connected') {
        update(prev => (prev.whoopConnected ? prev : { ...prev, whoopConnected: true }));
        syncNow(7);
        return;
      }
      setMsg(`WHOOP connect failed (${r}).`);
      return;
    }
    if (connected && !sessionStorage.getItem('vb_whoop_synced')) {
      sessionStorage.setItem('vb_whoop_synced', '1');
      syncNow(7, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true); setMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/.netlify/functions/whoop-connect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'connect failed');
      window.location.href = body.url;
    } catch (e) {
      setMsg(e.message || 'Could not start WHOOP connect.');
      setBusy(false);
    }
  }

  return (
    <div className="vitals-ah vitals-whoop">
      <div className="vitals-ah-row">
        {!connected ? (
          <button type="button" className="vitals-ah-btn" disabled={busy} onClick={connect}>
            {busy ? 'Opening WHOOP…' : 'Connect WHOOP'}
          </button>
        ) : (
          <>
            <button type="button" className="vitals-ah-btn" disabled={busy} onClick={() => syncNow(7)}>
              {busy ? 'Syncing…' : 'Sync WHOOP'}
            </button>
            <button type="button" className="vitals-ah-btn vitals-ah-btn-alt" disabled={busy} onClick={() => syncNow(30)}>30d</button>
          </>
        )}
        <span className="vitals-ah-hint">
          {msg || (connected
            ? 'Pulls recovery, sleep, HRV, strain and workout burn. Auto-syncs when you open the app.'
            : 'Link your WHOOP — recovery, sleep, HRV, strain and measured workout burn.')}
        </span>
      </div>
    </div>
  );
}

// Tap-to-edit limits for the history table (same bounds as the hub
// Vitals widget uses for today's entry).
const EDIT_LIMITS = {
  weight: { max: 400, step: '0.1', unit: 'kg'  },
  sleep:  { max: 24,  step: '0.5', unit: 'h'   },
  rhr:    { max: 250, step: '1',   unit: 'bpm' },
};

export default function VitalsHistoryCard({ S, update }) {
  const isOwner = typeof window !== 'undefined' && !!window.__vantageOwner;
  const [metricKey, setMetricKey] = useState('weight');
  const [rangeKey, setRangeKey] = useState('30d');
  const [hover, setHover] = useState(null); // index into points
  const [edit, setEdit] = useState(null); // { date, key } | null
  const [editDraft, setEditDraft] = useState('');
  const [extraDate, setExtraDate] = useState(null); // day pulled into the table via the date picker
  const svgRef = useRef(null);

  const metric = METRICS.find(m => m.key === metricKey);
  const range = RANGES.find(r => r.key === rangeKey);
  const log = metric.src === 'macro' ? (S.macroHistory || {}) : (S.vitalsLog || {});

  // All entries for the metric, oldest → newest, as { ts, v, date }.
  const points = useMemo(() => {
    const cutoff = range.days ? Date.now() - range.days * DAY_MS : -Infinity;
    return Object.keys(log).sort()
      .map(date => ({ date, ts: new Date(date + 'T00:00:00').getTime(), v: log[date]?.[metricKey] }))
      .filter(p => p.v != null && p.ts >= cutoff);
  }, [log, metricKey, range.days]);

  const hasChart = points.length >= 2;

  // Scales — time on X (uneven gaps stay honest), value on Y with
  // ~8% headroom so the line never kisses the frame.
  let geom = null;
  if (hasChart) {
    const x0 = points[0].ts, x1 = points[points.length - 1].ts;
    const vs = points.map(p => p.v);
    let vMin = Math.min(...vs), vMax = Math.max(...vs);
    const padV = (vMax - vMin || 1) * 0.08;
    vMin -= padV; vMax += padV;
    const sx = ts => PAD_L + ((ts - x0) / (x1 - x0 || 1)) * (W - PAD_L - PAD_R);
    const sy = v => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (H - PAD_T - PAD_B);
    geom = { sx, sy, ticks: niceTicks(vMin + padV, vMax - padV), x0, x1 };
  }

  function onMove(e) {
    if (!geom || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geom.sx(p.ts) - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHover(best);
  }

  // Recent entries table — newest first, all three metrics, so every
  // value is reachable without hovering the chart.
  // Table always shows the vitals log (not the chart's metric source —
  // macro history reads as a chart, the table is the vitals record).
  const vitalsLog = S.vitalsLog || {};
  const tableRows = useMemo(() => {
    const dates = new Set(Object.keys(vitalsLog).sort().reverse().slice(0, 10));
    if (extraDate) dates.add(extraDate);
    return [...dates].sort().reverse().map(date => ({ date, ...(vitalsLog[date] || {}) }));
  }, [vitalsLog, extraDate]);

  // ── Editing previous days ──
  // Any weight/sleep/rhr cell is tap-to-edit; committing writes the
  // value into S.vitalsLog[date]. Clearing a cell removes that value
  // (and drops the day entirely once it holds nothing).
  function beginEdit(date, key) {
    if (!update) return;
    const cur = vitalsLog[date]?.[key];
    setEditDraft(cur != null ? String(cur) : '');
    setEdit({ date, key });
  }
  function commitEdit() {
    if (!edit) return;
    const { date, key } = edit;
    const raw = editDraft.trim();
    setEdit(null);
    if (raw === '') {
      update(prev => {
        const log = { ...(prev.vitalsLog || {}) };
        if (!log[date] || log[date][key] == null) return prev;
        const day = { ...log[date] };
        delete day[key];
        if (Object.keys(day).length) log[date] = day; else delete log[date];
        return { ...prev, vitalsLog: log };
      });
      return;
    }
    const num = parseFloat(raw);
    if (!Number.isFinite(num) || num <= 0 || num > EDIT_LIMITS[key].max) return;
    update(prev => ({
      ...prev,
      vitalsLog: {
        ...(prev.vitalsLog || {}),
        [date]: { ...((prev.vitalsLog || {})[date] || {}), [key]: num },
      },
    }));
  }
  function editableCell(r, key) {
    const lim = EDIT_LIMITS[key];
    if (edit && edit.date === r.date && edit.key === key) {
      return (
        <input
          className="vitals-edit-input"
          type="number" inputMode="decimal" step={lim.step} autoFocus
          value={editDraft}
          onChange={e => setEditDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEdit(null); }}
          onBlur={commitEdit}
          aria-label={`${key} on ${r.date}`}
        />
      );
    }
    const shown = r[key] != null ? `${r[key]} ${lim.unit}` : '–';
    if (!update) return shown;
    return (
      <button type="button" className="vitals-edit-cell" onClick={() => beginEdit(r.date, key)} title="Tap to edit">
        {shown}
      </button>
    );
  }
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const addDayPicker = update ? (
    <div className="vitals-addday">
      <label className="vitals-addday-label">
        Edit another day
        <input
          type="date" max={todayStr}
          onChange={e => { if (e.target.value) setExtraDate(e.target.value); }}
        />
      </label>
      <span className="vitals-addday-hint">Tap any value to edit or backfill that day.</span>
    </div>
  ) : null;

  const hasMacroHistory = Object.keys(S.macroHistory || {}).length > 0;
  if (!tableRows.length && !hasMacroHistory) {
    return (
      <div className="card vitals-card">
        <h3 style={{ margin: '0 0 4px' }}>Vitals &amp; Macros</h3>
        <p className="vitals-sub">
          No history yet. Log weight/sleep/HR from the hub Vitals widget, or log food in Daily Macros — each day banks a “% of goal hit” snapshot here.
        </p>
        {addDayPicker}
        {isOwner && update && <><WhoopPanel S={S} update={update} /><AppleHealthImport S={S} update={update} /></>}
      </div>
    );
  }

  const hoverPt = hover != null ? points[hover] : null;
  const last = points[points.length - 1];

  return (
    <div className="card vitals-card">
      <h3 style={{ margin: '0 0 4px' }}>Vitals &amp; Macros</h3>
      <p className="vitals-sub">Vitals from the hub widget; macro days saved as % of each goal hit. Hover the chart for exact values.</p>

      {isOwner && update && <><WhoopPanel S={S} update={update} /><AppleHealthImport S={S} update={update} /></>}

      {/* Filter row — metric first (it names the chart), then range. */}
      <div className="vitals-controls">
        <div className="vitals-seg" role="tablist" aria-label="Vitals metric">
          {METRICS.filter(m => m.src === 'vitals').map(m => (
            <button key={m.key} type="button" role="tab" aria-selected={metricKey === m.key}
              className={`vitals-seg-btn${metricKey === m.key ? ' on' : ''}`}
              onClick={() => { setMetricKey(m.key); setHover(null); }}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="vitals-seg" role="tablist" aria-label="Macro metric">
          {METRICS.filter(m => m.src === 'macro').map(m => (
            <button key={m.key} type="button" role="tab" aria-selected={metricKey === m.key}
              className={`vitals-seg-btn${metricKey === m.key ? ' on' : ''}`}
              onClick={() => { setMetricKey(m.key); setHover(null); }}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="vitals-seg" role="tablist" aria-label="Range">
          {RANGES.map(r => (
            <button key={r.key} type="button" role="tab" aria-selected={rangeKey === r.key}
              className={`vitals-seg-btn${rangeKey === r.key ? ' on' : ''}`}
              onClick={() => { setRangeKey(r.key); setHover(null); }}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {hasChart ? (
        <div className="vitals-chart-wrap">
          <svg
            ref={svgRef}
            className="vitals-chart"
            viewBox={`0 0 ${W} ${H}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`${metric.label} over time, ${points.length} entries`}
          >
            {/* hairline grid + y ticks (clean numbers) */}
            {geom.ticks.map(t => (
              <g key={t}>
                <line x1={PAD_L} x2={W - PAD_R} y1={geom.sy(t)} y2={geom.sy(t)} className="vitals-grid" />
                <text x={PAD_L - 7} y={geom.sy(t) + 3} className="vitals-tick" textAnchor="end">{t}</text>
              </g>
            ))}
            {/* 100% target line for macro metrics (when in view) */}
            {metric.src === 'macro' && geom.sy(100) >= PAD_T && geom.sy(100) <= H - PAD_B && (
              <line x1={PAD_L} x2={W - PAD_R} y1={geom.sy(100)} y2={geom.sy(100)} className="vitals-target" />
            )}
            {/* x labels — first + last date only; the crosshair carries the rest */}
            <text x={PAD_L} y={H - 8} className="vitals-tick" textAnchor="start">{fmtDay(geom.x0)}</text>
            <text x={W - PAD_R} y={H - 8} className="vitals-tick" textAnchor="end">{fmtDay(geom.x1)}</text>

            {/* area wash + 2px line */}
            <path
              d={points.map((p, i) => `${i ? 'L' : 'M'}${geom.sx(p.ts).toFixed(1)},${geom.sy(p.v).toFixed(1)}`).join('')
                + `L${geom.sx(last.ts).toFixed(1)},${H - PAD_B}L${geom.sx(points[0].ts).toFixed(1)},${H - PAD_B}Z`}
              className="vitals-area"
            />
            <path
              d={points.map((p, i) => `${i ? 'L' : 'M'}${geom.sx(p.ts).toFixed(1)},${geom.sy(p.v).toFixed(1)}`).join('')}
              className="vitals-line"
            />

            {/* crosshair + hovered point */}
            {hoverPt && (
              <g>
                <line x1={geom.sx(hoverPt.ts)} x2={geom.sx(hoverPt.ts)} y1={PAD_T} y2={H - PAD_B} className="vitals-crosshair" />
                <circle cx={geom.sx(hoverPt.ts)} cy={geom.sy(hoverPt.v)} r="5" className="vitals-dot" />
              </g>
            )}

            {/* endpoint marker + direct label */}
            <circle cx={geom.sx(last.ts)} cy={geom.sy(last.v)} r="4" className="vitals-dot" />
            <text x={Math.min(geom.sx(last.ts) + 8, W - PAD_R)} y={geom.sy(last.v) - 8}
              className="vitals-endlabel"
              textAnchor={geom.sx(last.ts) > W - 70 ? 'end' : 'start'}>
              {last.v} {metric.unit}
            </text>
          </svg>

          {hoverPt && (
            <div
              className="vitals-tooltip"
              style={{ left: `${(geom.sx(hoverPt.ts) / W) * 100}%` }}
            >
              <div className="vitals-tooltip-date">{fmtDay(hoverPt.ts)}</div>
              <div className="vitals-tooltip-val">{hoverPt.v} <span>{metric.unit}</span></div>
            </div>
          )}
        </div>
      ) : (
        <div className="vitals-sub" style={{ padding: '18px 0' }}>
          {points.length === 1
            ? `One ${metric.label.toLowerCase()} entry in this range — log a second to draw the trend.`
            : `No ${metric.label.toLowerCase()} entries in this range.`}
        </div>
      )}

      {/* Table view — the no-hover home for every value. */}
      {tableRows.length > 0 && (
      <table className="vitals-table">
        <thead>
          <tr><th>Date</th><th>Weight</th><th>Sleep</th><th>Rest HR</th></tr>
        </thead>
        <tbody>
          {tableRows.map(r => (
            <tr key={r.date}>
              <td>{fmtDay(new Date(r.date + 'T00:00:00').getTime())}</td>
              <td>{editableCell(r, 'weight')}</td>
              <td>{editableCell(r, 'sleep')}</td>
              <td>{editableCell(r, 'rhr')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
      {addDayPicker}
    </div>
  );
}
