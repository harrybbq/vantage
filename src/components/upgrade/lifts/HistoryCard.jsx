/**
 * WORKOUT HISTORY — one cell per day, a column per week (Monday on top),
 * darker for more workouts; the year's total beside it. Counts come from
 * lib/lifts/history.js: finished workouts, quick-logged sets and any
 * imported past days, never double-counted.
 *
 *   card    this year's grid · "All years" (a sheet with every year since
 *           the first workout, newest first) · "Add past workouts"
 *   import  paste dates from another app ("2024-12-23 x3" for three that
 *           day); the preview says how many days and workouts it found
 *           before anything is written. Additive only.
 *
 * The grid is one SVG so 53 columns fit a 390 px phone without scrolling
 * (cells scale with the card); each cell carries a <title> for hover, and
 * the SVG an aria-label with the year's totals.
 */
import { useMemo, useState } from 'react';
import { Sheet, Button } from './ui';
import { workoutDays, yearGrid, historyYears, parsePastDays, mergePastDays, pastDayCount, liftedTotals, liftedText } from '../../../lib/lifts/history';

const CELL = 10, GAP = 3, PITCH = CELL + GAP;
const DOW = ['M', '', 'W', '', 'F', '', ''];

const longDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

// Labels are HTML so they stay readable while the cells scale with the card.
function YearGrid({ g, today }) {
  const n = g.cols.length;
  const w = n * PITCH - GAP;
  const h = 7 * PITCH - GAP;
  return (
    <div className="lh-hm">
      <div className="lh-hm-months" aria-hidden="true">
        {g.months.map(m => <span key={m.label} style={{ left: `${(m.col / n) * 100}%` }}>{m.label}</span>)}
      </div>
      <div className="lh-hm-body">
        <div className="lh-hm-dow" aria-hidden="true">{DOW.map((d, r) => <span key={r}>{d}</span>)}</div>
        <svg className="lh-hm-svg" viewBox={`0 0 ${w} ${h}`} role="img" data-testid="lh-hm"
             aria-label={`${g.year}: ${plural(g.total, 'workout')} on ${plural(g.days, 'day')}`}>
          {g.cols.map((col, c) => col.map((cell, r) => cell && (
            <rect key={cell.iso} x={c * PITCH} y={r * PITCH} width={CELL} height={CELL} rx={2}
                  className={`lh-hm-c is-${cell.future ? 'future' : cell.shade}${cell.iso === today ? ' is-today' : ''}`}>
              <title>{`${longDate(cell.iso)}: ${cell.n ? plural(cell.n, 'workout') : 'no workout'}`}</title>
            </rect>
          )))}
        </svg>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <p className="lh-hm-legend" aria-hidden="true">
      Less {[0, 1, 2, 3].map(s => <i key={s} className={`is-${s}`} />)} More
    </p>
  );
}

function YearBlock({ g, today, head = 'h3' }) {
  const H = head;
  return (
    <section className="lh-hm-year" data-testid="lh-hm-year">
      <div className="lh-hm-head">
        <H className="lh-hm-y lf-num">{g.year}</H>
        <span className="lh-hm-total">{plural(g.total, 'workout')}</span>
      </div>
      <YearGrid g={g} today={today} />
    </section>
  );
}

