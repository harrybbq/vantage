/**
 * "Last month, did this actually happen?"
 *
 * The cash flow already says what moves every month. Asking the user to
 * type those same amounts into each pot's ledger, every month, is
 * asking for data the app was given months ago — and the realistic
 * outcome is that nobody does it and every pot reads as behind.
 *
 * So once a month, when the previous month is complete, this offers the
 * month as the plan describes it and takes one tap for the whole thing.
 *
 * ── Why it asks ──────────────────────────────────────────────────────
 * Vantage has no bank connection and no purchase history, so it cannot
 * know the money moved — only what was planned. A savings figure that
 * grew on its own would be wrong in the direction the user wants to
 * believe, which is the worst direction for a number to be wrong in. The
 * rows are editable and droppable before anything is written, and
 * "nothing moved" is a first-class answer rather than a way of ignoring
 * the card.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { money } from '../../lib/savings/derive';
import {
  duePlanMonth, proposePlanPosts, applyPlanPosts, skipPlanMonth, monthLabel,
} from '../../lib/savings/planPost';

export default function PlanPostCard({ S, update }) {
  const month = duePlanMonth(S);
  const proposed = useMemo(() => (month ? proposePlanPosts(S, month) : []), [S, month]);

  // Local until confirmed. `edits` holds only what the user changed, so
  // a fresh proposal (a flow row edited while the card is open) is not
  // silently overwritten by a stale copy of itself.
  const [edits, setEdits] = useState({});
  const [dropped, setDropped] = useState({});

  if (!month || !proposed.length) return null;

  const rows = proposed
    .filter(r => !dropped[r.itemId])
    .map(r => ({ ...r, amount: edits[r.itemId] !== undefined ? edits[r.itemId] : r.amount }));
  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const label = monthLabel(month);

  return (
    <div className="sb-panel pp-card">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-panel-title">{label} — post it?</h3>
          <p className="sb-panel-sub">
            This is what your cash flow says moved last month. Confirm it and it lands on
            the pots and accounts below; change an amount first if it was different.
          </p>
        </div>
        <div className="pp-total">
          <span className="sb-eyebrow">Total</span>
          <strong>{money(total)}</strong>
        </div>
      </div>

      <div className="pp-rows">
        {proposed.map(r => {
          const off = !!dropped[r.itemId];
          const value = edits[r.itemId] !== undefined ? edits[r.itemId] : r.amount;
          return (
            <div key={r.itemId} className={`pp-row${off ? ' is-off' : ''}`}>
              <button
                type="button"
                className="pp-check"
                aria-pressed={!off}
                aria-label={off ? `Include ${r.label}` : `Leave out ${r.label}`}
                onClick={() => setDropped(d => ({ ...d, [r.itemId]: !off }))}
              >
                {off ? '' : <Icon name="check" size={12} />}
              </button>
              <div className="pp-row-main">
                <span className="pp-row-label">{r.label}</span>
                <span className="pp-row-dest">
                  {/* Where it lands, said plainly — a row aimed at an
                      account that belongs to a pot moves both, and that
                      is not obvious from the flow row alone. */}
                  {r.goalName && r.accountName
                    ? <>→ {r.accountName} · counts towards {r.goalName}</>
                    : r.goalName ? <>→ {r.goalName}</>
                    : <>→ {r.accountName}</>}
                </span>
              </div>
              <div className="pp-amt">
                <span>£</span>
                <input
                  type="number" inputMode="decimal" min="0" step="0.01"
                  value={value}
                  disabled={off}
                  aria-label={`Amount for ${r.label}`}
                  onChange={e => setEdits(x => ({ ...x, [r.itemId]: e.target.value }))}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="pp-actions">
        <button
          type="button" className="btn btn-ghost"
          onClick={() => update(prev => skipPlanMonth(prev, month))}
        >Nothing moved</button>
        <button
          type="button" className="btn btn-primary"
          disabled={!rows.length || !(total > 0)}
          onClick={() => update(prev => applyPlanPosts(prev, month, rows))}
        >Confirm {money(total)}</button>
      </div>
    </div>
  );
}
