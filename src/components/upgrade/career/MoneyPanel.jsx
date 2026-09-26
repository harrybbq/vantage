/**
 * Career → Money: the savings projection, the four house scenarios, the
 * cheaper route and the post-purchase budget.
 *
 * Nothing on this panel is typed in as an answer except the inputs: the
 * month each scenario becomes affordable, the keys month, the adjusted
 * dates without the bonus are all derived (lib/career/money), so moving
 * one input moves every date that depends on it.
 *
 * ── Actual vs plan ──
 * The third line is what the savings page actually holds: month-end
 * snapshots (S.savingsHistory, stamped whenever a balance changes — see
 * lib/savings/history) and today's live total. Which accounts count is
 * `career.money.actualAccountIds` (empty = all), set with the checkboxes
 * under the inputs. The account balances come from the user's own state,
 * which is already theirs; only the plan is owner content.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import JsonDrawer from './JsonDrawer';
import { Field } from '../UpgSheet';
import { KEYS } from '../../../lib/career/schema';
import {
  cashNeeded, firstMonthAtLeast, monthLabel, project, readiness, budgetSummary, isMonth,
} from '../../../lib/career/money';
import { actualSeries, versusPlan } from '../../../lib/savings/history';
import { balanceNow } from '../../../lib/savings/interest';

export const gbp = n => (n == null || !Number.isFinite(n) ? '—' : '£' + Math.round(n).toLocaleString('en-GB'));
export const gbpK = n => (n == null || !Number.isFinite(n) ? '—' : `£${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`);

export default function MoneyPanel({ oc, S = {}, scenarioId, setScenarioId, isMobile }) {
  const money = oc.data[KEYS.money];
  const [editing, setEditing] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const until = money.until || '2027-12';
  const withB = useMemo(() => project(money, { to: until, bonus: true }), [money, until]);
  const noB = useMemo(() => project(money, { to: until, bonus: false }), [money, until]);
  const rows = useMemo(() => (money.scenarios || []).map(sc => ({ sc, r: readiness(money, sc) })), [money]);
  const sel = rows.find(x => x.sc.id === scenarioId) || rows[0];
  const actual = useMemo(() => actualSeries(S, { from: money.start?.month, accountIds: money.actualAccountIds || [] }),
    [S, money.start, money.actualAccountIds]);
  const vs = useMemo(() => versusPlan(actual, noB), [actual, noB]);
  // The headline is the last CLOSED month: comparing today's balance to
  // this month's END target reads as "behind" every month until payday.
  const closed = [...vs].reverse().find(v => !v.live) || null;
  const live = vs.find(v => v.live) || null;
  const subset = (money.actualAccountIds || []).length > 0;

  return (
    <div className="cp">
      <header className="cp-head">
        <div>
          <span className="cp-eyebrow">// house &amp; money</span>
          <h3 className="cp-title">Cash needed vs. cash projected</h3>
        </div>
        <button type="button" className="upg-textbtn cp-edit" onClick={() => setEditing(true)}>Edit data</button>
      </header>

      <Inputs oc={oc} money={money} accounts={S.savingsAccounts || []} />

      <ActualVsPlan closed={closed} live={live} actual={actual} subset={subset} hasAccounts={(S.savingsAccounts || []).length > 0} />

      <section className="cp-card">
        <div className="cp-card-head">
          <span className="cp-eyebrow">// month-end balance</span>
          <div className="cp-key" aria-hidden="true">
            <span><i className="is-a" />With bonus</span>
            <span><i className="is-b" />Without</span>
            {actual.length > 0 && <span><i className="is-c" />Actual</span>}
          </div>
          <button type="button" className="upg-textbtn" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}>
            {showTable ? 'Chart' : 'Table'}
          </button>
        </div>
        {showTable ? (
          <div className="cp-table-wrap">
            <table className="cp-mini is-num">
              <thead><tr><th>Month</th><th>With bonus</th><th>Without</th><th>Actual</th><th>vs plan</th><th>In that month</th></tr></thead>
              <tbody>
                {withB.map((p, i) => {
                  const a = actual.find(x => x.month === p.month);
                  const d = vs.find(x => x.month === p.month);
                  return (
                    <tr key={p.month}>
                      <td>{monthLabel(p.month)}</td><td>{gbp(p.balance)}</td><td>{gbp(noB[i]?.balance)}</td>
                      <td>{a ? gbp(a.balance) + (a.live ? ' (today)' : '') : '—'}</td>
                      <td className={d ? (d.diff < 0 ? 'is-bad' : 'is-good') : ''}>{d ? (d.diff >= 0 ? '+' : '−') + gbp(Math.abs(d.diff)) : '—'}</td>
                      <td>{p.inflow ? '+' + gbp(p.inflow) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <SavingsChart withB={withB} noB={noB} actual={actual} rows={rows} selId={sel?.sc.id} compact={isMobile} />
        )}
      </section>

      <section className="cp-card">
        <span className="cp-eyebrow">// scenarios · tap one to anchor the timeline</span>
        <div className="cp-table-wrap">
          <table className="cp-scen">
            <thead>
              <tr><th>Scenario</th><th>Cash needed</th><th>Ready to offer</th><th>Keys ≈</th></tr>
            </thead>
            <tbody>
              {rows.map(({ sc, r }) => (
                <tr key={sc.id} className={sel?.sc.id === sc.id ? 'is-sel' : ''} onClick={() => setScenarioId(sc.id)}
                    tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setScenarioId(sc.id); } }}
                    aria-selected={sel?.sc.id === sc.id}>
                  <td>
                    <b>{sc.label}</b>
                    <span className="cp-sub">{gbpK(sc.price)} bid · {gbpK(sc.valuation ?? sc.price)} valuation · {Math.round((sc.ltv ?? money.ltvDefault ?? 0.9) * 100)}% LTV</span>
                  </td>
                  <td>
                    <b>{gbpK(r.need.total)}</b>
                    <span className="cp-sub">{gbpK(r.need.deposit)} dep · {gbp(r.need.lbtt)} LBTT · {gbpK(r.need.legal)} legal · {gbpK(r.need.buffer)} buffer</span>
                  </td>
                  <td>
                    <b>{monthLabel(r.ready) || 'not by ' + monthLabel(until)}</b>
                    {r.readyBonus && r.readyBonus !== r.ready && <span className="cp-sub">{monthLabel(r.readyBonus)} with bonus</span>}
                  </td>
                  <td>
                    <b className={r.afterContract ? 'is-bad' : ''}>{monthLabel(r.keys) || '—'}{r.afterContract ? ' ⚠' : ''}</b>
                    {r.keysBonus && r.keysBonus !== r.keys && <span className="cp-sub">{monthLabel(r.keysBonus)} with bonus</span>}
                    {r.afterContract && <span className="cp-sub is-bad">after the contract ends ({monthLabel(money.contractEnd)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="upg-fine">
          Cash needed = price − LTV × min(price, valuation) + LBTT (first-time buyer) + legal + buffer.
          Keys ≈ ready + {money.keysLagMonths ?? 2} months.
        </div>
      </section>

      <div className="cp-two">
        <Cheaper money={money} series={withB} />
        <Budget money={money} />
      </div>

      {editing && (
        <JsonDrawer title="Edit money" contentKey={KEYS.money} value={money}
                    onSave={v => oc.save(KEYS.money, v)} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/* ── Editable projection inputs ──────────────────────────────────────── */