export default function HistoryCard({ S, update, today }) {
  const counts = useMemo(() => workoutDays(S), [S]);
  const lifted = useMemo(() => liftedTotals(S, today), [S, today]);
  const years = useMemo(() => historyYears(counts, today), [counts, today]);
  const grids = useMemo(() => years.map(y => yearGrid(y, counts, today)), [years, counts, today]);
  const [sheet, setSheet] = useState(null);   // 'all' | 'import'
  const imported = pastDayCount(S);
  const all = grids.reduce((a, g) => a + g.total, 0);

  return (
    <section className="lh-card lh-hist" aria-labelledby="lh-hist-h" data-testid="lh-hist">
      <div className="lh-hist-top">
        <p className="lf-eyebrow" id="lh-hist-h">// Workout history</p>
        {grids.length > 1 && <span className="lf-meta">{plural(all, 'workout')} since {grids[grids.length - 1].year}</span>}
      </div>
      {lifted.sets > 0 && (
        <div className="lh-lifted-wrap"><dl className="lh-lifted" data-testid="lh-lifted">
          <div><dt>Total lifted</dt><dd className="lf-num">{liftedText(lifted.all)}</dd></div>
          <div><dt>This year</dt><dd className="lf-num">{liftedText(lifted.year)}</dd></div>
          <div><dt>This month</dt><dd className="lf-num">{liftedText(lifted.month)}</dd></div>
        </dl></div>
      )}
      <YearBlock g={grids[0]} today={today} />
      <Legend />
      <div className="lh-hist-acts">
        {grids.length > 1 && <Button variant="secondary" onClick={() => setSheet('all')} data-testid="lh-hist-all">All years</Button>}
        <Button variant="quiet" icon="plus" onClick={() => setSheet('import')} data-testid="lh-hist-import">Add past workouts</Button>
      </div>

      {sheet === 'all' && (
        <Sheet title="Workout history" eyebrow={`// ${plural(all, 'workout')}`} onClose={() => setSheet(null)} testId="lh-hist-sheet" width={560} className="lh-hist-sheet">
          <div className="lh-hist-years">
            {grids.map(g => <YearBlock key={g.year} g={g} today={today} />)}
            <Legend />
          </div>
        </Sheet>
      )}
      {sheet === 'import' && (
        <ImportSheet today={today} imported={imported} onClose={() => setSheet(null)}
                     onAdd={days => update(prev => mergePastDays(prev, days))} />
      )}
    </section>
  );
}

function ImportSheet({ today, imported, onClose, onAdd }) {
  const [text, setText] = useState('');
  const [done, setDone] = useState(null);
  const p = useMemo(() => parsePastDays(text, today), [text, today]);
  const dates = Object.keys(p.days).sort();
  const count = dates.length;
  const add = () => { onAdd(p.days); setDone(`Added — ${plural(count, 'day')}, ${plural(p.workouts, 'workout')}.`); setText(''); };
  const footer = done
    ? <Button variant="primary" size="lg" block onClick={onClose} data-testid="lh-imp-done">Done</Button>
    : <Button variant="primary" size="lg" block disabled={!count} onClick={add} data-testid="lh-imp-add">{count ? `Add ${plural(count, 'day')}` : 'Paste some dates'}</Button>;
  return (
    <Sheet title="Add past workouts" eyebrow="// Workout history" onClose={onClose} footer={footer} testId="lh-imp" width={480} initialFocus="textarea">
      <div className="lh-imp">
        <p className="lf-meta">Paste the days you trained, from another app or your notes: one date per workout day, written 2024-12-23. Add “x2” after a date that had two workouts.</p>
        <p className="lf-meta">They only fill the history grid. Nothing you’ve logged here changes, and adding the same days again does nothing.</p>
        <label className="lw-field" htmlFor="lh-imp-text">
          <span className="lf-eyebrow">Dates</span>
          <textarea id="lh-imp-text" className="lf-cellbox lh-imp-text" rows={7} value={text} onChange={e => { setText(e.target.value); setDone(null); }}
                    placeholder={'2024-12-23 x2\n2024-12-27\n2025-01-03'} spellCheck={false} autoComplete="off" data-testid="lh-imp-text" />
        </label>
        {done && <p className="lh-imp-ok" role="status" data-testid="lh-imp-ok">{done}</p>}
        {!done && count > 0 && (
          <p className="lh-imp-sum" role="status" data-testid="lh-imp-sum">
            Found {plural(count, 'day')} and {plural(p.workouts, 'workout')}, {longDate(dates[0])} to {longDate(dates[count - 1])}.
          </p>
        )}
        {p.bad.length > 0 && <p className="lh-imp-bad">Skipped {plural(p.bad.length, 'date')} that {p.bad.length === 1 ? 'isn’t a real day or is' : 'aren’t real days or are'} in the future: {p.bad.slice(0, 3).join(', ')}{p.bad.length > 3 ? '…' : ''}</p>}
        {imported > 0 && <p className="lf-meta">{plural(imported, 'day')} added so far.</p>}
      </div>
    </Sheet>
  );
}
