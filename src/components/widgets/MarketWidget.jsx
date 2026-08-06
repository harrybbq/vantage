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
const SECS_PER_ROW = 2.4;   // marquee pace, not a step interval

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

export default function MarketBody({ S, update, compact = false, hasPro: hasProProp }) {
  // Desktop hub widgets mount in their OWN React root (createRoot per
  // island), which does not inherit context from the app tree — so
  // useSubscriptionContext() there silently returns the module default
  // and every Pro user looked free. HubSection passes the real value in;
  // the mobile stack renders inside the provider and can still use it.
  const ctx = useSubscriptionContext();
  const hasPro = hasProProp !== undefined ? hasProProp : ctx.hasPro;
  const limit = hasPro ? PRO_LIMIT : FREE_LIMIT;

  const watchlist = Array.isArray(S?.marketSymbols) && S.marketSymbols.length
    ? S.marketSymbols
    : DEFAULT_SYMBOLS;
  const shown = watchlist.slice(0, limit);

  const autoScroll = S?.marketAutoScroll !== false;   // default on
  const [state, setState] = useState({ kind: 'loading' });
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState('');
  // Typeahead. Results appear as you type rather than after Enter,
  // because a ticker is exactly the thing people don't know — "the one
  // for Google" is GOOGL or GOOG and guessing wrong used to add a row
  // that rendered as a dash with no explanation.
  const [suggest, setSuggest] = useState({ open: false, loading: false, items: [] });
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
        if (!res.ok || !body) return setState({ kind: 'error', detail: body?.error || `HTTP ${res.status}` });
        if (body.configured === false) return setState({ kind: 'unconfigured', missing: body.missing, nearby: body.nearby });
        setState({ kind: 'ok', quotes: body.quotes || [], delayed: body.delayed });
      } catch {
        if (alive.current) setState({ kind: 'error', detail: 'network' });
      }
    })();
    return () => { alive.current = false; };
  }, [key]);

  const quotes = state.kind === 'ok' ? state.quotes : [];
  const pages = Math.max(1, Math.ceil(quotes.length / PAGE_SIZE));

  // Scroll mode is a continuous marquee, not a timer that jumps a page
  // every few seconds. The old version advanced by a whole page every
  // 2.6s with a 600ms ease — so the list sat still, lurched, and sat
  // still again, which reads as a glitch rather than a ticker. A CSS
  // animation moving the track at a constant rate is both smoother and
  // cheaper: it runs on the compositor and needs no React state per
  // frame, where the interval re-rendered the whole widget each tick.

  // Debounced so a five-letter ticker is one request, not five. The
  // function caches by query on top of this, so repeat prefixes across
  // users are free.
  useEffect(() => {
    const q = adding.trim();
    if (q.length < 1) { setSuggest({ open: false, loading: false, items: [] }); return; }
    let cancelled = false;
    setSuggest(s2 => ({ ...s2, open: true, loading: true }));
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/.netlify/functions/market-quotes?mode=search&q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => null);
        if (cancelled || !alive.current) return;
        setSuggest({ open: true, loading: false, items: res.ok && body?.results ? body.results : [] });
      } catch {
        if (!cancelled && alive.current) setSuggest({ open: true, loading: false, items: [] });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [adding]);

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
    setSuggest({ open: false, loading: false, items: [] });
  }
  function addPicked(sym) {
    update?.(prev => {
      const list = Array.isArray(prev.marketSymbols) && prev.marketSymbols.length
        ? prev.marketSymbols : DEFAULT_SYMBOLS;
      if (list.includes(sym)) return prev;
      return { ...prev, marketSymbols: [...list, sym] };
    });
    setAdding('');
    setSuggest({ open: false, loading: false, items: [] });
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
        <span className="mkt-note-sub">
          The function can’t see {state.missing || 'FINNHUB_API_KEY'}.
          {state.nearby?.length
            ? ` It CAN see: ${state.nearby.join(', ')} — so the name differs, or that one is empty.`
            : ' It can see no similar name at all — the variable’s scope probably excludes Functions, or it’s set for a different deploy context.'}
        </span>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="mkt-note">
        Couldn’t load quotes.
        <span className="mkt-note-sub">No prices shown rather than stale ones. ({state.detail})</span>
      </div>
    );
  }
  if (state.kind === 'loading') return <div className="mkt-note">Loading…</div>;

  // Only scroll if there is genuinely more than fits — a 3-symbol list
  // sliding around for no reason is worse than a still one.
  const overflows = quotes.length > PAGE_SIZE;
  const marquee = autoScroll && overflows;
  const visible = autoScroll
    ? quotes
    : quotes.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  // Constant rate rather than constant duration, so twenty symbols
  // don't race past at five times the speed of four.
  const marqueeSecs = Math.max(8, quotes.length * SECS_PER_ROW);

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
          className={`mkt-track${marquee ? ' is-marquee' : ''}`}
          style={marquee ? { animationDuration: `${marqueeSecs}s` } : undefined}
        >
          {(marquee ? [...visible, ...visible] : visible).map((q, i) => (
            <div key={`${q.symbol}-${i}`} className="mkt-row" aria-hidden={marquee && i >= visible.length}>
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
          {suggest.open && watchlist.length < limit && (
            <div className="mkt-suggest" role="listbox">
              {suggest.loading && <div className="mkt-suggest-note">Searching…</div>}
              {!suggest.loading && suggest.items.length === 0 && (
                <div className="mkt-suggest-note">No match — you can still add it by hand.</div>
              )}
              {suggest.items.map(r => {
                const already = watchlist.includes(r.symbol);
                return (
                  <button
                    key={r.symbol}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="mkt-suggest-row"
                    disabled={already}
                    onClick={() => addPicked(r.symbol)}
                  >
                    <span className="mkt-suggest-sym">{r.symbol}</span>
                    <span className="mkt-suggest-name">{already ? 'already added' : r.name}</span>
                  </button>
                );
              })}
            </div>
          )}
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
