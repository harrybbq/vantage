import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import './MarketWidget.css';
import { authFetch } from '../../lib/authFetch';
import { useSubscriptionContext } from '../../context/SubscriptionContext';

/**
 * Market widget — delayed quotes for a watchlist. Public market data
 * only: no account, no positions, no orders, nothing shared with the
 * trading widget or a broker.
 *
 * Two reading modes, because a watchlist longer than the card can show
 * has to go somewhere:
 *   · Scroll — the list creeps upward on its own, glanceable
 *   · Pages  — flick through a page at a time, for actually reading
 * The choice persists in S, since it's a preference rather than a
 * session detail.
 *
 * Free tier sees FREE_LIMIT symbols; Pro raises it. The cap is applied
 * to what's REQUESTED, so a user who downgrades keeps their full list
 * in state and simply sees fewer — nothing is deleted on tier change.
 */

export const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'];
const FREE_LIMIT = 5;
const PRO_LIMIT = 20;
const PAGE_SIZE = 4;
const SCROLL_MS = 2600;

function pct(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function tone(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'unknown';
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}
function price(v) {
  // A zero price means "unknown symbol", not "worthless" — the function
  // already nulls those, and this keeps the display honest either way.
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return null;
  return v.toFixed(2);
}

export default function MarketBody({ S, update, compact = false }) {
  const { hasPro } = useSubscriptionContext();
  const limit = hasPro ? PRO_LIMIT : FREE_LIMIT;

  const watchlist = Array.isArray(S?.marketSymbols) && S.marketSymbols.length
    ? S.marketSymbols
    : DEFAULT_SYMBOLS;
  const shown = watchlist.slice(0, limit);

  const autoScroll = S?.marketAutoScroll !== false;   // default on
  const [state, setState] = useState({ kind: 'loading' });
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState('');
  const alive = useRef(true);

  const key = shown.join(',');
  useEffect(() => {
    alive.current = true;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const res = await authFetch(`/.netlify/functions/market-quotes?symbols=${encodeURIComponent(key)}`);
        const body = await res.json().catch(() => null);
        if (!alive.current) return;
        if (!res.ok || !body) return setState({ kind: 'error' });
        if (body.configured === false) return setState({ kind: 'unconfigured' });
        setState({ kind: 'ok', quotes: body.quotes || [], delayed: body.delayed });
      } catch {
        if (alive.current) setState({ kind: 'error' });
      }
    })();
    return () => { alive.current = false; };
  }, [key]);

  const quotes = state.kind === 'ok' ? state.quotes : [];
  const pages = Math.max(1, Math.ceil(quotes.length / PAGE_SIZE));

  // Auto-advance only in scroll mode. Paused while the tab is hidden so
  // a backgrounded hub isn't cycling a timer for nobody.
  useEffect(() => {
    if (!autoScroll || state.kind !== 'ok' || quotes.length <= PAGE_SIZE) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setPage(p => (p + 1) % pages);
    }, SCROLL_MS);
    return () => clearInterval(id);
  }, [autoScroll, state.kind, quotes.length, pages]);

  function setAuto(next) {
    update?.(prev => ({ ...prev, marketAutoScroll: next }));
  }
  function addSymbol(e) {
    e.preventDefault();
    const sym = adding.toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
    if (!sym) return;
    update?.(prev => {
      const list = Array.isArray(prev.marketSymbols) && prev.marketSymbols.length
        ? prev.marketSymbols : DEFAULT_SYMBOLS;
      if (list.includes(sym)) return prev;
      return { ...prev, marketSymbols: [...list, sym] };
    });
    setAdding('');
  }
  function removeSymbol(sym) {
    update?.(prev => {
      const list = Array.isArray(prev.marketSymbols) && prev.marketSymbols.length
        ? prev.marketSymbols : DEFAULT_SYMBOLS;
      return { ...prev, marketSymbols: list.filter(s => s !== sym) };
    });
  }

  if (state.kind === 'unconfigured') {
    return (
      <div className="mkt-note">
        Market data isn’t switched on yet.
        <span className="mkt-note-sub">Set FINNHUB_API_KEY in Netlify.</span>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="mkt-note">
        Couldn’t load quotes.
        <span className="mkt-note-sub">No prices shown rather than stale ones.</span>
      </div>
    );
  }
  if (state.kind === 'loading') return <div className="mkt-note">Loading…</div>;

  const visible = autoScroll
    ? quotes
    : quotes.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="mkt">
      <div className="mkt-head">
        <span className="mkt-delayed" title="15-minute delayed. Real-time quotes need an exchange data licence.">
          Delayed
        </span>
        <div className="mkt-modes" role="group" aria-label="Reading mode">
          <button type="button" className={autoScroll ? 'is-on' : ''} onClick={() => setAuto(true)}>Scroll</button>
          <button type="button" className={!autoScroll ? 'is-on' : ''} onClick={() => setAuto(false)}>Pages</button>
        </div>
      </div>

      <div className={`mkt-list${autoScroll ? ' is-scrolling' : ''}`}>
        <div
          className="mkt-track"
          style={autoScroll ? { transform: `translateY(-${page * PAGE_SIZE * 34}px)` } : undefined}
        >
          {visible.map(q => (
            <div key={q.symbol} className="mkt-row">
              <span className="mkt-sym">{q.symbol}</span>
              <span className="mkt-price">
                {price(q.price) ?? <span className="mkt-unknown" title="No quote for this symbol">—</span>}
              </span>
              <span className={`mkt-chg is-${tone(q.changePct)}`}>
                {pct(q.changePct) ?? '—'}
              </span>
              {!compact && (
                <button
                  type="button"
                  className="mkt-x"
                  onClick={() => removeSymbol(q.symbol)}
                  aria-label={`Remove ${q.symbol}`}
                ><Icon name="x" size={11} /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      {!autoScroll && pages > 1 && (
        <div className="mkt-pager">
          <button type="button" onClick={() => setPage(p => (p - 1 + pages) % pages)} aria-label="Previous">
            <Icon name="chevron-left" size={13} />
          </button>
          <span>{page + 1} / {pages}</span>
          <button type="button" onClick={() => setPage(p => (p + 1) % pages)} aria-label="Next">
            <Icon name="chevron-right" size={13} />
          </button>
        </div>
      )}

      {!compact && (
        <form className="mkt-add" onSubmit={addSymbol}>
          <input
            value={adding}
            onChange={e => setAdding(e.target.value)}
            placeholder={watchlist.length >= limit ? `${limit} max on your plan` : 'Add ticker…'}
            disabled={watchlist.length >= limit}
            maxLength={12}
            aria-label="Add a ticker"
          />
          <button type="submit" disabled={!adding.trim() || watchlist.length >= limit}>Add</button>
        </form>
      )}

      {watchlist.length > limit && (
        <div className="mkt-capped">
          Showing {limit} of {watchlist.length} — Pro shows up to {PRO_LIMIT}.
        </div>
      )}
    </div>
  );
}