function Inputs({ oc, money, accounts }) {
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState('');
  const d = draft || money;
  const dirty = !!draft;
  const set = patch => { setDraft({ ...d, ...patch }); setMsg(''); };
  const num = v => (v === '' ? '' : Number(v));

  async function save() {
    const r = await oc.save(KEYS.money, d);
    if (r.ok) { setDraft(null); setMsg('Saved'); } else setMsg(r.message);
  }

  return (
    <details className="cp-card cp-inputs">
      <summary>
        <span className="cp-eyebrow">// projection inputs</span>
        <span className="cp-sub">
          {gbp(money.start?.balance)} at end {monthLabel(money.start?.month)} ·{' '}
          {(money.transfers || []).map(t => `${gbp(t.monthly)}/mo from ${monthLabel(t.from)}`).join(' · ')}
        </span>
      </summary>
      <div className="cp-inputs-grid">
        <Field label="Start balance (£)">
          <input type="number" inputMode="decimal" value={d.start?.balance ?? ''} onChange={e => set({ start: { ...d.start, balance: num(e.target.value) } })} />
        </Field>
        <Field label="At the end of (YYYY-MM)">
          <input value={d.start?.month ?? ''} onChange={e => set({ start: { ...d.start, month: e.target.value } })} />
        </Field>
        {(d.transfers || []).map((t, i) => (
          <Field key={i} label={`${t.label || 'Transfer'} — £/mo from ${t.from}${t.to ? ` to ${t.to}` : ''}`}>
            <input type="number" inputMode="decimal" value={t.monthly ?? ''}
                   onChange={e => set({ transfers: d.transfers.map((x, j) => (j === i ? { ...x, monthly: num(e.target.value) } : x)) })} />
          </Field>
        ))}
        {(d.oneOffs || []).map((o, i) => (
          <Field key={'o' + i} label={`${o.label || 'One-off'} (${o.month})${o.bonus ? ' · bonus' : ''}`}>
            <input type="number" inputMode="decimal" value={o.amount ?? ''}
                   onChange={e => set({ oneOffs: d.oneOffs.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)) })} />
          </Field>
        ))}
        <Field label="Legal (£)"><input type="number" value={d.legal ?? ''} onChange={e => set({ legal: num(e.target.value) })} /></Field>
        <Field label="Emergency buffer (£)"><input type="number" value={d.buffer ?? ''} onChange={e => set({ buffer: num(e.target.value) })} /></Field>
        <Field label="Keys after ready (months)"><input type="number" value={d.keysLagMonths ?? ''} onChange={e => set({ keysLagMonths: num(e.target.value) })} /></Field>
        <Field label="Contract ends (YYYY-MM)"><input value={d.contractEnd ?? ''} onChange={e => set({ contractEnd: e.target.value })} /></Field>
      </div>
      {accounts.length > 0 && (
        <fieldset className="cp-accts">
          <legend className="upg-field-lbl">Accounts counted in “Actual” (none ticked = all)</legend>
          {accounts.map(a => {
            const ids = d.actualAccountIds || [];
            const on = ids.includes(a.id);
            return (
              <label key={a.id} className="cp-acct">
                <input type="checkbox" checked={on}
                       onChange={() => set({ actualAccountIds: on ? ids.filter(x => x !== a.id) : [...ids, a.id] })} />
                <span>{a.name || 'Unnamed account'}</span>
                <em>{gbp(balanceNow(a))}</em>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="cp-inputs-foot">
        <span className="upg-fine">Scenarios, dates and labels: Edit data.</span>
        {msg && <span className={`upg-fine${msg === 'Saved' ? '' : ' is-bad'}`} role="status">{msg}</span>}
        {dirty && <button type="button" className="upg-textbtn" onClick={() => { setDraft(null); setMsg(''); }}>Discard</button>}
        <button type="button" className="link-open-btn" disabled={!dirty || !isMonth(d.start?.month)} onClick={save}>Save inputs</button>
      </div>
    </details>
  );
}

/* ── Chart ───────────────────────────────────────────────────────────── */

/**
 * Two series (with / without the bonus) on one axis, with each scenario's
 * cash-needed drawn as a reference line and a marker where each series
 * first reaches it. Blue/orange are the validated categorical pair for
 * both themes; "without" is also dashed, so identity is never colour
 * alone, and both are labelled at the line end. Hover: a crosshair and a
 * tooltip with both balances.
 */
function SavingsChart({ withB, noB, actual = [], rows, selId, compact }) {
  const wrap = useRef(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 640));
    ro.observe(el);
    setW(el.clientWidth || 640);
    return () => ro.disconnect();
  }, []);

  const H = compact ? 230 : 270;
  const pad = { l: 46, r: compact ? 14 : 92, t: 12, b: 26 };
  const n = withB.length;
  const all = [...withB, ...noB, ...actual].map(p => p.balance).concat(rows.map(x => x.r.need.total));
  const lo = Math.floor(Math.min(...all) / 5000) * 5000;
  const hi = Math.ceil(Math.max(...all) / 5000) * 5000;
  const x = i => pad.l + (n > 1 ? (i / (n - 1)) * (w - pad.l - pad.r) : 0);
  const y = v => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = s => s.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
  const ticks = [];
  for (let v = lo; v <= hi; v += 5000) ticks.push(v);
  const idxOf = m => withB.findIndex(p => p.month === m);
  // Actual points sit on the same month axis; months before the plan's
  // start are dropped (the plan cannot say anything about them).
  const act = actual.map(p => ({ ...p, i: idxOf(p.month) })).filter(p => p.i >= 0);
  const actPath = act.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / (w - pad.l - pad.r)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  }

  const labelEvery = n > 12 ? (compact ? 4 : 2) : 1;
  const hv = hover != null ? { m: withB[hover], a: withB[hover].balance, b: noB[hover]?.balance, c: act.find(p => p.i === hover) } : null;
  const affordable = hv ? rows.filter(x => hv.a >= x.r.need.total).length : 0;

  return (
    <div className="cp-chart" ref={wrap}>
      <svg width={w} height={H} role="img" aria-label="Projected month-end savings with and without the bonus, against each scenario's cash needed"
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map(v => (
          <g key={v}>
            <line className="cp-grid" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
            <text className="cp-axis" x={pad.l - 6} y={y(v) + 3} textAnchor="end">{gbpK(v)}</text>
          </g>
        ))}
        {withB.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={p.month} className="cp-axis" x={x(i)} y={H - 8} textAnchor="middle">{monthLabel(p.month)}</text>
        ))}

        {rows.map(({ sc, r }) => (
          <g key={sc.id} className={`cp-ref${sc.id === selId ? ' is-sel' : ''}`}>
            <line x1={pad.l} x2={w - pad.r} y1={y(r.need.total)} y2={y(r.need.total)} />
            <text x={pad.l + 4} y={y(r.need.total) - 4}>{gbpK(r.need.total)}{sc.id === selId ? ` · ${sc.label}` : ''}</text>
          </g>
        ))}

        <path className="cp-line is-b" d={path(noB)} />
        <path className="cp-line is-a" d={path(withB)} />
        {act.length > 1 && <path className="cp-line is-c" d={actPath} />}
        {act.map(p => (
          <circle key={p.month} className={`cp-dot is-c${p.live ? ' is-live' : ''}`} cx={x(p.i)} cy={y(p.balance)} r={p.live ? 5 : 4} />
        ))}

        {rows.map(({ sc, r }) => {
          const ia = idxOf(r.readyBonus), ib = idxOf(r.ready);
          return (
            <g key={sc.id + 'm'}>
              {ib >= 0 && <circle className="cp-dot is-b" cx={x(ib)} cy={y(noB[ib].balance)} r={4.5} />}
              {ia >= 0 && <circle className="cp-dot is-a" cx={x(ia)} cy={y(withB[ia].balance)} r={4.5} />}
            </g>
          );
        })}

        {!compact && (
          <>
            <text className="cp-end is-a" x={w - pad.r + 6} y={y(withB[n - 1].balance) + 3}>With bonus</text>
            <text className="cp-end is-b" x={w - pad.r + 6} y={y(noB[n - 1].balance) + 14}>Without</text>
          </>
        )}
        {act.length > 0 && (
          <text className="cp-end" x={Math.min(x(act[act.length - 1].i) + 8, w - 60)} y={y(act[act.length - 1].balance) + 16}>
            {act[act.length - 1].live ? 'Actual · today' : 'Actual'}
          </text>
        )}

        {hv && (
          <line className="cp-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
        )}
      </svg>
      {hv && (
        <div className="cp-tip" style={{ left: Math.min(Math.max(x(hover) + 10, 0), w - 180), top: 8 }} role="status">
          <b>{monthLabel(hv.m.month)}</b>
          <span><i className="is-a" />With bonus {gbp(hv.a)}</span>
          <span><i className="is-b" />Without {gbp(hv.b)}</span>
          {hv.c && <span><i className="is-c" />Actual {gbp(hv.c.balance)}{hv.c.live ? ' (today)' : ''}</span>}
          <span className="cp-sub">{affordable}/{rows.length} scenarios affordable</span>
        </div>
      )}
    </div>
  );
}

