/**
 * The pieces that make a ticket explain itself (lib/security/explain.js):
 * the explanation block (headline · why · steps · facts), the "go to
 * source" controls, and the client-error groups a spike points at.
 *
 * In-app sources call go(tab, focus) — SecurityTab switches sub-tab and
 * the panel pulses the element. External sources (the Netlify deploy
 * log, a Supabase page, an advisor's fix guide) open in a new tab with
 * rel="noopener noreferrer"; explain() has already dropped anything that
 * isn't https.
 */
import { useState } from 'react';
import Icon from '../../Icon';
import { usePanel } from './usePanel';
import { Gate, NoData, Calm } from './parts';
import { ago, stamp, fmtInt } from '../../../lib/security/format';

const TAB_NAME = { overview: 'Overview', database: 'Database', netlify: 'Netlify', moderation: 'Moderation', tickets: 'Tickets' };

/** "Database → Disk meter" */
export function sourceText(s) {
  if (!s || !s.tab) return '';
  return `${TAB_NAME[s.tab] || s.tab}${s.label ? ` → ${s.label}` : ''}`;
}

/** The drawer's source controls: the in-app jump (primary) and the outside page. */
export function SourceButtons({ source, go }) {
  if (!source || (!source.tab && !source.href)) return null;
  return (
    <div className="sec-src-acts">
      {source.tab && go && (
        <button type="button" className="sec-btn is-primary sec-go-src" onClick={() => go(source.tab, source.focus)}>
          <Icon name="locate-fixed" size={12} /> Go to source · {sourceText(source)}
        </button>
      )}
      {source.href && (
        <a className="sec-btn" href={source.href} target="_blank" rel="noopener noreferrer">
          {source.hrefLabel || 'Open'} <Icon name="external-link" size={11} />
        </a>
      )}
    </div>
  );
}

/** A row's compact "go to source" control, beside the row (never inside its button). */
export function RowSource({ source, go, title }) {
  if (!source) return null;
  const label = `Go to source: ${source.tab ? sourceText(source) : source.hrefLabel || 'open'}${title ? ` (${title})` : ''}`;
  if (source.tab && go) {
    return (
      <button type="button" className="sec-row-go" onClick={() => go(source.tab, source.focus)} aria-label={label} title={label}>
        <Icon name="locate-fixed" size={14} /><span>Source</span>
      </button>
    );
  }
  if (source.href) {
    return (
      <a className="sec-row-go" href={source.href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
        <Icon name="external-link" size={13} /><span>Source</span>
      </a>
    );
  }
  return null;
}

/**
 * The stored title (when the row shows the headline instead) · why ·
 * the source controls · steps · facts. The headline itself is the row
 * this sits under, so it is not repeated.
 */
export function Explanation({ e, t, go }) {
  return (
    <div className="sec-explain">
      {e.useHeadline && t.title && t.title !== e.headline && <div className="sec-explain-title">{t.title}</div>}
      {e.why && <p className="sec-explain-why">{e.why}</p>}
      <SourceButtons source={e.source} go={go} />
      {e.steps.length > 0 && (
        <ol className="sec-explain-steps">
          {e.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {e.facts.length > 0 && (
        <dl className="sec-dl sec-explain-facts">
          {e.facts.map((f, i) => (
            <div key={i} className={f.wide ? 'is-wide' : ''}>
              <dt>{f.label}</dt>
              <dd title={f.title || undefined} className={f.wide ? 'is-text' : ''}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function pathOf(u) {
  if (!u) return null;
  try { return new URL(u).pathname || '/'; } catch { return String(u); }
}

/**
 * The top client-error groups — message + first stack frame, count,
 * last seen, the build, a sample page. No user ids ever reach the page.
 */
export function ErrorGroups({ initialWindow = '24h', compact = false, focusKey, label = true }) {
  const [win, setWin] = useState(initialWindow);
  const eg = usePanel('errors', { params: { window: win } });
  return (
    <div className="sec-errs" data-sec-focus={focusKey || undefined}>
      <div className="sec-errs-head">
        <span className="sec-eyebrow">{label ? '// top errors · grouped by message + first frame' : ''}</span>
        <div className="sec-seg" role="group" aria-label="Error window">
          {['1h', '24h'].map(w => (
            <button key={w} type="button" className={win === w ? 'is-on' : ''} aria-pressed={win === w} onClick={() => setWin(w)}>
              {w === '1h' ? 'Last hour' : '24 h'}
            </button>
          ))}
        </div>
      </div>
      <Gate res={eg.res}>
        {d => {
          const groups = Array.isArray(d.groups) ? d.groups : [];
          if (!groups.length) return win === '1h' ? <Calm>No app errors in the last hour.</Calm> : <NoData>No app errors in the last 24 hours.</NoData>;
          const shown = compact ? groups.slice(0, 5) : groups;
          return (
            <>
              <ol className="sec-errlist">
                {shown.map((g, i) => (
                  <li key={i} className="sec-err">
                    <b className="sec-err-n" title={`${g.count} occurrence${g.count === 1 ? '' : 's'}`}>×{fmtInt(g.count)}</b>
                    <div className="sec-err-main">
                      <div className="sec-err-msg">{g.message}</div>
                      {g.frame && <div className="sec-err-frame">at {g.frame}</div>}
                      <div className="sec-err-meta">
                        <span title={stamp(g.lastSeen)}>last {ago(g.lastSeen)}</span>
                        {g.release && <span title={(g.releases || []).join(', ')}>build {g.release}{(g.releases || []).length > 1 ? ` +${g.releases.length - 1}` : ''}</span>}
                        {g.sampleUrl && <span>on {pathOf(g.sampleUrl)}</span>}
                        {g.kind && <span>{g.kind}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="sec-fine">
                {fmtInt(d.total)} error{d.total === 1 ? '' : 's'} in the window{d.capped ? ` · grouped from the newest ${fmtInt(d.sampled)}` : ''}
                {compact && groups.length > shown.length ? ` · ${groups.length - shown.length} more group${groups.length - shown.length === 1 ? '' : 's'} on the Netlify tab` : ''}
              </div>
            </>
          );
        }}
      </Gate>
    </div>
  );
}
