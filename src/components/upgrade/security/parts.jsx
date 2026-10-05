/**
 * The Security console's small shared pieces: state pills, the
 * "updated Xs ago" stamp with Refresh, the per-panel gate (loading /
 * not installed / not configured / unavailable / error), setup cards,
 * meters, sparklines, KPI tiles and a two-step confirm button.
 *
 * Text never wears a status colour: a pill is ink text beside a
 * coloured dot, a KPI is ink beside a coloured stripe. Colour is the
 * second channel, the word is the first.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../Icon';
import { ago, stamp, clock } from '../../../lib/security/format';
import { sparkPath } from '../../../lib/security/chart';

export function Pill({ p, title }) {
  if (!p) return null;
  return (
    <span className={`sec-pill is-${p.key}`} title={title || p.detail || undefined}>
      <i aria-hidden="true" />{p.label}
    </span>
  );
}

/** "updated 12s ago" — re-renders itself every 5 s; never re-fetches. */
export function Updated({ at, loading, onRefresh, error }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="sec-updated">
      {error && <span className="sec-updated-err" title={error}>refresh failed ·</span>}
      <span title={at ? stamp(at) : undefined}>{loading && !at ? 'loading…' : at ? `updated ${ago(at)}` : ''}</span>
      {onRefresh && (
        <button type="button" className={`sec-refresh${loading ? ' is-busy' : ''}`} onClick={onRefresh} disabled={loading}
                aria-label="Refresh">
          <Icon name="rotate-cw" size={12} /> Refresh
        </button>
      )}
    </span>
  );
}

/** The "// eyebrow" + heading row every card opens with. */
export function CardHead({ eyebrow, title, right, children }) {
  return (
    <div className="sec-card-head">
      <div className="sec-card-titles">
        {eyebrow && <span className="sec-eyebrow">{eyebrow}</span>}
        {title && <h3 className="sec-h">{title}</h3>}
        {children}
      </div>
      {right && <div className="sec-card-right">{right}</div>}
    </div>
  );
}

// ── Setup ─────────────────────────────────────────────────────────

const ENV = {
  SUPABASE_ACCESS_TOKEN: {
    what: 'Supabase scoped access token',
    where: 'Supabase → Account → Access Tokens → new scoped token',
    href: 'https://supabase.com/dashboard/account/tokens',
    scope: 'Limit it to the Vantage project with Usage Analytics (Read), Advisors (Read) and Logs (Read) — nothing else. A classic (“Legacy”) token carries your whole account; don’t use one here.',
    warn: 'Functions scope only, never a VITE_ variable. Give it an expiry.',
  },
  NETLIFY_AUTH_TOKEN: {
    what: 'Netlify personal access token',
    where: 'Netlify → User settings → Applications → Personal access tokens',
    href: 'https://app.netlify.com/user/applications#personal-access-tokens',
    scope: 'The site ID is automatic (SITE_ID) — this token is the only thing to add.',
    warn: 'Netlify tokens are full-account and can’t be scoped — set an expiry, Functions scope only, never a VITE_ variable.',
  },
};

