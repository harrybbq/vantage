/**
 * The lift list under Today (brief §3.8, A12).
 *
 * ONE panel of 64 px rows on every screen (two columns on a wide one).
 * Lifts with no sets are grouped into a single "3 not logged yet ▸" row
 * that expands to compact rows with a [+] each — never the same empty
 * sentence on every card. A fresh account (no sets anywhere) shows one
 * explainer + Quick log instead. A search box finds a lift by name.
 * Desktop adds filter chips [All] [Machines] [Free], a sort (Recent ·
 * A–Z · Your order) and ⚙ Manage. (Until Nov 2026 desktop drew a 296 ×
 * 132 card for every lift, logged or not: 37 cards to find one.)
 * Archived lifts are hidden (Manage lists them).
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import LiftCard from './LiftCard';
import { Button, Chip, Segmented, useInputMode } from './ui';
import { groupLifts } from '../../../lib/lifts/home';
import { perGymOf, LOAD_LABEL } from '../../../lib/lifts/lifts';

const FILTERS = [['all', 'All'], ['machines', 'Machines'], ['free', 'Free']];
const SORTS = [{ value: 'recent', label: 'Recent' }, { value: 'az', label: 'A–Z' }, { value: 'order', label: 'Your order' }];

export default function LiftList({
  list, summaries, counts, today, activeGym, gymOrder, gymName, bwOf, pbsMonth = 0, onOpen, onLog, onQuickLog, onManage,
}) {
  const { layout } = useInputMode();
  const desktop = layout === 'desktop';
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [showEmpty, setShowEmpty] = useState(false);
  const [q, setQ] = useState('');
  const inUse = useMemo(() => list.filter(l => !l.archived), [list]);
  const { logged, empty } = useMemo(() => groupLifts(inUse, id => counts.get(id) || 0), [inUse, counts]);
  const fresh = inUse.length > 0 && logged.length === 0;

  // One list on every screen (Nov 2026): the lifts with sets, as rows; the rest wait in one
  // "not logged yet" group. Desktop used to draw a card for every lift, logged or not.
  const needle = q.trim().toLowerCase();
  const match = l => !needle || l.name.toLowerCase().includes(needle);
  const kind = l => !desktop || filter === 'all' || (filter === 'machines') === perGymOf(l);
  const shown = useMemo(() => {
    let out = logged.filter(l => kind(l) && match(l));
    const lastOf = l => { const s = summaries.get(l.id); return s && s.last ? s.last.date : ''; };
    if (desktop && sort === 'az') out = out.slice().sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'recent' || !desktop) out = out.slice().sort((a, b) => (lastOf(b) > lastOf(a) ? 1 : lastOf(b) < lastOf(a) ? -1 : 0));
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, logged, filter, sort, summaries, needle]);
  const idle = empty.filter(l => kind(l) && match(l));

  const row = (l, variant = 'row') => (
    <LiftCard key={l.id} s={summaries.get(l.id)} today={today} activeGym={activeGym} gymOrder={gymOrder} gymName={gymName} bwOf={bwOf}
              onOpen={() => onOpen(l.id)} onLog={() => onLog(l.id)} variant={variant} />
  );

  return (
    <section className="lh-lifts" aria-labelledby="lh-lifts-h" data-testid="lh-lifts">
      <div className="lh-lifts-head">
        <p className="lf-eyebrow" id="lh-lifts-h">Lifts · {logged.length}{pbsMonth ? <span className="lh-pbs"> · ◆ {pbsMonth} {pbsMonth === 1 ? 'PB' : 'PBs'} this month</span> : null}</p>
        {!fresh && inUse.length > 6 && (
          <label className="lh-search">
            <Icon name="search" size={15} />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a lift" aria-label="Find a lift" data-testid="lh-search" />
          </label>
        )}
        {desktop && !fresh && (
          <div className="lh-lifts-tools">
            <div className="lh-filters" role="group" aria-label="Show">
              {FILTERS.map(([v, lbl]) => <Chip key={v} selected={filter === v} onClick={() => setFilter(v)}>{lbl}</Chip>)}
            </div>
            <Segmented label="Sort lifts" size="sm" options={SORTS} value={sort} onChange={setSort} testId="lh-sort" />
          </div>
        )}
      </div>

      {!inUse.length && (
        <div className="lh-card lh-explain">
          <p className="lf-body">No lifts in use. Add one in Manage lifts.</p>
          <Button variant="secondary" icon="settings" onClick={onManage}>Manage lifts</Button>
        </div>
      )}

      {fresh && (
        <div className="lh-card lh-explain" data-testid="lh-fresh">
          <p className="lf-body">Log a set and its PBs build themselves: heaviest, plus 1–12 rep maxes, from real sets only.</p>
          <p className="lf-meta">{inUse.length} lifts ready · {inUse.slice(0, 3).map(l => l.name).join(' · ')}{inUse.length > 3 ? ' …' : ''}</p>
          <Button variant="primary" icon="zap" onClick={onQuickLog} data-testid="lh-fresh-log">Quick log a set</Button>
        </div>
      )}

      {!fresh && inUse.length > 0 && (
        <ul className={`lh-panel${desktop ? ' is-wide' : ''}`} aria-label="Lifts">
          {shown.map(l => row(l))}
          {!shown.length && !idle.length && <li className="lh-nomatch lf-meta">No lift called “{q.trim()}”.</li>}
          {idle.length > 0 && (
            <li className="lh-emptygrp">
              <button type="button" className="lh-emptygrp-btn" aria-expanded={showEmpty} onClick={() => setShowEmpty(v => !v)} data-testid="lh-empty-toggle">
                <span>{idle.length} not logged yet</span>
                <Icon name={showEmpty ? 'chevron-down' : 'chevron-right'} size={16} />
              </button>
              {(showEmpty || (needle && !shown.length)) && (
                <ul className="lh-emptylist">
                  {idle.map(l => (
                    <li key={l.id} className="lh-erow">
                      <button type="button" className="lh-erow-main" onClick={() => onOpen(l.id)} aria-label={`Open ${l.name}, no sets yet`}>
                        <span className="lh-erow-name">{l.name}</span>
                        <span className="lh-load">{LOAD_LABEL[l.load] || 'Weight'}</span>
                      </button>
                      <button type="button" className="lh-logbtn" onClick={() => onLog(l.id)} aria-label={`Log a set of ${l.name}`}><Icon name="plus" size={18} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
