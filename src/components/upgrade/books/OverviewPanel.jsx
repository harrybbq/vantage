/**
 * Books → Overview: what came in, what went out, what's left. A period
 * selector (this month · last month · this year · last year · custom),
 * four tiles (Revenue, Costs, Profit or loss, Monthly running cost), the
 * income-vs-costs chart, costs by category, and RevenueCat's live
 * numbers when that key is set — information only, never booked (income
 * is booked from store reports and the bank, so it is never counted twice).
 *
 * One request per period: the period widened back to twelve months
 * (fetchWindow) so the chart and the running cost need nothing more.
 * The client does the sums with the pure library (src/lib/books/).
 */
import { useMemo, useState } from 'react';
import { useBooks } from './useBooks';
import { BooksGate, Money } from './parts';
import BooksChart from './BooksChart';
import { CardHead, Tile, Updated, NoData } from '../security/parts';
import { summarise } from '../../../lib/books/reports';
import { fmtGBP } from '../../../lib/books/money';
import {
  PERIODS, periodRange, fetchWindow, chartMonths, runningCost, runningRef, categoryRows,
  readOverview, monthLabel, fmtMajor, isoOf,
} from '../../../lib/upgrade/booksView';

const KEY = 'vantage.upgrade.books.period';
function readPeriod() {
  try { const v = window.localStorage.getItem(KEY); return PERIODS.some(p => p.id === v) ? v : 'month'; } catch { return 'month'; }
}