/* ── Cheaper route & budget ──────────────────────────────────────────── */

function Cheaper({ money, series }) {
  const c = money.cheaper;
  if (!c) return null;
  const lo = cashNeeded({ price: c.from, valuation: c.from }, money);
  const hi = cashNeeded({ price: c.to, valuation: c.to }, money);
  const when = firstMonthAtLeast(series, hi.total);
  return (
    <section className="cp-card">
      <span className="cp-eyebrow">// cheaper route</span>
      <h4 className="cp-h4">{gbpK(c.from)}–{gbpK(c.to)} at valuation</h4>
      <dl className="cp-dl">
        <dt>Cash needed</dt><dd>{gbpK(lo.total)}–{gbpK(hi.total)}</dd>
        <dt>Covered at the top of the range</dt><dd>{monthLabel(when) || '—'}</dd>
        <dt>Offer</dt><dd>{c.offer}</dd>
        <dt>Keys</dt><dd>{c.keys}</dd>
      </dl>
    </section>
  );
}

function Budget({ money }) {
  const b = budgetSummary(money);
  const lines = (money.budget && money.budget.lines) || [];
  if (!lines.length) return null;
  return (
    <section className="cp-card">
      <span className="cp-eyebrow">// after purchase · {gbpK(money.budget.price)}</span>
      <h4 className="cp-h4">Monthly</h4>
      <dl className="cp-dl">
        {lines.map(l => (
          <FragmentRow key={l.label} k={l.label} v={l.low != null && l.low !== l.high ? `${gbp(l.low)}–${gbp(l.high)}` : `~${gbp(l.high ?? l.low)}`} />
        ))}
        <dt>Leaves</dt><dd><b>~{gbp(b.left)}</b>/mo</dd>
        {b.leftWithBonus != null && <><dt>With the bonus</dt><dd><b>~{gbp(b.leftWithBonus)}</b>/mo</dd></>}
      </dl>
    </section>
  );
}
const FragmentRow = ({ k, v }) => <><dt>{k}</dt><dd>{v}</dd></>;

