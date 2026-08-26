/**
 * The savings board.
 *
 * Three surfaces over the same state: the POTS (each one a vessel that
 * fills, with a dashed line showing where it ought to be by now), the
 * PROJECTION (cash and savings out to a horizon, fed by an editable
 * cash flow), and the ACCOUNTS behind the savings line.
 *
 * Desktop shows all three down one page; a phone shows one at a time
 * under a sub-tab. Both read the same derivations from
 * src/lib/savings/derive.js, so they cannot disagree about a number.
 *
 * The Goals / Savings toggle above this is the achievement section's own
 * and is deliberately untouched — this component is only ever what the
 * Savings side renders.
 *
 * Privacy rule, unchanged from the list this replaces: this is the only
 * place £ amounts are rendered. The coach snapshot, public_stats and
 * anything a friend can see get counts and names, never balances.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { useIsMobile } from '../../hooks/useIsMobile';
import ProjectionChart from './ProjectionChart';
import FlowEditor from './FlowEditor';
import AccountsPanel from './AccountsPanel';
import {
  derivePot, last12Months, potTotals, flowTotals,
  cashSeries, savingsSeries, money, potColor, monthLabel,
} from '../../lib/savings/derive';

const HORIZONS = [{ m: 12, label: '1y' }, { m: 24, label: '2y' }, { m: 60, label: '5y' }];

const STATE_LABEL = {
  funded: 'Funded in full',
  behind: 'Behind pace',
  ontrack: 'On pace',
  open: 'No target date',
};
const STATE_SHORT = { funded: 'funded', behind: 'behind', ontrack: 'on pace', open: 'open' };

function fmtDate(d) {
  return d ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—';
}

/* ── One pot, as a vessel that fills ────────────────────────────────── */
function Vessel({ goal, d, colour, selected, onSelect }) {
  const pct = Math.round(d.pct * 100);
  return (
    <button
      type="button"
      className={`sb-vessel${selected ? ' is-sel' : ''} is-${d.state}`}
      style={{ '--pot': colour }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${goal.name}, ${pct}% of ${money(d.target)}, ${STATE_SHORT[d.state]}`}
    >
      <div className="sb-vessel-tube">
        <div className="sb-vessel-fill" style={{ height: `${Math.max(2, d.pct * 100)}%` }}>
          <span className="sb-vessel-meniscus" aria-hidden="true" />
        </div>
        {/* Where the pot should be by now, given how long it has had.
            Without a target date there is no such line to draw. */}
        {d.pace != null && (
          <div className="sb-vessel-pace" style={{ bottom: `${d.pace * 100}%` }} aria-hidden="true" />
        )}
        <div className={`sb-vessel-pct${d.pct > 0.78 ? ' is-over' : ''}`}>{pct}%</div>
        <div className={`sb-vessel-amt${d.pct > 0.14 ? ' is-over' : ''}`}>{money(d.current)}</div>
      </div>
      <div className="sb-vessel-name">
        <span className="sb-vessel-icon" aria-hidden="true">{goal.icon || '💰'}</span>
        <span className="sb-vessel-label">{goal.name}</span>
      </div>
      <div className="sb-vessel-state">
        {d.done ? 'funded'
          : d.etaMonths != null ? `lands in ${d.etaMonths} mo`
          : STATE_SHORT[d.state]}
      </div>
    </button>
  );
}

/* ── The opened pot, in the slot the vessel had ─────────────────────── */
/**
 * Two depths. SUMMARY answers "how is it going" in the width of roughly
 * two vessels: the tube, the numbers, the status and what it needs. EXPAND
 * stretches the card across the whole row for the rest — the facts grid,
 * a year of contributions, the ledger and which accounts feed it.
 *
 * The split exists because the summary has to fit beside its neighbours.
 * Everything the old side panel showed is still here, one click deeper.
 */
function PotCard({ goal, d, colour, expanded, onToggleExpand, onCollapse, achievement, onOpenModal }) {
  const bars = useMemo(() => (expanded ? last12Months(goal) : []), [goal, expanded]);
  const barMax = Math.max(...bars.map(Math.abs), 1);
  const avg = bars.reduce((s, v) => s + v, 0) / 12;
  const ledger = expanded
    ? [...(goal.contributions || [])]
        .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
        .slice(0, 5)
    : [];

  const facts = [
    {
      label: 'Target date',
      value: fmtDate(d.targetDate),
      note: d.monthsLeft != null ? `${Math.round(d.monthsLeft)} months out` : 'no date set',
    },
    {
      label: 'Needs /mo',
      value: d.done || d.needed == null ? '—' : money(d.needed),
      note: d.done ? 'target met' : d.needed == null ? 'set a date' : 'to hit the date',
      tone: d.needed != null && !d.done && d.needed > d.routed ? 'bad' : 'good',
    },
    {
      label: 'Routed now',
      value: `${money(d.routed)}/mo`,
      note: d.routed ? 'from cash flow' : 'not linked',
    },
    {
      label: 'Lands in',
      value: d.done ? 'done' : d.etaMonths != null ? `${d.etaMonths} mo` : '—',
      note: d.etaMonths != null ? 'at this rate' : 'route money in',
      tone: 'gold',
    },
  ];

  return (
    <div className={`sb-potcard is-${d.state}${expanded ? ' is-expanded' : ''}`} style={{ '--pot': colour }}>
      <div className="sb-potcard-top">
        <div className="sb-potcard-tube" aria-hidden="true">
          <div className="sb-vessel-fill" style={{ height: `${Math.max(2, d.pct * 100)}%` }}>
            <span className="sb-vessel-meniscus" />
          </div>
          {d.pace != null && <div className="sb-vessel-pace" style={{ bottom: `${d.pace * 100}%` }} />}
        </div>

        <div className="sb-potcard-body">
          <div className="sb-potcard-head">
            <span className="sb-potcard-icon" aria-hidden="true">{goal.icon || '💰'}</span>
            <span className="sb-potcard-name">{goal.name}</span>
            <button type="button" className="sb-potcard-close" onClick={onCollapse} aria-label="Close this pot">
              <Icon name="x" size={14} />
            </button>
          </div>

          <div className="sb-potcard-nums">
            <span className="sb-potcard-pct">{Math.round(d.pct * 100)}%</span>
            <span className="sb-potcard-cur">{money(d.current)}</span>
            <span className="sb-potcard-target">/ {money(d.target)}</span>
          </div>

          <div className="sb-detail-bar">
            <div className="sb-detail-bar-fill" style={{ width: `${d.pct * 100}%` }} />
            {d.pace != null && <div className="sb-detail-bar-pace" style={{ left: `${d.pace * 100}%` }} />}
          </div>

          <div className={`sb-potcard-state is-${d.state}`}>
            <span className="sb-detail-lamp" aria-hidden="true" />
            <span className="sb-detail-state-label">{STATE_LABEL[d.state]}</span>
            <span className="sb-potcard-why">
              {d.done ? `${money(d.left)} to go`
                : d.needed == null ? `${money(d.routed)}/mo going in`
                : `${money(d.needed)}/mo needed vs ${money(d.routed)} in`}
            </span>
          </div>

          <div className="sb-potcard-actions">
            <button type="button" className="sb-potcard-expand" onClick={onToggleExpand} aria-expanded={expanded}>
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} />
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <button type="button" className="btn btn-primary btn-sm"
                    onClick={() => onOpenModal('addContributionModal:' + goal.id)}>+ Contribution</button>
            <button type="button" className="btn btn-sm"
                    onClick={() => onOpenModal('editSavingsGoalModal:' + goal.id)}>Edit</button>
          </div>
        </div>

        {expanded && (
          <div className="sb-detail-facts sb-potcard-factcol">
            {facts.map(f => (
              <div key={f.label} className="sb-fact">
                <div className="sb-fact-label">{f.label}</div>
                <div className={`sb-fact-value${f.tone ? ' is-' + f.tone : ''}`}>{f.value}</div>
                <div className="sb-fact-note">{f.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="sb-potcard-more">
          {/* Where the money actually sits. A pot spread across an ISA and
              an instant saver is still one pot, and this is the only place
              that says which accounts are carrying it. */}
          {d.accounts.length > 0 && (
            <div className="sb-potcard-accounts">
              <div className="sb-detail-eyebrow">Held in</div>
              <div className="sb-potcard-acclist">
                {d.accounts.map(a => (
                  <span key={a.id} className="sb-potcard-acc">
                    {a.name || 'Account'}
                    <b>{money(parseFloat(a.balance) || 0)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {achievement && (
            <div className="sb-detail-link">
              ✦ Completes <strong>{achievement.name}</strong> when it hits target
            </div>
          )}

          <div className="sb-detail-eyebrow">Last 12 months in</div>
          <div className="sb-bars">
            {bars.map((v, i) => (
              <div
                key={i}
                className={`sb-bar${v < 0 ? ' is-neg' : ''}${i === 11 ? ' is-now' : ''}`}
                style={{ height: `${Math.max(3, Math.abs(v) / barMax * 100)}%` }}
                title={`${monthLabel(i - 11)}: ${money(v)}`}
              />
            ))}
          </div>
          <div className="sb-bars-axis">
            <span>{monthLabel(-11)}</span>
            <span>avg {money(avg)}/mo</span>
            <span>now</span>
          </div>

          {ledger.length > 0 ? (
            <ul className="sb-ledger">
              {ledger.map(c => (
                <li key={c.id}>
                  <span className={`sb-ledger-amt${c.amount < 0 ? ' is-neg' : ''}`}>
                    {c.amount > 0 ? '+' : ''}{money(c.amount, { pence: true })}
                  </span>
                  <span className="sb-ledger-note">{c.note || 'Contribution'}</span>
                  <span className="sb-ledger-date">
                    {new Date(c.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sb-ledger-empty">No contributions logged yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── The board ──────────────────────────────────────────────────────── */
export default function SavingsBoard({ S, update, onOpenModal }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('pots');
  const [selId, setSelId] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const goals = useMemo(() => S.savings || [], [S.savings]);
  const proj = S.projection || {};
  const items = useMemo(() => proj.items || [], [proj.items]);
  const accounts = useMemo(() => S.savingsAccounts || [], [S.savingsAccounts]);
  const horizon = proj.horizon || 12;

  const totals = useMemo(() => potTotals(goals, items, accounts), [goals, items, accounts]);
  const flow = useMemo(() => flowTotals(items, goals, accounts), [items, goals, accounts]);
  /* Unset means "whatever is in the pots" rather than zero — carried
     over from the planner this replaces, where a blank field otherwise
     drew a cash line starting at the floor for everyone who had never
     opened it. */
  const hasCustomStart = proj.startBalance != null && proj.startBalance !== '';
  const startBalance = hasCustomStart ? proj.startBalance : totals.saved;
  const cash = useMemo(() => cashSeries(startBalance, items, horizon), [startBalance, items, horizon]);
  const sav = useMemo(() => savingsSeries(accounts, items, horizon), [accounts, items, horizon]);

  // Funded pots sink to the end; otherwise the order is the user's own.
  const ordered = useMemo(() => {
    const withIdx = goals.map((g, i) => ({ g, i, d: derivePot(g, items, accounts) }));
    return withIdx.sort((a, b) => (a.d.done ? 1 : 0) - (b.d.done ? 1 : 0) || a.i - b.i);
  }, [goals, items, accounts]);

  const selected = selId ? ordered.find(x => x.g.id === selId) || null : null;
  const setHorizon = m => update(prev => ({
    ...prev,
    projection: { items: [], groups: [], startBalance: '', ...prev.projection, horizon: m },
  }));

  if (!goals.length && !items.length && !accounts.length) {
    return (
      <div className="savings-empty">
        <div className="savings-empty-icon"><Icon name="piggy-bank" size={30} strokeWidth={1.5} /></div>
        <div className="savings-empty-title">No savings goals yet</div>
        <p className="savings-empty-body">
          Track named goals — First Home, Wedding, Emergency Fund. Give one a target
          date and it will tell you what it needs each month; route money into it from
          your cash flow and it will tell you when it lands.
        </p>
        <button type="button" className="btn btn-primary"
                onClick={() => onOpenModal('addSavingsGoalModal')}>+ New Goal</button>
      </div>
    );
  }

  const headline = (
    <div className="sb-headline">
      <div className="sb-headline-total">
        <div className="sb-eyebrow">Total in pots</div>
        <div className="sb-headline-nums">
          <span className="sb-headline-saved">{money(totals.saved)}</span>
          <span className="sb-headline-of">of {money(totals.target)}</span>
        </div>
        <div className="sb-headline-bar">
          <div className="sb-headline-bar-fill" style={{ width: `${totals.pct * 100}%` }} />
        </div>
        <div className="sb-headline-foot">
          <span>{Math.round(totals.pct * 100)}% of all targets</span>
          <span>{totals.count} pots · {totals.doneCount} complete</span>
        </div>
      </div>
      <div className="sb-stat">
        <div className="sb-eyebrow">Into pots /mo</div>
        <div className="sb-stat-val is-good">{money(totals.routed)}</div>
        <div className="sb-stat-note">{money(flow.income)} in · {money(flow.net)} left over</div>
      </div>
      <div className="sb-stat">
        <div className="sb-eyebrow">Next lands</div>
        <div className="sb-stat-val is-gold">{totals.next ? `${totals.next.months} mo` : '—'}</div>
        <div className="sb-stat-note">{totals.next ? totals.next.goal.name : 'route money into a pot'}</div>
      </div>
      <div className="sb-stat">
        <div className="sb-eyebrow">Off pace</div>
        <div className={`sb-stat-val${totals.behind ? ' is-bad' : ' is-good'}`}>
          {totals.behind ? `${totals.behind} pot${totals.behind > 1 ? 's' : ''}` : 'none'}
        </div>
        <div className="sb-stat-note">{totals.behind ? 'short of where they should be' : 'every dated pot is on pace'}</div>
      </div>
    </div>
  );

  const potsSurface = (
    <div className="sb-panel sb-pots">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-panel-title">Pots</h3>
          <p className="sb-panel-sub">
            Each column fills as the pot does — the dashes are where it should be by now.
            Click one to open it where it stands.
          </p>
        </div>
        <div className="sb-legend">
          <span><i className="is-ontrack" />on pace</span>
          <span><i className="is-behind" />behind</span>
          <span><i className="is-funded" />funded</span>
        </div>
      </div>
      {ordered.length ? (
        /* The opened pot takes over its own slot rather than a panel off
           to one side, so the thing you clicked is the thing that
           changed. Expanded it takes the whole row and the rest wrap
           beneath it — which is why this is a wrapping flex row and not
           a grid of fixed tracks. */
        <div className={`sb-vessels${expanded ? ' is-expanded' : ''}`}>
          {ordered.map(({ g, d }, i) => (
            selected && selected.g.id === g.id ? (
              <PotCard
                key={g.id} goal={g} d={d} colour={potColor(g, i)}
                expanded={expanded}
                onToggleExpand={() => setExpanded(e => !e)}
                onCollapse={() => { setSelId(null); setExpanded(false); }}
                achievement={g.achievementId
                  ? (S.achievements || []).find(a => a.id === g.achievementId)
                  : null}
                onOpenModal={onOpenModal}
              />
            ) : (
              <Vessel
                key={g.id} goal={g} d={d} colour={potColor(g, i)}
                selected={false}
                onSelect={() => { setSelId(g.id); setExpanded(false); }}
              />
            )
          ))}
        </div>
      ) : (
        <div className="sb-none">No pots yet — add one to start tracking a target.</div>
      )}
      <button type="button" className="sb-add-pot" onClick={() => onOpenModal('addSavingsGoalModal')}>
        <Icon name="plus" size={14} /> New goal
      </button>
    </div>
  );

  const chartEl = (
    <ProjectionChart
      cash={cash} sav={sav} horizon={horizon}
      marks={totals.derived
        .filter(x => !x.d.done && x.d.etaMonths != null && x.d.etaMonths <= horizon)
        .map(x => ({ m: x.d.etaMonths, label: x.goal.icon || '●', name: x.goal.name }))}
      horizons={HORIZONS} onHorizon={setHorizon}
      startBalance={proj.startBalance}
      startPlaceholder={String(Math.round(totals.saved))}
      onStartBalance={v => update(prev => ({
        ...prev,
        projection: { items: [], groups: [], horizon: 12, ...prev.projection, startBalance: v },
      }))}
    />
  );

  const flowEl = <FlowEditor S={S} update={update} flow={flow} />;

  const accountsSurface = (
    <AccountsPanel S={S} update={update} sav={sav} horizon={horizon} items={items} />
  );

  if (isMobile) {
    return (
      <div className="sb sb-mobile">
        <div className="sb-subtabs" role="tablist">
          {[['pots', 'Pots'], ['proj', 'Projection'], ['acc', 'Accounts']].map(([id, label]) => (
            <button
              key={id} type="button" role="tab" aria-selected={tab === id}
              className={`sb-subtab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >{label}</button>
          ))}
        </div>
        {tab === 'pots' && <>{headline}{potsSurface}</>}
        {tab === 'proj' && <>{chartEl}{flowEl}</>}
        {tab === 'acc' && accountsSurface}
      </div>
    );
  }

  /* Cash flow and accounts share a row rather than each spanning the
     page. Full width, a flow row's label field grew to ~660px and threw
     its own amount to the far side of the screen — the eye had to travel
     the whole width to read one row. */
  return (
    <div className="sb">
      {headline}
      {potsSurface}
      {chartEl}
      <div className="sb-bottom-row">
        {flowEl}
        {accountsSurface}
      </div>
    </div>
  );
}