export default function OverviewPanel({ go }) {
  const today = isoOf();
  const [pid, setPid] = useState(readPeriod);
  const [custom, setCustom] = useState(() => ({ from: `${today.slice(0, 4)}-01-01`, to: today }));
  const period = useMemo(() => periodRange(pid, today, custom), [pid, today, custom]);
  const win = useMemo(() => fetchWindow(period), [period]);
  const ov = useBooks('overview', { params: win });
  const rc = useBooks('revenuecat');

  const pick = id => {
    setPid(id);
    try { window.localStorage.setItem(KEY, id); } catch { /* private mode */ }
  };

  const toolbar = (
    <div className="sec-bar bk-bar">
      <div className="sec-seg bk-periods" role="group" aria-label="Period">
        {PERIODS.map(p => (
          <button key={p.id} type="button" className={pid === p.id ? 'is-on' : ''} aria-pressed={pid === p.id} onClick={() => pick(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {pid === 'custom' && (
        <div className="bk-range">
          <label><span className="sr-only">From</span>
            <input type="date" value={custom.from} max={custom.to} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} aria-label="From" />
          </label>
          <span aria-hidden="true">–</span>
          <label><span className="sr-only">To</span>
            <input type="date" value={custom.to} min={custom.from} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} aria-label="To" />
          </label>
        </div>
      )}
      <Updated at={ov.updatedAt} loading={ov.loading} onRefresh={() => { ov.reload(); rc.reload(); }} error={ov.res && ov.res.staleError} />
    </div>
  );

  return (
    <div className="sec-pane">
      {toolbar}
      <BooksGate res={ov.res}>
        {data => <Body data={data} period={period} today={today} rc={rc.res} go={go} />}
      </BooksGate>
    </div>
  );
}

function Body({ data, period, today, rc, go }) {
  const { entries } = readOverview(data);
  const sum = useMemo(() => summarise(entries, { from: period.from, to: period.to }), [entries, period]);
  const all = useMemo(() => summarise(entries, {}), [entries]);
  const rows = useMemo(() => chartMonths(all.byMonth, period), [all, period]);
  const ref = runningRef(period, today);
  const run = useMemo(() => runningCost(all.byMonth, ref), [all, ref]);
  const costs = useMemo(() => categoryRows(sum.byCategory, 'expense'), [sum]);
  const income = useMemo(() => categoryRows(sum.byCategory, 'income'), [sum]);
  const profit = sum.profitPence;
  const empty = !sum.incomePence && !sum.expensePence;
  const runSpan = `${monthLabel(run.months[0]).split(' ')[0]}–${monthLabel(run.months[2])}`;

  return (
    <>
      <div className="bk-period-line">
        <b>{period.label}</b>
        <span>{empty ? 'Nothing booked in this period.' : `${countIn(entries, period)} entries`}</span>
      </div>
      <div className="sec-tiles bk-tiles">
        <Tile label="Revenue" value={fmtGBP(sum.incomePence)} sub={income[0] ? `Most from ${income[0].label}` : 'No income booked'} />
        <Tile label="Costs" value={fmtGBP(sum.expensePence)} sub={costs[0] ? `Biggest: ${costs[0].label}` : 'No costs booked'} />
        <Tile label={profit >= 0 ? 'Profit' : 'Loss'} value={fmtGBP(Math.abs(profit))}
              tone={empty ? null : profit > 0 ? 'ok' : profit < 0 ? 'bad' : null}
              sub={sum.incomePence ? `Margin ${Math.round((profit / sum.incomePence) * 100)}%` : 'Revenue minus costs'} />
        <Tile label="Running cost" value={fmtGBP(run.pence)} of="/ month" sub={`Average of ${runSpan}`} />
      </div>

      <section className="sec-card">
        <CardHead eyebrow="// Month by month" title="Income vs costs" />
        <BooksChart rows={rows} />
      </section>

      <div className="sec-two is-wide-left">
        <section className="sec-card">
          <CardHead eyebrow="// Where it goes" title="Costs by category"
                    right={<button type="button" className="sec-link" onClick={() => go('ledger')}>Open ledger</button>} />
          {costs.length ? (
            <ul className="bk-cats">
              {costs.map(c => (
                <li key={c.id}>
                  <span className="bk-cat-name">{c.label}</span>
                  <span className="bk-cat-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, c.share * 100)}%` }} /></span>
                  <Money pence={c.pence} className="bk-cat-val" />
                  <span className="bk-cat-pct">{Math.round(c.share * 100)}%</span>
                </li>
              ))}
            </ul>
          ) : <NoData>No costs booked in this period.</NoData>}
        </section>
        <RevenueCatCard res={rc} />
      </div>
    </>
  );
}

function countIn(entries, period) {
  let n = 0;
  for (const e of entries) if (e && e.occurred_on >= period.from && e.occurred_on <= period.to) n++;
  return n.toLocaleString('en-GB');
}

const count = v => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-GB'));

function RevenueCatCard({ res }) {
  const ok = res && res.state === 'ok' ? res.data : null;
  return (
    <section className="sec-card bk-rc">
      <CardHead eyebrow="// Live · RevenueCat" title="Subscriptions now" />
      {!res ? (
        <div className="sec-skel-wrap" aria-busy="true"><div className="sec-skel" /><div className="sec-skel is-short" /></div>
      ) : ok ? (
        <>
          <div className="bk-rc-grid">
            <div><span>MRR</span><b>{fmtMajor(ok.mrr, ok.currency || 'GBP')}</b></div>
            <div><span>Active subs</span><b>{count(ok.activeSubscriptions)}</b></div>
            <div><span>Trials</span><b>{count(ok.activeTrials)}</b></div>
            <div><span>Revenue 28 d</span><b>{fmtMajor(ok.revenue28d, ok.currency || 'GBP')}</b></div>
          </div>
          <p className="sec-fine">Information only — not booked as income. Income comes from store reports and the bank, so it’s never counted twice.</p>
        </>
      ) : res.state === 'not_configured' || res.state === 'not-installed' ? (
        <div className="bk-rc-off">
          <p className="sec-p">Not connected. With a RevenueCat key in the Netlify function environment, MRR, active subscriptions and trials show here.</p>
          {res.hint && <p className="sec-fine">{res.hint}</p>}
        </div>
      ) : (
        <div className="sec-note is-warn">{res.error || res.hint || 'RevenueCat didn’t answer.'}</div>
      )}
    </section>
  );
}