/** A calm "this needs a key" card. Not an error: nothing is broken. */
export function SetupCard({ envs = [], hint, what, compact }) {
  if (!envs.length) {
    // Nothing to add to the environment — usually the SQL hasn't been run.
    return (
      <div className="sec-setup">
        <div className="sec-setup-head"><Icon name="lock" size={14} /><span>{what || 'Not set up yet'}</span></div>
        <p className="sec-setup-p">
          {hint || <>Run <code>supabase/security_console_2026_10.sql</code> in the Supabase SQL editor, then refresh.</>}
        </p>
      </div>
    );
  }
  return (
    <div className={`sec-setup${compact ? ' is-compact' : ''}`}>
      <div className="sec-setup-head">
        <Icon name="lock" size={14} />
        <span>{what || 'Not configured yet'}</span>
      </div>
      {!compact && (
        <p className="sec-setup-p">
          Add {envs.length === 1 ? 'this' : 'these'} in Netlify → Site configuration → Environment variables
          (scope: Functions), then redeploy. Everything else on this page works without {envs.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      <ul className="sec-setup-list">
        {envs.map(e => {
          const m = ENV[e] || {};
          return (
            <li key={e}>
              <code>{e}</code>
              {m.what && <span className="sec-setup-what">{m.what}</span>}
              {!compact && m.where && (
                <span className="sec-setup-where">
                  {m.href ? <a href={m.href} target="_blank" rel="noopener noreferrer">{m.where} <Icon name="external-link" size={10} /></a> : m.where}
                </span>
              )}
              {!compact && m.scope && <span className="sec-setup-scope">{m.scope}</span>}
              {!compact && m.warn && <span className="sec-setup-warn">{m.warn}</span>}
            </li>
          );
        })}
      </ul>
      {hint && !compact && <p className="sec-setup-hint">Server says: {hint}</p>}
    </div>
  );
}

/**
 * Everything a panel can be besides "here is the data".
 * `envs` names what a not_configured answer needs.
 */
export function Gate({ res, envs = [], children }) {
  if (!res) {
    return (
      <div className="sec-skel-wrap" aria-busy="true" aria-label="Loading">
        <div className="sec-skel" /><div className="sec-skel is-short" /><div className="sec-skel" />
      </div>
    );
  }
  if (res.state === 'ok') return children(res.data || {});
  if (res.state === 'not_configured') return <SetupCard envs={envs} hint={res.hint} />;
  if (res.state === 'not-installed') {
    return (
      <div className="sec-note">
        <b>Not installed yet.</b> This panel arrives with the <code>security-console</code> function and
        {' '}<code>supabase/security_console_2026_10.sql</code>. Deploy, run the SQL, then refresh.
      </div>
    );
  }
  if (res.state === 'forbidden') return <div className="sec-note is-bad">{res.error || 'Owner only.'}</div>;
  if (res.state === 'unavailable') {
    return <div className="sec-note is-warn"><b>Unavailable right now.</b> {res.hint || 'The source didn’t answer — try again shortly.'}</div>;
  }
  return <div className="sec-note is-bad">{res.error || 'Something went wrong.'}</div>;
}

// ── Marks ─────────────────────────────────────────────────────────

/** Zero-based sparkline. One series: no legend, the tile's label names it. */
export function Sparkline({ values, max = null, w = 96, h = 26, label }) {
  const p = sparkPath(values, w, h, max);
  if (!p.line) return null;
  return (
    <svg className="sec-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <path d={p.area} className="sec-spark-area" />
      <path d={p.line} className="sec-spark-line" />
      {p.last && <circle cx={p.last.x} cy={p.last.y} r="2.5" className="sec-spark-dot" />}
    </svg>
  );
}

/** A KPI tile: label, a big tabular number, a tone stripe, optional sparkline. */
/**
 * A stat tile (Supabase Overview / Grafana stat): small-caps label, big
 * value with its denominator ALWAYS beside it ("37 / 60", "83% of 8 GB"),
 * the NUMBER coloured by threshold (not the tile), an optional to-scale
 * bar (0–100 %) and an optional faint sparkline behind. Clickable tiles
 * carry a chevron and open their sub-tab. On a phone the grid becomes
 * one column of Grafana's "horizontal with graph" rows.
 */
export function Tile({ label, value, of, tone, sub, onClick, pct, spark, sparkMax, focusKey }) {
  const bar = typeof pct === 'number' && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
  const body = (
    <>
      {spark && spark.length > 1 && (
        <span className="sec-tile-spark" aria-hidden="true">
          <Sparkline values={spark} max={sparkMax} w={160} h={40} />
        </span>
      )}
      <span className="sec-tile-lbl">{label}{onClick && <Icon name="chevron-right" size={12} />}</span>
      <span className="sec-tile-val">
        <b className={`sec-num is-${tone || 'none'}`}>{value}</b>
        {of && <span className="sec-tile-of">{of}</span>}
      </span>
      {sub && <span className="sec-tile-sub">{sub}</span>}
      {bar != null && (
        <span className={`sec-tile-bar is-${tone || 'none'}`} aria-hidden="true"><i style={{ width: `${bar}%` }} /></span>
      )}
    </>
  );
  return onClick
    ? <button type="button" className="sec-tile is-link" onClick={onClick} data-sec-focus={focusKey}>{body}</button>
    : <div className="sec-tile" data-sec-focus={focusKey}>{body}</div>;
}

/** "No data yet" — not healthy, not broken: a source that hasn't reported. */
export function NoData({ children }) {
  return (
    <div className="sec-nodata">
      <b>No data yet</b>
      <span>{children || 'It can take up to 24 hours for data to arrive.'}</span>
    </div>
  );
}

/**
 * Verdict first (Better Stack / UptimeRobot): one sentence, an icon,
 * the issues behind it, and "Updated 14:26 · next in 54s".
 */
export function Verdict({ v, at, nextAt, loading, onRefresh, error }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = nextAt ? Math.max(0, Math.round((nextAt - now) / 1000)) : null;
  const icon = v.key === 'ok' ? 'check' : v.key === 'bad' ? 'octagon-alert' : v.key === 'warn' ? 'triangle-alert' : 'circle-dot';
  return (
    <div className={`sec-verdict is-${v.key}`} role="status">
      <span className="sec-verdict-icon"><Icon name={icon} size={20} strokeWidth={2.2} /></span>
      <div className="sec-verdict-main">
        <div className="sec-verdict-text">{v.text}</div>
        <div className="sec-verdict-sub">
          {error ? <span className="sec-updated-err">refresh failed · </span> : null}
          {at ? `Updated ${clock(at)}` : loading ? 'Checking…' : ''}
          {at && left != null ? ` · next in ${left}s` : ''}
        </div>
        {v.issues.length > 0 && (
          <ul className="sec-issues">
            {v.issues.slice(0, 5).map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        )}
      </div>
      {onRefresh && (
        <button type="button" className={`sec-refresh${loading ? ' is-busy' : ''}`} onClick={onRefresh} disabled={loading} aria-label="Refresh now">
          <Icon name="rotate-cw" size={12} /> Refresh
        </button>
      )}
    </div>
  );
}

/**
 * Right-hand detail panel (full-height sheet on a phone, capped with
 * its own scroll so the backdrop stays tappable). Portalled to <body>
 * and re-wrapped in .upg-app.sec so the theme tokens still apply.
 */
export function Sheet({ title, eyebrow, onClose, children, className = '' }) {
  const panel = useRef(null);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  // Focus moves into the sheet on open and back to what opened it on close.
  useEffect(() => {
    const before = document.activeElement;
    if (panel.current) panel.current.focus({ preventScroll: true });
    return () => { if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <div className={`upg-app sec sec-sheet-root${className ? ` ${className}` : ''}`}>
      <div className="sec-sheet-back" onClick={onClose} aria-hidden="true" />
      <aside ref={panel} tabIndex={-1} className="sec-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sec-sheet-head">
          <div>
            {eyebrow && <span className="sec-eyebrow">{eyebrow}</span>}
            <h3 className="sec-h">{title}</h3>
          </div>
          <button type="button" className="sec-sheet-x" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="sec-sheet-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Two-step destructive button: the first press arms it (label changes,
 * a Cancel appears), the second does it. Disarms itself after 6 s.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, tone = 'bad', className = '' }) {
  const [armed, setArmed] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const arm = () => {
    setArmed(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setArmed(false), 6000);
  };
  if (!armed) {
    return <button type="button" className={`sec-btn is-${tone} ${className}`} disabled={disabled} onClick={arm}>{label}</button>;
  }
  return (
    <span className="sec-confirm">
      <button type="button" className={`sec-btn is-${tone} is-armed ${className}`} disabled={disabled}
              onClick={() => { clearTimeout(t.current); setArmed(false); onConfirm(); }}>
        {confirmLabel || `Confirm ${label.toLowerCase()}`}
      </button>
      <button type="button" className="sec-btn is-quiet" onClick={() => { clearTimeout(t.current); setArmed(false); }}>Cancel</button>
    </span>
  );
}

/** An empty state that reads as healthy — empty queues are the goal. */
export function Calm({ children }) {
  return (
    <div className="sec-calm">
      <Icon name="check" size={13} />
      <span>{children}</span>
    </div>
  );
}
