/**
 * THIS WEEK — the ONE 7-day strip (brief §3.3, A7): the old "plan for the
 * next five days" and the Mon–Sun week strip merged. Each cell:
 *
 *   M 19     day + date
 *   Push     the plan's session (Rest on a rest day)
 *   N1 ●     the shift code (N1–N4 indigo, Off muted) · a trained dot
 *
 * Today has an accent border, a moved session a ↻, a missed one is muted
 * and struck. 7 × 46 + 6 × 6 = 358 px — fits 390 with no scroll. Tap a day
 * → a Sheet with that day's plan and anything logged on it.
 * Every rule is plan.js's (lib/lifts/home.js weekPlan only reads it).
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { Sheet, NightChip } from './ui';
import { weekPlan, dayDetail } from '../../../lib/lifts/home';

export default function WeekStrip({ S, today, gymName = id => id, className = '' }) {
  const week = useMemo(() => weekPlan(S, today), [S, today]);
  const [open, setOpen] = useState(null);
  const detail = useMemo(() => (open ? dayDetail(S, week.find(c => c.iso === open)) : null), [S, week, open]);
  if (!week.length) return null;
  return (
    <section className={`lh-week ${className}`} aria-labelledby="lh-week-h" data-testid="lh-week">
      <p className="lf-eyebrow" id="lh-week-h">// This week</p>
      <ol className="lh-week-row">
        {week.map(c => {
          const label = `${c.dow} ${c.date}: ${c.session || (c.inPattern ? 'rest' : 'outside the rota')}${c.code ? `, ${c.code}` : ''}`
            + `${c.trained ? ', trained' : ''}${c.moved ? ', moved by the plan' : ''}${c.missed ? ', missed — it carries forward' : ''}${c.today ? ', today' : ''}`;
          return (
            <li key={c.iso}>
              <button type="button" className={`lh-day${c.today ? ' is-today' : ''}${c.session ? '' : ' is-rest'}${c.missed ? ' is-missed' : ''}${c.past ? ' is-past' : ''}`}
                      onClick={() => setOpen(c.iso)} aria-label={label} data-testid="lh-day">
                <span className="lh-day-d" aria-hidden="true">{c.dow[0]}<b>{c.date}</b></span>
                <span className="lh-day-s" aria-hidden="true">{c.short}{c.moved && <Icon name="repeat" size={11} />}</span>
                <span className="lh-day-f" aria-hidden="true">
                  <span className={`lh-day-code${c.night ? ' is-night' : ''}`}>{c.code || '—'}</span>
                  {c.trained && <i className="lh-day-dot" />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {detail && <DaySheet d={detail} today={today} gymName={gymName} onClose={() => setOpen(null)} />}
    </section>
  );
}

function DaySheet({ d, today, gymName, onClose }) {
  const when = d.iso === today ? 'Today' : d.iso < today ? 'Past day' : 'Coming up';
  return (
    <Sheet title={`${d.title}${d.session ? ` · ${d.session}` : ''}`} eyebrow={`// ${when}${d.code ? ` · ${d.code}` : ''}`} onClose={onClose} testId="lh-daysheet">
      <div className="lh-dsheet">
        <div className="lh-dsheet-tags">
          {d.night && <NightChip />}
          {d.moved && <span className="lh-tag"><Icon name="repeat" size={12} /> moved by the plan</span>}
          {d.missed && <span className="lh-tag is-muted">missed — it carries forward</span>}
          {d.trained && <span className="lh-tag is-accent"><i className="lh-day-dot" /> trained</span>}
        </div>
        {d.why && <p className="lf-body lh-dsheet-why">{d.why}</p>}
        {d.exercises.length > 0 ? (
          <>
            <p className="lf-eyebrow">// {d.session} · {d.exercises.length} exercises</p>
            <ol className="lh-plist">
              {d.exercises.map(x => (
                <li key={x.name}>
                  <span className="lh-plist-n">{x.name}{x.optional && <em> · optional</em>}</span>
                  <span className="lh-plist-t lf-num">{x.sets} × {x.reps}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="lf-meta">{d.inPattern ? 'Rest day — nothing planned.' : 'Outside your rota pattern — nothing planned.'}</p>
        )}
        {(d.logged.length > 0 || d.quickSets > 0) && (
          <>
            <p className="lf-eyebrow">// Logged</p>
            <ul className="lh-plist">
              {d.logged.map((w, i) => (
                <li key={i}><span className="lh-plist-n">{w.name}{w.gym ? ` · ${gymName(w.gym)}` : ''}</span><span className="lh-plist-t lf-num">{w.sets} sets</span></li>
              ))}
              {d.quickSets > 0 && <li><span className="lh-plist-n">Quick-logged sets</span><span className="lh-plist-t lf-num">{d.quickSets}</span></li>}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