/**
 * Where the savings stand against the plan: the last month-end we have a
 * snapshot for, and how far this month still has to go.
 */
function ActualVsPlan({ closed, live, actual, subset, hasAccounts }) {
  if (!hasAccounts) {
    return <div className="upg-fine">Add your accounts on the Savings page and an “Actual” line appears here against the plan.</div>;
  }
  if (!closed && !live) {
    return <div className="upg-fine">Actual balances start from the plan’s first month; nothing to compare yet.</div>;
  }
  const ahead = closed ? closed.diff >= 0 : true;
  const toGo = live ? live.planned - live.actual : null;
  return (
    <div className={`cp-vs${closed ? (ahead ? ' is-ahead' : ' is-behind') : ''}`}>
      {closed ? (
        <>
          <span className="cp-eyebrow">// actual vs plan · end of {monthLabel(closed.month)}</span>
          <b>{ahead ? '+' : '−'}{gbp(Math.abs(closed.diff))}</b>
          <span>{ahead ? 'ahead of' : 'behind'} the no-bonus plan — {gbp(closed.actual)} against {gbp(closed.planned)}.</span>
        </>
      ) : (
        <span className="cp-eyebrow">// actual vs plan</span>
      )}
      {live && (
        <span className="cp-vs-live">
          {monthLabel(live.month)} so far: {gbp(live.actual)} —{' '}
          {toGo > 0 ? <>{gbp(toGo)} to go to the plan’s month-end {gbp(live.planned)}</> : <>already {gbp(-toGo)} past the plan’s month-end {gbp(live.planned)}</>}.
        </span>
      )}
      {subset && closed && <span className="cp-sub">Earlier months are all-account totals; only today counts just the ticked accounts.</span>}
      {actual.length < 2 && <span className="cp-sub">A month-end point is saved each time a balance changes on the Savings page, so the line grows from here.</span>}
    </div>
  );
}
