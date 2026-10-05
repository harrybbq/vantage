/**
 * Books → Bills: the recurring costs (hosting, AI, the developer
 * programmes) that would otherwise be typed in every month. Each bill
 * has a cadence and a next due date; "Post due bills" turns every bill
 * due up to today into a ledger entry (source 'recurring') and rolls
 * its date forward. Posting is idempotent on the server — one entry per
 * bill per due date — so pressing it twice books nothing twice.
 *
 * Stopping a bill marks it inactive; it stays listed (and restartable)
 * and nothing it already posted changes.
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { useBooks } from './useBooks';
import { booksAction } from './api';
import { BooksGate, Money, Field } from './parts';
import { CURRENCIES } from './EntrySheet';
import { Sheet, Updated } from '../security/parts';
import { toPence, fmtGBP, fmtMoney } from '../../../lib/books/money';
import { validateRecurring } from '../../../lib/books/recurring';
import { categoriesFor, categoryLabel, dateLabel, isoOf, readBills } from '../../../lib/upgrade/booksView';

const daysTo = (iso, today) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);

export default function BillsPanel() {
  const today = isoOf();
  const list = useBooks('recurring');
  const [sheet, setSheet] = useState(null);
  const [post, setPost] = useState(null);       // { busy } | { msg } | { error }

  const bills = useMemo(() => {
    const raw = list.res && list.res.state === 'ok' ? readBills(list.res.data) : [];
    return [...raw].sort((a, b) => (b.active !== false) - (a.active !== false) || String(a.next_due).localeCompare(String(b.next_due)));
  }, [list.res]);
  const active = bills.filter(b => b.active !== false);
  const due = active.filter(b => b.next_due && b.next_due <= today);
  // In GBP: a foreign bill counts at the GBP value it posts with.
  const gbpOf = b => ((b.currency || 'GBP') === 'GBP' ? Number(b.amount_pence) || 0 : Number(b.gbp_pence) || 0);
  const monthly = active.filter(b => b.kind !== 'income')
    .reduce((s, b) => s + (b.cadence === 'yearly' ? gbpOf(b) / 12 : gbpOf(b)), 0);

  const postDue = async () => {
    setPost({ busy: true });
    const out = await booksAction('recurring.post', { upTo: today });
    if (!out.ok) { setPost({ error: out.error }); return; }
    const d = out.data || {};
    const n = Number(d.posted) || 0;
    const already = Number(d.alreadyPosted) || 0;
    const stuck = Array.isArray(d.invalidBills) ? d.invalidBills.length : 0;
    setPost({
      msg: [n ? `Posted ${n} ${n === 1 ? 'entry' : 'entries'} to the ledger.` : 'Nothing new was due.',
        already ? `${already} had been posted already.` : '',
        stuck ? `${stuck} ${stuck === 1 ? 'bill needs' : 'bills need'} fixing first — open ${stuck === 1 ? 'it' : 'them'} and save.` : ''].filter(Boolean).join(' '),
    });
    list.reload();
  };

  const save = async b => {
    const out = sheet && sheet.id
      ? await booksAction('recurring.update', { id: sheet.id, patch: b })
      : await booksAction('recurring.add', { bill: b });
    if (!out.ok) return out;
    setSheet(null);
    list.reload();
    return out;
  };
  const stop = async b => {
    const out = await booksAction('recurring.delete', { id: b.id });
    if (!out.ok) return out;
    setSheet(null);
    list.reload();
    return out;
  };

  return (
    <div className="sec-pane">
      <div className="sec-bar">
        <span className="sec-eyebrow">// Recurring bills</span>
        <Updated at={list.updatedAt} loading={list.loading} onRefresh={list.reload} error={list.res && list.res.staleError} />
      </div>
      <BooksGate res={list.res}>
        {() => (
          <>
            <section className={`sec-card bk-billsum${due.length ? ' is-due' : ''}`}>
              <div className="bk-billsum-figs">
                <div><span>Bills a month</span><b><Money pence={Math.round(monthly)} /></b><em>yearly bills counted as ÷ 12</em></div>
                <div><span>Due now</span><b>{due.length}</b><em>{due.length ? `${fmtGBP(due.reduce((s, b) => s + gbpOf(b), 0))} to post` : 'all posted'}</em></div>
              </div>
              <div className="sec-acts">
                <button type="button" className="sec-btn is-primary bk-btn-lg" onClick={postDue} disabled={(post && post.busy) || !due.length}>
                  {post && post.busy ? 'Posting…' : `Post due bills${due.length ? ` (${due.length})` : ''}`}
                </button>
                <button type="button" className="sec-btn bk-btn-lg" onClick={() => setSheet({})}><Icon name="plus" size={14} /> Add bill</button>
              </div>
              {post && (post.msg || post.error) && (
                <div className={post.error ? 'sec-note is-bad' : 'sec-fine'} role="status">{post.error || post.msg}</div>
              )}
            </section>
            {bills.length ? (
              <ul className="bk-bills">
                {bills.map(b => {
                  const off = b.active === false;
                  const d = b.next_due ? daysTo(b.next_due, today) : null;
                  const when = off ? 'Stopped' : d == null ? 'No date' : d < 0 ? `Due ${-d} d ago` : d === 0 ? 'Due today' : `In ${d} d`;
                  return (
                    <li key={b.id}>
                      <button type="button" className={`bk-bill${off ? ' is-off' : ''}${!off && d != null && d <= 0 ? ' is-due' : ''}`} onClick={() => setSheet(b)}
                              aria-label={`${b.name}, ${fmtGBP(b.amount_pence)} ${b.cadence}, ${when}. Edit`}>
                        <span className="bk-bill-main">
                          <span className="bk-row-title">{b.name}</span>
                          <span className="bk-row-sub">
                            <span className="bk-chip">{categoryLabel(b.kind || 'expense', b.category)}</span>
                            <span className="bk-chip">{b.cadence === 'yearly' ? 'Yearly' : 'Monthly'}</span>
                            {b.next_due && !off && <span className="bk-row-who">next {dateLabel(b.next_due)}</span>}
                          </span>
                        </span>
                        <span className="bk-bill-side">
                          <b>{fmtMoney(b.amount_pence, b.currency || 'GBP')}</b>
                          <span className={`bk-when${!off && d != null && d <= 0 ? ' is-due' : ''}`}>{when}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="sec-nodata"><b>No bills yet</b><span>Add the monthly and yearly costs once; Books posts them when they fall due.</span></div>
            )}
          </>
        )}
      </BooksGate>
      {sheet && <BillSheet bill={sheet.id ? sheet : null} onClose={() => setSheet(null)} onSave={save} onStop={stop} today={today} />}
    </div>
  );
}

function BillSheet({ bill, onClose, onSave, onStop, today }) {
  const editing = !!bill;
  const [f, setF] = useState(() => ({
    name: bill ? bill.name || '' : '', kind: bill ? bill.kind || 'expense' : 'expense', category: bill ? bill.category || '' : '',
    amount: bill && Number.isInteger(bill.amount_pence) ? (bill.amount_pence / 100).toFixed(2) : '',
    gbp: bill && Number.isInteger(bill.gbp_pence) ? (bill.gbp_pence / 100).toFixed(2) : '',
    currency: bill ? bill.currency || 'GBP' : 'GBP', cadence: bill ? bill.cadence || 'monthly' : 'monthly',
    next_due: bill ? bill.next_due || today : today, active: bill ? bill.active !== false : true, note: bill ? bill.note || '' : '',
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(null);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const cats = categoriesFor(f.kind);

  // The library's validateRecurring — the same rules the server applies.
  const FIELD = { amount_pence: 'amount', gbp_pence: 'gbp' };
  const submit = async e => {
    e.preventDefault();
    const amount = toPence(f.amount);
    const gbp = f.currency === 'GBP' ? null : toPence(f.gbp);
    const bill = {
      name: f.name.trim(), kind: f.kind, category: f.category, amount_pence: amount == null ? null : Math.abs(amount),
      currency: f.currency, gbp_pence: gbp == null ? null : Math.abs(gbp),
      cadence: f.cadence, next_due: f.next_due, active: f.active, note: f.note.trim() || null,
    };
    const v = validateRecurring(bill);
    const errs = Object.fromEntries(Object.entries(v.errors).map(([k, m]) => [FIELD[k] || k, m]));
    setErrors(errs);
    if (!v.ok) {
      const el = document.getElementById(`bk-b-${Object.keys(errs)[0]}`);
      if (el) el.focus();
      return;
    }
    setBusy(true); setFail(null);
    const out = await onSave(bill);
    setBusy(false);
    if (out && out.ok === false) {
      if (out.errors) setErrors(Object.fromEntries(Object.entries(out.errors).map(([k, m]) => [FIELD[k] || k, m])));
      setFail(out.error);
    }
  };

  return (
    <Sheet title={editing ? 'Edit bill' : 'Add bill'} eyebrow="// Recurring" onClose={onClose} className="books">
      <form className="bk-form" onSubmit={submit} noValidate>
        <div className="bk-grid">
          <Field label="Name" id="bk-b-name" error={errors.name} wide>
            <input id="bk-b-name" value={f.name} maxLength={80} placeholder="e.g. Database plan" onChange={e => set('name', e.target.value)} />
          </Field>
          <Field label="Kind" id="bk-b-kind">
            <select id="bk-b-kind" value={f.kind} onChange={e => { set('kind', e.target.value); set('category', ''); }}>
              <option value="expense">Cost</option><option value="income">Income</option>
            </select>
          </Field>
          <Field label="Category" id="bk-b-category" error={errors.category}>
            <select id="bk-b-category" value={f.category} onChange={e => set('category', e.target.value)}>
              <option value="">Choose…</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Amount" id="bk-b-amount" error={errors.amount}>
            <input id="bk-b-amount" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={e => set('amount', e.target.value)} />
          </Field>
          <Field label="Currency" id="bk-b-cur">
            <select id="bk-b-cur" value={f.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {f.currency !== 'GBP' && (
            <Field label="Value in GBP" id="bk-b-gbp" error={errors.gbp} wide hint="What it costs in pounds — the figure each posting books.">
              <input id="bk-b-gbp" inputMode="decimal" placeholder="0.00" value={f.gbp} onChange={e => set('gbp', e.target.value)} />
            </Field>
          )}
          <Field label="Every" id="bk-b-cad">
            <select id="bk-b-cad" value={f.cadence} onChange={e => set('cadence', e.target.value)}>
              <option value="monthly">Month</option><option value="yearly">Year</option>
            </select>
          </Field>
          <Field label="Next due" id="bk-b-next_due" error={errors.next_due}>
            <input id="bk-b-next_due" type="date" value={f.next_due} onChange={e => set('next_due', e.target.value)} />
          </Field>
          <Field label="Note" id="bk-b-note" wide>
            <textarea id="bk-b-note" rows={2} value={f.note} maxLength={500} onChange={e => set('note', e.target.value)} />
          </Field>
          {editing && (
            <label className="bk-check is-wide">
              <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} />
              <span>Active — posts when due</span>
            </label>
          )}
        </div>
        {fail && <div className="sec-note is-bad" role="alert">{fail}</div>}
        <div className="bk-form-acts">
          <button type="submit" className="sec-btn is-primary bk-btn-lg" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save bill' : 'Add bill'}</button>
          <button type="button" className="sec-btn is-quiet bk-btn-lg" onClick={onClose}>Cancel</button>
          {editing && bill.active !== false && (
            <button type="button" className="sec-btn is-bad bk-btn-lg bk-del" disabled={busy}
                    onClick={async () => { setBusy(true); const o = await onStop(bill); setBusy(false); if (o && o.ok === false) setFail(o.error); }}>
              Stop bill
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
