/**
 * Books → Ledger: every entry, newest first, a page at a time. Search
 * (description, who, note — on the server), kind chips, a category
 * filter and a date range; rows grouped by month. A row opens the
 * add/edit sheet; delete is soft with a five-second Undo. The same
 * date range drives "Export CSV" — the accountant's file for that span.
 *
 * A "Deleted" chip lists soft-deleted rows (?deleted=only); tapping one
 * restores it — nothing in Books is ever erased.
 *
 * Keyboard: every row is a button (Tab / Enter), the sheet closes on
 * Escape, Undo is reachable by Tab while the toast shows, and "/" jumps
 * to the search box.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import { useBooks } from './useBooks';
import { booksAction, downloadExport, fetchBooks } from './api';
import { BooksGate, Money, KindChip, SourceChip, UndoToast } from './parts';
import EntrySheet from './EntrySheet';
import { Updated, Calm } from '../security/parts';
import { CATEGORIES } from '../../../lib/books/categories';
import { fmtGBP } from '../../../lib/books/money';
import { categoryLabel, signedPence, dateLabel, monthLabel, readPage, isoOf } from '../../../lib/upgrade/booksView';

const PAGE = 60;
const KIND_CHIPS = [['', 'All'], ['income', 'Income'], ['expense', 'Costs'], ['transfer', 'Transfers']];
const DELETED = 'deleted';     // a chip of its own: soft-deleted rows, each restorable

function useDebounced(v, ms) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function LedgerPanel() {
  const today = isoOf();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const deleted = kind === DELETED;
  const params = useMemo(() => ({ q: dq, kind: deleted ? '' : kind, category, from, to, limit: PAGE, deleted: deleted ? 'only' : '' }),
    [dq, kind, deleted, category, from, to]);
  const list = useBooks('entries', { params });

  const [more, setMore] = useState({ rows: [], next: undefined, busy: false, error: null });
  const [hidden, setHidden] = useState(() => new Set());
  // A fresh answer is the truth: drop the extra pages and the optimistic hides.
  useEffect(() => { setMore({ rows: [], next: undefined, busy: false, error: null }); setHidden(new Set()); }, [list.res]);
  const [sheet, setSheet] = useState(null);         // null | {} (new) | entry
  const [toast, setToast] = useState(null);
  const [exp, setExp] = useState({ busy: false, msg: null });
  const search = useRef(null);

  useEffect(() => {
    const k = e => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
      e.preventDefault();
      if (search.current) search.current.focus();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const first = useMemo(() => (list.res && list.res.state === 'ok' ? readPage(list.res.data) : null), [list.res]);
  const next = more.next !== undefined ? more.next : first && first.next;
  const rows = useMemo(() => {
    const all = first ? [...first.entries, ...more.rows] : [];
    const seen = new Set();
    return all.filter(e => {
      if (!e || hidden.has(e.id)) return false;
      const k = e.id || e.source_ref;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [first, more.rows, hidden]);

  const loadMore = async () => {
    if (!next) return;
    setMore(m => ({ ...m, busy: true, error: null }));
    const out = await fetchBooks('entries', { ...params, before: next });
    if (out.state !== 'ok') { setMore(m => ({ ...m, busy: false, error: out.error || out.hint || 'Couldn’t load more.' })); return; }
    const page = readPage(out.data);
    setMore(m => ({ rows: [...m.rows, ...page.entries], next: page.next, busy: false, error: null }));
  };

  const save = async e => {
    const editing = sheet && sheet.id;
    const out = editing
      ? await booksAction('entry.update', { id: sheet.id, patch: e })
      : await booksAction('entry.add', { entry: e });
    if (!out.ok) return out;
    setSheet(null);
    setToast({ text: editing ? 'Entry saved' : 'Entry added', n: Date.now() });
    list.reload();
    return out;
  };

  const remove = async entry => {
    setSheet(null);
    setHidden(h => new Set(h).add(entry.id));
    const out = await booksAction('entry.delete', { id: entry.id });
    if (!out.ok) {
      setHidden(h => { const s = new Set(h); s.delete(entry.id); return s; });
      setToast({ text: out.error || 'Couldn’t delete that.', n: Date.now() });
      return;
    }
    setToast({ text: `Deleted ${entry.description || categoryLabel(entry.kind, entry.category)} · ${fmtGBP(entry.gbp_pence)}`, undo: entry, n: Date.now() });
  };

  const undo = async t => {
    const entry = t.undo;
    setToast(null);
    const out = await booksAction('entry.restore', { id: entry.id });
    if (!out.ok) { setToast({ text: out.error || 'Couldn’t restore it.', n: Date.now() }); return; }
    setHidden(h => { const s = new Set(h); s.delete(entry.id); return s; });
    setToast({ text: 'Restored', n: Date.now() });
  };
  const doneToast = useCallback(() => setToast(null), []);

  // In the Deleted view a row restores rather than edits.
  const restoreRow = async entry => {
    setHidden(h => new Set(h).add(entry.id));
    const out = await booksAction('entry.restore', { id: entry.id });
    if (!out.ok) {
      setHidden(h => { const s = new Set(h); s.delete(entry.id); return s; });
      setToast({ text: out.error || 'Couldn’t restore it.', n: Date.now() });
      return;
    }
    setToast({ text: `Restored ${entry.description || categoryLabel(entry.kind, entry.category)}`, n: Date.now() });
  };

  const doExport = async () => {
    setExp({ busy: true, msg: null });
    const out = await downloadExport({ from, to });
    setExp({ busy: false, msg: out.ok ? `Downloaded ${dateLabel(from)} – ${dateLabel(to)}` : out.error });
  };

  const cats = CATEGORIES[kind] || [...CATEGORIES.expense, ...CATEGORIES.income, ...CATEGORIES.transfer];
  const filtered = !!(dq || kind || category);

  return (
    <div className="sec-pane">
      <div className="sec-card bk-filters">
        <div className="bk-filter-row">
          <label className="bk-search">
            <Icon name="search" size={14} />
            <span className="sr-only">Search entries</span>
            <input ref={search} type="search" value={q} placeholder="Search description, who, note  ( / )" onChange={e => setQ(e.target.value)} />
          </label>
          <button type="button" className="sec-btn is-primary bk-btn-lg" onClick={() => setSheet({})}>
            <Icon name="plus" size={14} /> Add entry
          </button>
        </div>
        <div className="bk-filter-row">
          <div className="sec-chips" role="group" aria-label="Kind">
            {[...KIND_CHIPS, [DELETED, 'Deleted']].map(([k, label]) => (
              <button key={k || 'all'} type="button" className={`sec-chip bk-chip-btn${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k}
                      onClick={() => { setKind(k); setCategory(''); }}>{label}</button>
            ))}
          </div>
          <label className="bk-select">
            <span className="sr-only">Category</span>
            <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <div className="bk-range">
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="From" />
            <span aria-hidden="true">–</span>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="To" />
          </div>
          <button type="button" className="sec-btn bk-btn-lg" onClick={doExport} disabled={exp.busy || !from || !to}
                  title="The accountant’s CSV for this date range">
            <Icon name="download" size={14} /> {exp.busy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
        {exp.msg && <div className="sec-fine bk-exp-msg" role="status">{exp.msg}</div>}
      </div>

      <div className="sec-bar">
        <span className="sec-eyebrow">
          {first ? `${rows.length.toLocaleString('en-GB')}${next ? '+' : ''} ${rows.length === 1 ? 'entry' : 'entries'}${filtered ? ' · filtered' : ''}` : 'Entries'}
        </span>
        <Updated at={list.updatedAt} loading={list.loading} onRefresh={list.reload} error={list.res && list.res.staleError} />
      </div>

      <BooksGate res={list.res}>
        {() => (rows.length ? (
          <>
            {deleted && <p className="sec-fine">Deleted entries are kept, never erased. Tap one to put it back.</p>}
            <Rows rows={rows} onOpen={deleted ? restoreRow : setSheet} restore={deleted} />
            {next && (
              <button type="button" className="sec-btn bk-more bk-btn-lg" onClick={loadMore} disabled={more.busy}>
                {more.busy ? 'Loading…' : 'Load more'}
              </button>
            )}
            {more.error && <div className="sec-note is-bad">{more.error}</div>}
          </>
        ) : filtered
          ? <Calm>{deleted ? 'Nothing deleted in this range.' : 'Nothing matches these filters.'}</Calm>
          : <div className="sec-nodata"><b>No entries yet</b><span>Add one, or bring a bank statement or store report in from Import.</span></div>)}
      </BooksGate>

      {sheet && <EntrySheet entry={sheet.id ? sheet : null} onClose={() => setSheet(null)} onSave={save} onDelete={remove} />}
      <UndoToast toast={toast} onUndo={undo} onDone={doneToast} />
    </div>
  );
}

function Rows({ rows, onOpen, restore }) {
  const groups = [];
  for (const e of rows) {
    const m = String(e.occurred_on || '').slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.month !== m) { g = { month: m, rows: [], net: 0 }; groups.push(g); }
    g.rows.push(e);
    if (e.kind !== 'transfer') g.net += signedPence(e);
  }
  return (
    <div className="bk-ledger">
      {groups.map((g, i) => (
        <section key={`${g.month}:${i}`} className="bk-month" aria-label={g.month ? monthLabel(g.month, true) : 'Undated'}>
          <header className="bk-month-head">
            <span>{g.month ? monthLabel(g.month, true) : 'Undated'}</span>
            <span className="bk-month-net">net <Money pence={g.net} signed /></span>
          </header>
          <ul className="bk-rows">
            {g.rows.map(e => <Row key={e.id || e.source_ref} e={e} onOpen={onOpen} restore={restore} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ e, onOpen, restore }) {
  const title = e.description || e.counterparty || categoryLabel(e.kind, e.category);
  const cat = categoryLabel(e.kind, e.category);
  const foreign = e.currency && e.currency !== 'GBP';
  return (
    <li>
      <button type="button" className={`bk-row is-${e.kind}${restore ? ' is-deleted' : ''}`} onClick={() => onOpen(e)}
              aria-label={`${dateLabel(e.occurred_on)}, ${title}, ${cat}, ${e.kind === 'expense' ? 'out' : e.kind === 'income' ? 'in' : 'transfer'} ${fmtGBP(e.gbp_pence)}. ${restore ? 'Restore' : 'Edit'}`}>
        <span className="bk-row-date">{String(e.occurred_on || '').slice(8, 10)}<em>{monthLabel(String(e.occurred_on || '').slice(0, 7)).split(' ')[0]}</em></span>
        <span className="bk-row-main">
          <span className="bk-row-title">{title}</span>
          <span className="bk-row-sub">
            <KindChip kind={e.kind} />
            <span className="bk-chip">{cat}</span>
            <SourceChip source={e.source} />
            {e.counterparty && e.description && <span className="bk-row-who">{e.counterparty}</span>}
          </span>
        </span>
        <span className="bk-row-amt">
          <Money pence={e.kind === 'transfer' ? e.gbp_pence : signedPence(e)} signed={e.kind !== 'transfer'} />
          {foreign && <em>{e.currency} {(Number(e.amount_pence || 0) / 100).toFixed(2)}</em>}
          {restore && <span className="bk-restore">Restore</span>}
        </span>
      </button>
    </li>
  );
}
