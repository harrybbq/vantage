import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import './TradingWidget.css';
import { authFetch } from '../../lib/authFetch';
import {
  formatMinor, formatPct, pctTone, trimQty,
  STATUS_LABEL, reconciliationOk, relativeAge,
} from '../../lib/trading/report';

/**
 * Read-only window onto vantage-trades. A glance, not a dashboard — the
 * other app has the control panel.
 *
 * It is deliberately incapable of acting: there is no handler here that
 * places an order, halts an agent or moves capital, and the function it
 * calls has no such endpoint either. The only button refreshes.
 *
 * Owner-only. The check that matters is server-side in
 * netlify/functions/trading-summary.js — hiding the widget in the
 * picker is presentation, and a UI gate is not an access control.
 */

// One in-flight fetch shared across mounts, plus a short memo. The
// desktop hub can mount this alongside the mobile stack during a
// resize, and two brokerage round-trips for one glance is wasteful.
let inflight = null;
let memo = { at: 0, value: null };
const MEMO_MS = 30_000;

async function loadReport({ force = false } = {}) {
  if (!force && memo.value && Date.now() - memo.at < MEMO_MS) return memo.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await authFetch('/.netlify/functions/trading-summary');
      let body = null;
      try { body = await res.json(); } catch { /* handled below */ }
      if (res.status === 403) return { kind: 'forbidden' };
      if (!res.ok || !body) {
        return { kind: 'unreachable', detail: body?.error || `HTTP ${res.status}` };
      }
      if (body.configured === false) return { kind: 'unconfigured' };
      return { kind: 'ok', report: body.report };
    } catch (e) {
      // Never fall back to an empty success — "couldn't reach it" must
      // stay distinguishable from "there's nothing there".
      return { kind: 'unreachable', detail: e?.message || 'network' };
    } finally {
      inflight = null;
    }
  })();
  const value = await inflight;
  memo = { at: Date.now(), value };
  return value;
}

function Money({ minor, currency, className = '' }) {
  const text = formatMinor(minor, currency);
  if (text === null) {
    return (
      <span className={`trd-unknown ${className}`} title="No current price for one or more holdings">
        —<span className="trd-unknown-note">no price</span>
      </span>
    );
  }
  return <span className={className}>{text}</span>;
}

function Pct({ value }) {
  const text = formatPct(value);
  const tone = pctTone(value);
  if (text === null) return <span className="trd-unknown" title="No baseline yet">—</span>;
  return <span className={`trd-pct is-${tone}`}>{text}</span>;
}

export default function TradingBody({ compact = false }) {
  const [state, setState] = useState({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    loadReport().then(r => { if (alive.current) setState(r); });
    return () => { alive.current = false; };
  }, []);

  async function refresh() {
    setRefreshing(true);
    const r = await loadReport({ force: true });
    if (alive.current) { setState(r); setRefreshing(false); }
  }

  if (state.kind === 'loading') {
    return <div className="trd-note">Loading…</div>;
  }
  if (state.kind === 'forbidden') {
    return <div className="trd-note">This widget is owner-only.</div>;
  }
  if (state.kind === 'unconfigured') {
    return (
      <div className="trd-note">
        Not connected yet.
        <span className="trd-note-sub">Set TRADING_REPORT_URL and TRADING_REPORT_TOKEN in Netlify.</span>
      </div>
    );
  }
  if (state.kind === 'unreachable') {
    return (
      <div className="trd-error" role="status">
        <Icon name="triangle-alert" size={14} />
        <div>
          <div className="trd-error-title">Can’t reach the trading app</div>
          <div className="trd-note-sub">Figures below would be out of date, so none are shown. ({state.detail})</div>
        </div>
        <button type="button" className="trd-refresh" onClick={refresh} disabled={refreshing}>
          {refreshing ? '…' : 'Retry'}
        </button>
      </div>
    );
  }

  const r = state.report || {};
  const currency = r.currency || 'GBP';
  const agents = Array.isArray(r.agents) ? r.agents : [];
  const healthy = reconciliationOk(r);
  const age = relativeAge(r.asOf);

  return (
    <div className="trd">
      {/* Reconciliation first and loud. If the ledger has stopped
          agreeing with the broker, every number under this is suspect,
          and a calm-looking card over a divergence is the one outcome
          worth designing against. */}
      {!healthy && (
        <div className="trd-alarm" role="alert">
          <Icon name="triangle-alert" size={14} />
          <div>
            <div className="trd-alarm-title">
              Ledger {r.reconciliation?.status === 'diverged' ? 'diverged from the broker' : 'check failed'}
            </div>
            <div className="trd-alarm-sub">Treat every figure below as unverified.</div>
          </div>
        </div>
      )}

      <div className="trd-head">
        <div>
          <div className="trd-total"><Money minor={r.totalEquityMinor} currency={currency} /></div>
          <div className="trd-sub">
            <Money minor={r.unallocatedMinor} currency={currency} /> unallocated
          </div>
        </div>
        <button
          type="button"
          className="trd-refresh"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh trading figures"
        >
          <Icon name="refresh-cw" size={13} />
        </button>
      </div>

      <div className="trd-agents">
        {agents.length === 0 && <div className="trd-note">No active agents.</div>}
        {agents.map(a => (
          <div key={a.id} className={`trd-agent is-${a.status || 'idle'}`}>
            <div className="trd-agent-top">
              <span className="trd-agent-name">{a.name || a.id}</span>
              <span className={`trd-status is-${a.status || 'idle'}`}>
                {STATUS_LABEL[a.status] || a.status || '—'}
              </span>
            </div>
            <div className="trd-agent-figs">
              <Money minor={a.equityMinor} currency={currency} className="trd-agent-equity" />
              <span className="trd-agent-pcts">
                <Pct value={a.pnlPctSinceStart} />
                <span className="trd-pct-sep">·</span>
                <Pct value={a.pnlPctToday} />
              </span>
            </div>
            {!compact && Array.isArray(a.holdings) && a.holdings.length > 0 && (
              <div className="trd-holdings">
                {a.holdings.map(h => (
                  <span key={h.symbol} className="trd-holding">
                    {h.symbol}<em>{trimQty(h.qty)}</em>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {age && <div className="trd-asof">Updated {age}</div>}
    </div>
  );
}
