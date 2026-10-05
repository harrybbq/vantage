/**
 * Add / edit one ledger entry in the console's side sheet (a bottom
 * sheet on a phone, height-capped with its own scroll). Validation is
 * the pure library's validateEntry — the same rules the server applies —
 * shown under each field; the first bad field takes focus on Save.
 * Delete is soft (the row is marked, never removed) and the ledger
 * offers Undo for five seconds.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../security/parts';
import { Field } from './parts';
import { toPence, fmtGBP } from '../../../lib/books/money';
import { validateEntry, normaliseEntry } from '../../../lib/books/ledger';
import { categoriesFor, categoryLabel, isoOf, SOURCE_LABEL } from '../../../lib/upgrade/booksView';

export const CURRENCIES = ['GBP', 'USD', 'EUR'];
const KINDS = [['expense', 'Cost'], ['income', 'Income'], ['transfer', 'Transfer']];
const ORDER = ['occurred_on', 'kind', 'category', 'amount_pence', 'gbp_pence'];

const penceText = p => (Number.isInteger(p) ? (p / 100).toFixed(2) : '');

function fromEntry(e) {
  if (!e) return { occurred_on: isoOf(), kind: 'expense', category: '', amount: '', currency: 'GBP', gbp: '', counterparty: '', description: '', note: '' };
  return {
    occurred_on: e.occurred_on || isoOf(), kind: e.kind || 'expense', category: e.category || '',
    amount: penceText(e.amount_pence), currency: e.currency || 'GBP',
    gbp: e.currency && e.currency !== 'GBP' ? penceText(e.gbp_pence) : '',
    counterparty: e.counterparty || '', description: e.description || '', note: e.note || '',
  };
}

export default function EntrySheet({ entry, onClose, onSave, onDelete }) {
  const editing = !!(entry && entry.id);
  const [f, setF] = useState(() => fromEntry(entry));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(null);
  const form = useRef(null);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const cats = useMemo(() => categoriesFor(f.kind), [f.kind]);

  // A kind change drops a category that doesn't belong to it.
  useEffect(() => {
    if (f.category && !cats.some(c => c.id === f.category)) setF(s => ({ ...s, category: '' }));
  }, [cats, f.category]);

  const build = () => {
    const amount = toPence(f.amount);
    const gbp = f.currency === 'GBP' ? amount : toPence(f.gbp);
    const raw = {
      occurred_on: f.occurred_on, kind: f.kind, category: f.category,
      amount_pence: amount == null ? null : Math.abs(amount), currency: f.currency,
      gbp_pence: gbp == null ? null : Math.abs(gbp),
      fx_rate: f.currency !== 'GBP' && amount && gbp ? Math.round((Math.abs(gbp) / Math.abs(amount)) * 1e6) / 1e6 : null,
      counterparty: f.counterparty, description: f.description, note: f.note,
      source: editing ? entry.source : 'manual',
      source_ref: editing ? entry.source_ref : null,
    };
    return normaliseEntry(raw);
  };

  const submit = async ev => {
    ev.preventDefault();
    setFail(null);
    const e = build();
    const v = validateEntry(e);
    setErrors(v.errors || {});
    if (!v.ok) {
      const first = ORDER.find(k => v.errors[k]) || Object.keys(v.errors)[0];
      const el = form.current && form.current.querySelector(`[data-field="${first}"]`);
      if (el) el.focus();
      return;
    }
    setBusy(true);
    const out = await onSave(e);
    setBusy(false);
    if (out && out.ok === false) {
      if (out.errors) setErrors(out.errors);
      setFail(out.error || 'Could not save that.');
    }
  };

  const id = k => `bk-e-${k}`;
  const amountP = toPence(f.amount);

  return (
    <Sheet title={editing ? 'Edit entry' : 'Add entry'} eyebrow={editing ? `// ${SOURCE_LABEL[entry.source] || 'Manual'} entry` : '// Ledger'} onClose={onClose} className="books">
      <form ref={form} className="bk-form" onSubmit={submit} noValidate>
        <div className="bk-kinds" role="radiogroup" aria-label="Kind">
          {KINDS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} data-field={k === f.kind ? 'kind' : undefined}
                    className={`bk-kindbtn is-${k}${f.kind === k ? ' is-on' : ''}`} onClick={() => set('kind', k)}>
              <i aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        {errors.kind && <span className="bk-field-err" role="alert">{errors.kind}</span>}
        <div className="bk-grid">
          <Field label="Date" id={id('date')} error={errors.occurred_on}>
            <input id={id('date')} data-field="occurred_on" type="date" value={f.occurred_on} onChange={e => set('occurred_on', e.target.value)} required />
          </Field>
          <Field label="Category" id={id('cat')} error={errors.category}>
            <select id={id('cat')} data-field="category" value={f.category} onChange={e => set('category', e.target.value)}>
              <option value="">Choose…</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              {f.category && !cats.some(c => c.id === f.category) && <option value={f.category}>{categoryLabel(f.kind, f.category)}</option>}
            </select>
          </Field>
          <Field label="Amount" id={id('amt')} error={errors.amount_pence}
                 hint={amountP != null && f.amount ? fmtGBP(Math.abs(amountP)).replace('£', f.currency === 'GBP' ? '£' : `${f.currency} `) : null}>
            <input id={id('amt')} data-field="amount_pence" inputMode="decimal" autoComplete="off" placeholder="0.00"
                   value={f.amount} onChange={e => set('amount', e.target.value)} />
          </Field>
          <Field label="Currency" id={id('cur')}>
            <select id={id('cur')} value={f.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          {f.currency !== 'GBP' && (
            <Field label="Value in GBP" id={id('gbp')} error={errors.gbp_pence} wide
                   hint="What landed or left in pounds — reports use this figure.">
              <input id={id('gbp')} data-field="gbp_pence" inputMode="decimal" autoComplete="off" placeholder="0.00"
                     value={f.gbp} onChange={e => set('gbp', e.target.value)} />
            </Field>
          )}
          <Field label="Who" id={id('who')} wide>
            <input id={id('who')} value={f.counterparty} maxLength={120} placeholder="e.g. hosting provider"
                   onChange={e => set('counterparty', e.target.value)} />
          </Field>
          <Field label="Description" id={id('desc')} wide>
            <input id={id('desc')} value={f.description} maxLength={240} onChange={e => set('description', e.target.value)} />
          </Field>
          <Field label="Note" id={id('note')} wide>
            <textarea id={id('note')} rows={2} value={f.note} maxLength={1000} onChange={e => set('note', e.target.value)} />
          </Field>
        </div>
        {fail && <div className="sec-note is-bad" role="alert">{fail}</div>}
        <div className="bk-form-acts">
          <button type="submit" className="sec-btn is-primary bk-btn-lg" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add entry'}</button>
          <button type="button" className="sec-btn is-quiet bk-btn-lg" onClick={onClose}>Cancel</button>
          {editing && onDelete && (
            <button type="button" className="sec-btn is-bad bk-btn-lg bk-del" disabled={busy} onClick={() => onDelete(entry)}>Delete</button>
          )}
        </div>
        {editing && entry.source && entry.source !== 'manual' && (
          <p className="sec-fine">Imported from {SOURCE_LABEL[entry.source] || entry.source}{entry.source_ref ? ` · ref ${entry.source_ref}` : ''}. Re-importing the same file won’t duplicate it.</p>
        )}
      </form>
    </Sheet>
  );
}
