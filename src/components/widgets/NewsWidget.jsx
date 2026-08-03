import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import './NewsWidget.css';
import { authFetch } from '../../lib/authFetch';
import { useSubscriptionContext } from '../../context/SubscriptionContext';

/**
 * News widget — today's headlines, with an optional topic filter.
 *
 * Headlines and links only, never article bodies. News APIs licence the
 * headline, a snippet and a link; the article text is not ours to
 * render. Every item opens the publisher's own page, and the source is
 * always named. Don't "improve" this into an in-app reader.
 *
 * The topic filter is the Pro half — free tier gets the general feed,
 * Pro gets "only show me news about cars". The saved query lives in S
 * so it survives a reload, and is left alone on downgrade rather than
 * deleted.
 */

const FREE_ITEMS = 4;
const PRO_ITEMS = 12;

function timeAgo(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export default function NewsBody({ S, update, compact = false, hasPro: hasProProp }) {
  // See MarketWidget: desktop islands are detached React roots and do
  // not inherit the subscription provider.
  const ctx = useSubscriptionContext();
  const hasPro = hasProProp !== undefined ? hasProProp : ctx.hasPro;
  const saved = typeof S?.newsQuery === 'string' ? S.newsQuery : '';
  // The filter is Pro. A free user with a saved query (from a lapsed
  // subscription) sees the general feed rather than an error, and the
  // query stays in state for if they resubscribe.
  const activeQuery = hasPro ? saved : '';

  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState({ kind: 'loading' });
  const alive = useRef(true);

  useEffect(() => { setDraft(saved); }, [saved]);

  useEffect(() => {
    alive.current = true;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const url = `/.netlify/functions/news-today${activeQuery ? `?q=${encodeURIComponent(activeQuery)}` : ''}`;
        const res = await authFetch(url);
        const body = await res.json().catch(() => null);
        if (!alive.current) return;
        if (!res.ok || !body) {
          return setState({ kind: 'error', rate: body?.error === 'rate-limited', status: body?.status, detail: body?.detail || body?.error || `HTTP ${res.status}` });
        }
        if (body.configured === false) return setState({ kind: 'unconfigured', missing: body.missing, nearby: body.nearby });
        setState({ kind: 'ok', items: body.items || [] });
      } catch {
        if (alive.current) setState({ kind: 'error' });
      }
    })();
    return () => { alive.current = false; };
  }, [activeQuery]);

  function submit(e) {
    e.preventDefault();
    if (!hasPro) return;
    const q = draft.trim().slice(0, 60);
    update?.(prev => ({ ...prev, newsQuery: q }));
  }
  function clearFilter() {
    setDraft('');
    update?.(prev => ({ ...prev, newsQuery: '' }));
  }

  const limit = hasPro ? PRO_ITEMS : FREE_ITEMS;
  const items = state.kind === 'ok' ? state.items.slice(0, compact ? Math.min(3, limit) : limit) : [];

  return (
    <div className="nws">
      {hasPro ? (
        <form className="nws-filter" onSubmit={submit}>
          <Icon name="search" size={12} />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Filter by topic — e.g. cars"
            maxLength={60}
            aria-label="Filter news by topic"
          />
          {activeQuery && (
            <button type="button" onClick={clearFilter} aria-label="Clear filter">
              <Icon name="x" size={12} />
            </button>
          )}
        </form>
      ) : (
        <div className="nws-locked">
          <Icon name="lock" size={11} />
          Topic filter is a Pro feature
        </div>
      )}

      {state.kind === 'loading' && <div className="nws-note">Loading…</div>}

      {state.kind === 'unconfigured' && (
        <div className="nws-note">
          News isn’t switched on yet.
          <span className="nws-note-sub">
            The function can’t see {state.missing || 'GNEWS_API_KEY'}.
            {state.nearby?.length
              ? ` It CAN see: ${state.nearby.join(', ')} — so the name differs, or that one is empty.`
              : ' It can see no similar name at all — the variable’s scope probably excludes Functions, or it’s set for a different deploy context.'}
          </span>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="nws-note">
          {state.rate ? 'Too many requests — try again shortly.' : 'Couldn’t load headlines.'}
          <span className="nws-note-sub">
            {state.status ? `${state.status}: ` : ''}{state.detail || 'Try again later.'}
          </span>
        </div>
      )}

      {state.kind === 'ok' && items.length === 0 && (
        <div className="nws-note">
          Nothing found{activeQuery ? ` for “${activeQuery}”` : ''}.
        </div>
      )}

      {items.length > 0 && (
        <ul className="nws-list">
          {items.map(a => (
            <li key={a.url}>
              {/* noreferrer as well as noopener: the headline URL is
                  third-party, and there's no reason to leak the Vantage
                  page a reader came from. */}
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                <span className="nws-title">{a.title}</span>
                <span className="nws-meta">
                  {a.source}{timeAgo(a.publishedAt) ? ` · ${timeAgo(a.publishedAt)}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {state.kind === 'ok' && !hasPro && state.items.length > FREE_ITEMS && (
        <div className="nws-capped">Pro shows {PRO_ITEMS} headlines and lets you filter by topic.</div>
      )}
    </div>
  );
}
