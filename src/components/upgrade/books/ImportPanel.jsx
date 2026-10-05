/**
 * Books → Import: drop or pick a CSV, see what it is, check it against
 * the ledger, then commit. Nothing is written until Commit.
 *
 *   1. Read   parseCsv (tolerant: quotes, BOM, ; or tab); findHeaderRow
 *             skips report preamble; detectFormat on the headers — bank
 *             statement, App Store financial report, Google Play earnings,
 *             or Books' own export.
 *   2. Map    when the headers aren't recognised (or on request): pick the
 *             date, description and amount — or money-in / money-out —
 *             columns from the file's own headers (read as a bank file).
 *   3. Rates  foreign-currency rows arrive needs_fx; one GBP rate per
 *             currency (applyFx) — prefilled from the saved rates
 *             (prefs.fx) and remembered on commit. The server refuses a
 *             foreign row without a GBP value, so Commit waits for them.
 *   4. Check  POST import.preview → will add / duplicates / invalid, with
 *             reasons. De-dup is the server's (source, source_ref), so a
 *             re-import of the same file adds nothing.
 *   5. Commit POST import.commit with the rows to add, categories as
 *             edited here. Inserts are "on conflict do nothing".
 * `source` in both requests is the FORMAT name; requests carry at most
 * 2,000 rows, so a bigger file goes in parts (the answers are merged).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../Icon';
import { booksAction, fetchBooks } from './api';
import { Money, KindChip } from './parts';
import { CardHead } from '../security/parts';
import { parseCsv, detectFormat, findHeaderRow, toEntries, applyFx } from '../../../lib/books/importers';
import { fmtGBP, fmtMoney } from '../../../lib/books/money';
import {
  FORMAT_LABEL, currenciesNeedingRate, ratesFrom, chunks, mergePreviews, categoriesFor, categoryLabel, dateLabel, readPreview,
} from '../../../lib/upgrade/booksView';

const SHOW = 200;           // rows drawn per preview tab; the rest are counted
const MAX_BYTES = 5 * 1024 * 1024;
const TABS = [['add', 'Will add'], ['duplicates', 'Duplicates'], ['invalid', 'Invalid']];
const MAP_FIELDS = [
  ['date', 'Date', true], ['description', 'Description', true],
  ['amount', 'Amount (signed)', false], ['moneyIn', 'Money in', false], ['moneyOut', 'Money out', false],
];

export default function ImportPanel({ go }) {
  const [file, setFile] = useState(null);          // { name, rows: string[][], headers, headerAt }
  const [readErr, setReadErr] = useState(null);
  const [manual, setManual] = useState(false);
  const [mapping, setMapping] = useState({});
  const [rates, setRates] = useState({});          // currency → the text in its box
  const [prefs, setPrefs] = useState(null);        // saved prefs (fx rates), when the server has them
  const [cats, setCats] = useState({});            // source_ref → category override
  const [preview, setPreview] = useState(null);    // { state:'busy'|'ok'|'error', add?, duplicates?, invalid? }
  const [tab, setTab] = useState('add');
  const [commit, setCommit] = useState(null);      // { busy } | { ok, added, skipped } | { error }
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const seq = useRef(0);

  // Saved rates, read once (prefs.fx) — prefill only, the boxes stay editable.
  useEffect(() => {
    let live = true;
    fetchBooks('config').then(r => { if (live && r.state === 'ok' && r.data && r.data.prefs) setPrefs(r.data.prefs); });
    return () => { live = false; };
  }, []);

  const detected = file ? detectFormat(file.headers) : null;
  const useMapping = !!file && (manual || !detected);
  const mapReady = !useMapping || !!(mapping.date && mapping.description && (mapping.amount || (mapping.moneyIn && mapping.moneyOut)));

  const parsed = useMemo(() => {
    if (!file || !mapReady) return null;
    const out = useMapping ? toEntries(null, file.rows, { mapping }) : toEntries(detected, file.rows, {});
    return { ...out, source: out.format || 'bank-generic' };
  }, [file, mapReady, useMapping, mapping, detected]);

  const needRates = useMemo(() => (parsed ? currenciesNeedingRate(parsed.entries) : []), [parsed]);
  useEffect(() => {
    const saved = (prefs && prefs.fx) || {};
    if (!needRates.length) return;
    setRates(r => {
      const next = { ...r };
      for (const c of needRates) if (next[c] == null && saved[c]) next[c] = String(saved[c]);
      return next;
    });
  }, [needRates, prefs]);
  const fx = useMemo(() => ratesFrom(rates), [rates]);
  const rated = useMemo(() => (parsed ? applyFx(parsed.entries, fx) : []), [parsed, fx]);
  const missingRates = needRates.filter(c => !fx[c]);

  // Check against the ledger whenever what would be sent changes (debounced; never writes).
  useEffect(() => {
    if (!parsed || !parsed.entries.length) { setPreview(null); return undefined; }
    const mine = ++seq.current;
    setPreview(p => ({ ...(p || {}), state: 'busy' }));
    const t = setTimeout(async () => {
      const answers = [];
      for (const part of chunks(rated)) {
        const out = await booksAction('import.preview', { source: parsed.source, rows: part });
        if (mine !== seq.current) return;
        if (!out.ok) { setPreview({ state: 'error', error: out.error }); return; }
        answers.push(readPreview(out.data));
      }
      setPreview({ state: 'ok', ...mergePreviews(answers) });
    }, 350);
    return () => clearTimeout(t);
  }, [parsed, rated]);

  const reset = () => {
    setFile(null); setReadErr(null); setManual(false); setMapping({}); setRates({}); setCats({});
    setPreview(null); setTab('add'); setCommit(null);
    if (input.current) input.current.value = '';
  };

  const readFile = f => {
    reset();
    if (!f) return;
    if (f.size > MAX_BYTES) { setReadErr('That file is over 5 MB — split it by year and import each part.'); return; }
    const r = new FileReader();
    r.onerror = () => setReadErr('Couldn’t read that file.');
    r.onload = () => {
      const rows = parseCsv(String(r.result || ''));
      const at = findHeaderRow(rows);
      if (at < 0 || rows.length < at + 2) { setReadErr('No rows found — is it a CSV with a header line?'); return; }
      setFile({ name: f.name, rows, headers: rows[at].map(h => String(h).trim()), headerAt: at });
    };
    r.readAsText(f);
  };

  // The importer's own invalid rows (unreadable date/amount) join the server's.
  const view = useMemo(() => {
    if (!preview || !preview.add) return null;     // keeps the last answer on screen while re-checking
    const localInvalid = (parsed && parsed.invalid) || [];
    return { add: preview.add, duplicates: preview.duplicates, invalid: [...localInvalid, ...preview.invalid] };
  }, [preview, parsed]);

  const addRefs = useMemo(() => new Set((view ? view.add : []).map(r => r && r.source_ref).filter(Boolean)), [view]);
  const toCommit = useMemo(() => {
    if (!view) return [];
    const local = rated.filter(e => addRefs.has(e.source_ref));
    const base = local.length ? local : view.add;
    return base.map(e => (cats[e.source_ref] ? { ...e, category: cats[e.source_ref] } : e));
  }, [view, rated, addRefs, cats]);
  const commitTotal = toCommit.reduce((s, e) => s + (e.kind === 'expense' ? -1 : e.kind === 'income' ? 1 : 0) * (Number(e.gbp_pence) || 0), 0);

  const doCommit = async () => {
    setCommit({ busy: true });
    let added = 0, skipped = 0;
    for (const part of chunks(toCommit)) {
      const out = await booksAction('import.commit', { source: parsed.source, rows: part });
      if (!out.ok) {
        setCommit({ error: added ? `${out.error} (${added} were added before it stopped — importing again won’t duplicate them.)` : out.error });
        return;
      }
      const d = out.data || {};
      added += Number(d.inserted) || 0;
      skipped += Number(d.duplicates) || 0;
    }
    // Remember the rates used, so the next report from the same store is one tap.
    if (needRates.length && Object.keys(fx).length) {
      const base = prefs || {};
      booksAction('config.set', { key: 'prefs', value: { ...base, fx: { ...(base.fx || {}), ...fx } } })
        .then(r => { if (r.ok) setPrefs(p => ({ ...(p || {}), fx: { ...((p && p.fx) || {}), ...fx } })); });
    }
    setCommit({ ok: true, added, skipped });
    setPreview(null);
  };

  if (commit && commit.ok) {
    return (
      <div className="sec-pane">
        <div className="sec-card bk-done" role="status">
          <span className="bk-done-icon"><Icon name="check" size={18} strokeWidth={2.4} /></span>
          <div>
            <h3 className="sec-h">Added {commit.added.toLocaleString('en-GB')} {commit.added === 1 ? 'entry' : 'entries'}</h3>
            <p className="sec-p">{commit.skipped ? `${commit.skipped} already in the ledger were skipped. ` : ''}From {file && file.name}.</p>
            <div className="sec-acts">
              <button type="button" className="sec-btn is-primary bk-btn-lg" onClick={() => go('ledger')}>Open ledger</button>
              <button type="button" className="sec-btn bk-btn-lg" onClick={reset}>Import another</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sec-pane">
      <div className={`bk-drop${drag ? ' is-drag' : ''}${file ? ' has-file' : ''}`}
           onDragOver={e => { e.preventDefault(); setDrag(true); }}
           onDragLeave={() => setDrag(false)}
           onDrop={e => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}>
        <Icon name="upload" size={20} />
        <div className="bk-drop-text">
          {file ? (
            <>
              <b>{file.name}</b>
              <span>{(file.rows.length - file.headerAt - 1).toLocaleString('en-GB')} rows · {detected && !manual ? FORMAT_LABEL[detected] : 'columns mapped by hand'}</span>
            </>
          ) : (
            <>
              <b>Drop a CSV here</b>
              <span>Bank statement, App Store financial report, Google Play earnings, or a Books export.</span>
            </>
          )}
        </div>
        <div className="sec-acts">
          <button type="button" className="sec-btn bk-btn-lg" onClick={() => input.current && input.current.click()}>
            {file ? 'Choose another' : 'Choose file'}
          </button>
          {file && <button type="button" className="sec-btn is-quiet bk-btn-lg" onClick={reset}>Clear</button>}
        </div>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" tabIndex={-1} aria-hidden="true"
               onChange={e => readFile(e.target.files && e.target.files[0])} />
      </div>
      {readErr && <div className="sec-note is-bad" role="alert">{readErr}</div>}

      {file && (
        <section className="sec-card">
          <CardHead eyebrow="// 1 · What it is" title={detected && !manual ? FORMAT_LABEL[detected] : 'Not recognised — map the columns'}
                    right={detected ? (
                      <button type="button" className="sec-link" onClick={() => { setManual(m => !m); setMapping({}); }}>
                        {manual ? 'Use detected format' : 'Map columns by hand'}
                      </button>
                    ) : null} />
          {useMapping ? (
            <>
              <p className="sec-p">Pick which of the file’s columns hold each value. Use a signed Amount, or both Money in and Money out.</p>
              <div className="bk-map">
                {MAP_FIELDS.map(([k, label, req]) => (
                  <label key={k} className="bk-field">
                    <span className="bk-field-lbl">{label}{req ? '' : ' · optional'}</span>
                    <select value={mapping[k] || ''} onChange={e => setMapping(m => ({ ...m, [k]: e.target.value || undefined }))}>
                      <option value="">—</option>
                      {file.headers.map((h, i) => <option key={i} value={h}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <Sample file={file} />
              {!mapReady && <p className="sec-fine">Date, Description and an amount (or both Money in and Money out) are needed.</p>}
            </>
          ) : (
            <p className="sec-fine">Headers: {file.headers.slice(0, 8).join(' · ')}{file.headers.length > 8 ? ` · +${file.headers.length - 8}` : ''}</p>
          )}
        </section>
      )}

      {parsed && needRates.length > 0 && (
        <section className="sec-card">
          <CardHead eyebrow="// 2 · Rates" title="Value in pounds" />
          <p className="sec-p">Reports count everything in GBP. Enter what one unit was worth in pounds for this import — the rate on the payout, or your bank’s. Rates you use are remembered for next time.</p>
          <div className="bk-rates">
            {needRates.map(c => (
              <label key={c} className="bk-field">
                <span className="bk-field-lbl">1 {c} = £</span>
                <input inputMode="decimal" placeholder="0.79" value={rates[c] || ''} onChange={e => setRates(r => ({ ...r, [c]: e.target.value }))} />
              </label>
            ))}
          </div>
        </section>
      )}

      {parsed && (
        <section className="sec-card">
          <CardHead eyebrow={`// ${needRates.length ? 3 : 2} · Check`} title="Against the ledger"
                    right={preview && preview.state === 'busy' ? <span className="sec-fine">checking…</span> : null} />
          {!parsed.entries.length ? (
            <div className="sec-note is-warn">No usable rows — {parsed.invalid.length} couldn’t be read{parsed.skipped ? `, ${parsed.skipped} skipped (zero or totals)` : ''}. {parsed.invalid[0] ? `Row ${parsed.invalid[0].row}: ${parsed.invalid[0].reason}` : ''}</div>
          ) : !view ? (
            preview && preview.state === 'error'
              ? <div className="sec-note is-bad">{preview.error}</div>
              : <div className="sec-skel-wrap" aria-busy="true"><div className="sec-skel" /><div className="sec-skel is-short" /></div>
          ) : (
            <>
              <div className="sec-advtabs" role="tablist" aria-label="Preview">
                {TABS.map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k}
                          className={`sec-advtab is-${k === 'add' ? 'info' : k === 'duplicates' ? 'accepted' : 'bad'}${tab === k ? ' is-on' : ''}`}
                          onClick={() => setTab(k)}>
                    <i aria-hidden="true" />{label} <b>{view[k].length.toLocaleString('en-GB')}</b>
                  </button>
                ))}
              </div>
              <PreviewTable tab={tab} rows={view[tab]} cats={cats} setCats={setCats} rated={rated} />
              <div className="bk-commit">
                <div className="bk-commit-text">
                  {toCommit.length
                    ? <>Commit adds <b>{toCommit.length.toLocaleString('en-GB')}</b> {toCommit.length === 1 ? 'entry' : 'entries'} · net <Money pence={commitTotal} signed /></>
                    : 'Nothing new to add — everything here is already in the ledger.'}
                  {missingRates.length > 0 && <span className="bk-commit-warn">Enter a rate for {missingRates.join(', ')} first.</span>}
                  {parsed.skipped > 0 && <span className="bk-commit-note">{parsed.skipped} zero or total {parsed.skipped === 1 ? 'line' : 'lines'} skipped.</span>}
                </div>
                <button type="button" className="sec-btn is-primary bk-btn-lg" onClick={doCommit}
                        disabled={!toCommit.length || missingRates.length > 0 || (commit && commit.busy) || preview.state === 'busy'}>
                  {commit && commit.busy ? 'Adding…' : `Commit ${toCommit.length.toLocaleString('en-GB')}`}
                </button>
              </div>
              {commit && commit.error && <div className="sec-note is-bad" role="alert">{commit.error}</div>}
            </>
          )}
        </section>
      )}

      {!file && <Formats />}
    </div>
  );
}

function Sample({ file }) {
  const rows = file.rows.slice(file.headerAt + 1, file.headerAt + 4);
  return (
    <div className="sec-scroll bk-sample">
      <table className="sec-table">
        <thead><tr>{file.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{file.headers.map((h, j) => <td key={j}>{r[j]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function PreviewTable({ tab, rows, cats, setCats, rated }) {
  if (!rows.length) {
    return <p className="sec-fine bk-empty-tab">{tab === 'add' ? 'Nothing new.' : tab === 'duplicates' ? 'No duplicates.' : 'Every row read cleanly.'}</p>;
  }
  if (tab === 'invalid') {
    return (
      <div className="sec-scroll bk-preview">
        <table className="sec-table bk-ptable">
          <thead><tr><th>Row</th><th>Reason</th></tr></thead>
          <tbody>
            {rows.slice(0, SHOW).map((r, i) => (
              <tr key={i}><td className="is-num">{r.row ?? '—'}</td><td className="bk-reason">{r.reason || 'Not valid'}</td></tr>
            ))}
          </tbody>
        </table>
        {rows.length > SHOW && <p className="sec-fine">+{rows.length - SHOW} more</p>}
      </div>
    );
  }
  const byRef = new Map(rated.map(e => [e.source_ref, e]));
  const dup = tab === 'duplicates';
  return (
    <div className="sec-scroll bk-preview">
      <table className="sec-table bk-ptable">
        <thead>
          <tr><th>Date</th><th>Description</th><th>Kind</th><th>Category</th><th className="is-num">Amount</th><th className="is-num">GBP</th>{dup && <th>Why</th>}</tr>
        </thead>
        <tbody>
          {rows.slice(0, SHOW).map((r0, i) => {
            const r = byRef.get(r0.source_ref) || r0;
            const cat = cats[r.source_ref] || r.category;
            const options = categoriesFor(r.kind);
            return (
              <tr key={r.source_ref || i}>
                <td>{dateLabel(r.occurred_on)}</td>
                <td className="bk-pdesc" title={r.description || ''}>{r.description || '—'}</td>
                <td><KindChip kind={r.kind} /></td>
                <td>
                  {tab === 'add' ? (
                    <select className="bk-pcat" value={cat} aria-label={`Category for ${r.description || 'row'}`}
                            onChange={e => setCats(c => ({ ...c, [r.source_ref]: e.target.value }))}>
                      {!options.some(o => o.id === cat) && <option value={cat}>{categoryLabel(r.kind, cat)}</option>}
                      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  ) : categoryLabel(r.kind, cat)}
                  {tab === 'add' && r.confidence === 'low' && !cats[r.source_ref] && <span className="bk-guess" title="Guessed — check it" aria-label="Guessed — check it">?</span>}
                </td>
                <td className="is-num">{fmtMoney(r.amount_pence, r.currency)}</td>
                <td className="is-num">{Number.isInteger(r.gbp_pence) ? fmtGBP(r.gbp_pence) : <span className="bk-need">needs rate</span>}</td>
                {dup && <td className="bk-reason">{r0.reason || 'Already in the books'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > SHOW && <p className="sec-fine">Showing {SHOW} of {rows.length.toLocaleString('en-GB')} — all of them are committed.</p>}
    </div>
  );
}

/** What the importer reads. The store formats are from public docs and UNVERIFIED against a real file (see importers.js). */
function Formats() {
  return (
    <section className="sec-card">
      <CardHead eyebrow="// Formats" title="What Import reads" />
      <ul className="bk-formats">
        <li><b>Bank statement</b><span>Date, Description and Amount — or Money in / Money out, Paid in / Paid out, Credit / Debit. UK dates (dd/mm/yyyy), ISO or ‘5 Oct 2026’. Known merchants (hosting, AI, store fees) are categorised for you; store payouts are transfers, because the income is booked from the store’s own report.</span></li>
        <li><b>App Store financial report</b><span>App Store Connect → Payments and Financial Reports. Each row becomes App Store income (returns become refunds) in its own currency; you give the GBP rate.</span></li>
        <li><b>Google Play earnings</b><span>Play Console → Download reports → Financial → Earnings. Charges become Google Play income, Google fees become store fees and refunds become refunds.</span></li>
        <li><b>Books export</b><span>The CSV that Export writes — so a file can go round-trip.</span></li>
      </ul>
      <p className="sec-fine">Anything else: choose it anyway and map the columns by hand. Re-importing a file never duplicates — each row carries a stable reference.</p>
    </section>
  );
}
