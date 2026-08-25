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

/* ── The opened pot ─────────────────────────────────────────────────── */
function PotDetail({ goal, d, colour, achievement, onOpenModal }) {
  const bars = useMemo(() => last12Months(goal), [goal]);
  const barMax = Math.max(...bars.map(Math.abs), 1);
  const avg = bars.reduce((s, v) => s + v, 0) / 12;
  const ledger = [...(goal.contributions || [])]
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, 5);

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
    <div className="sb-detail" style={{ '--pot': colour }}>
      <div
        className="sb-detail-head"
        style={goal.image ? { backgroundImage: `url("${String(goal.image).replace(/"/g, '%22')}")` } : undefined}
      >
        <div className="sb-detail-head-ink">
          <span className="sb-detail-icon" aria-hidden="true">{goal.icon || '💰'}</span>
          <span className="sb-detail-name">{goal.name}</span>
          <span className="sb-detail-pct">{Math.round(d.pct * 100)}%</span>
        </div>
      </div>

      {/* The status gets its own row and says WHY it says what it says —
          a badge reading "behind" with no number behind it is just a
          told-off with no instruction attached. */}
      <div className={`sb-detail-state is-${d.state}`}>
        <span className="sb-detail-lamp" aria-hidden="true" />
        <span className="sb-detail-state-label">{STATE_LABEL[d.state]}</span>
        <span className="sb-detail-state-why">
          {d.done ? 'Target met'
            : d.needed == null ? `${money(d.routed)}/mo going in`
            : `${money(d.needed)}/mo needed vs ${money(d.routed)} in`}
        </span>
      </div>

      <div className="sb-detail-body">
        <div className="sb-detail-nums">
          <span className="sb-detail-cur">{money(d.current)}</span>
          <span className="sb-detail-target">/ {money(d.target)}</span>
          <span className="sb-detail-gap">{money(d.left)} to go</span>
        </div>

        <div className="sb-detail-bar">
          <div className="sb-detail-bar-fill" style={{ width: `${d.pct * 100}%` }} />
          {d.pace != null && (
            <div className="sb-detail-bar-pace" style={{ left: `${d.pace * 100}%` }} aria-hidden="true" />
          )}
        </div>

        <div className="sb-detail-facts">
          {facts.map(f => (
            <div key={f.label} className="sb-fact">
              <div className="sb-fact-label">{f.label}</div>
              <div className={`sb-fact-value${f.tone ? ' is-' + f.tone : ''}`}>{f.value}</div>
              <div className="sb-fact-note">{f.note}</div>
            </div>
          ))}
        </div>

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

        <div className="sb-detail-actions">
          <button type="button" className="btn btn-primary btn-sm"
                  onClick={() => onOpenModal('addContributionModal:' + goal.id)}>
            + Contribution
          </button>
          <button type="button" className="btn btn-sm"
                  onClick={() => onOpenModal('editSavingsGoalModal:' + goal.id)}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── The board ──────────────────────────────────────────────────────── */
export default function SavingsBoard({ S, update, onOpenModal }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('pots');
  const [selId, setSelId] = useState(null);

  const goals = useMemo(() => S.savings || [], [S.savings]);
  const proj = S.projection || {};
  const items = useMemo(() => proj.items || [], [proj.items]);
  const accounts = useMemo(() => S.savingsAccounts || [], [S.savingsAccounts]);
  const horizon = proj.horizon || 12;

  const totals = useMemo(() => potTotals(goals, items), [goals, items]);
  const flow = useMemo(() => flowTotals(items), [items]);
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
    const withIdx = goals.map((g, i) => ({ g, i, d: derivePot(g, items) }));
    return withIdx.sort((a, b) => (a.d.done ? 1 : 0) - (b.d.done ? 1 : 0) || a.i - b.i);
  }, [goals, items]);

  const selected = ordered.find(x => x.g.id === selId) || ordered[0] || null;
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
    <div className="sb-pots-row">
      <div className="sb-panel sb-pots">
        <div className="sb-panel-head">
          <div>
            <h3 className="sb-panel-title">Pots</h3>
            <p className="sb-panel-sub">Each column fills as the pot does — the dashes are where it should be by now.</p>
          </div>
          <div className="sb-legend">
            <span><i className="is-ontrack" />on pace</span>
            <span><i className="is-behind" />behind</span>
            <span><i className="is-funded" />funded</span>
          </div>
        </div>
        {ordered.length ? (
          <div className="sb-vessels">
            {ordered.map(({ g, d }, i) => (
              <Vessel
                key={g.id} goal={g} d={d} colour={potColor(g, i)}
                selected={selected && selected.g.id === g.id}
                onSelect={() => setSelId(g.id)}
              />
            ))}
          </div>
        ) : (
          <div className="sb-none">No pots yet — add one to start tracking a target.</div>
        )}
        <button type="button" className="sb-add-pot" onClick={() => onOpenModal('addSavingsGoalModal')}>
          <Icon name="plus" size={14} /> New goal
        </button>
      </div>

      {selected && (
        <PotDetail
          goal={selected.g}
          d={selected.d}
          colour={potColor(selected.g, ordered.indexOf(selected))}
          achievement={selected.g.achievementId
            ? (S.achievements || []).find(a => a.id === selected.g.achievementId)
            : null}
          onOpenModal={onOpenModal}
        />
      )}
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
