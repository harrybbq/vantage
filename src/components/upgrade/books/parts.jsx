/**
 * Books' small shared pieces: the per-panel gate (loading / not
 * installed / SQL not run / error), the calm setup card, a money figure,
 * kind and source chips, and the 5-second Undo toast.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../Icon';
import { fmtGBP } from '../../../lib/books/money';
import { SOURCE_LABEL } from '../../../lib/upgrade/booksView';
import { BOOKS_SQL } from './api';

/** Not set up yet: names the SQL and what it creates. Not an error — nothing is broken. */
export function BooksSetup({ installed = true, hint }) {
  return (
    <div className="sec-setup bk-setup">
      <div className="sec-setup-head"><Icon name="lock" size={14} /><span>{installed ? 'Books isn’t set up yet' : 'Books isn’t installed yet'}</span></div>
      {installed ? (
        <>
          <p className="sec-setup-p">
            Run <code>{BOOKS_SQL}</code> in the Supabase SQL editor, then refresh. It adds three tables —
            {' '}<b>entries</b> (every pound in and out), <b>recurring bills</b> and a small <b>settings</b> table —
            locked to the server (no browser can read them), and changes nothing that already exists.
          </p>
          <p className="sec-setup-p">Nothing in Books is ever hard-deleted: a deleted entry is marked and can be restored.</p>
        </>
      ) : (
        <p className="sec-setup-p">
          This arrives with the <code>books</code> Netlify function and <code>{BOOKS_SQL}</code>. Deploy, run the SQL, then refresh.
        </p>
      )}
      {hint && <p className="sec-setup-hint">Server says: {hint}</p>}
    </div>
  );
}

/** Everything a books view can be besides "here is the data". */
export function BooksGate({ res, children }) {
  if (!res) {
    return (
      <div className="sec-skel-wrap" aria-busy="true" aria-label="Loading">
        <div className="sec-skel" /><div className="sec-skel is-short" /><div className="sec-skel" />
      </div>
    );
  }
  if (res.state === 'ok') return children(res.data || {});
  if (res.state === 'not_configured') return <BooksSetup hint={res.hint} />;
  if (res.state === 'not-installed') return <BooksSetup installed={false} />;
  if (res.state === 'forbidden') return <div className="sec-note is-bad">{res.error || 'Owner only.'}</div>;
  if (res.state === 'unavailable') {
    return <div className="sec-note is-warn"><b>Unavailable right now.</b> {res.hint || 'The database didn’t answer — try again shortly.'}</div>;
  }
  return <div className="sec-note is-bad">{res.error || 'Something went wrong.'}</div>;
}

/** A signed money figure: '+£12.00' / '−£12.00' (sign is the first channel, never colour alone). */
export function Money({ pence, signed = false, className = '' }) {
  const n = Number(pence) || 0;
  const text = signed && n > 0 ? `+${fmtGBP(n)}` : fmtGBP(n);
  return <span className={`bk-money${signed ? (n < 0 ? ' is-out' : n > 0 ? ' is-in' : '') : ''} ${className}`}>{text}</span>;
}

export function KindChip({ kind }) {
  const label = kind === 'income' ? 'In' : kind === 'expense' ? 'Out' : 'Transfer';
  return <span className={`bk-kind is-${kind || 'none'}`}><i aria-hidden="true" />{label}</span>;
}

export function SourceChip({ source }) {
  return <span className="bk-chip is-src">{SOURCE_LABEL[source] || source || 'Manual'}</span>;
}

/**
 * "Entry deleted · Undo" for 5 seconds. Announced politely; Undo is a
 * real button (Tab reaches it) and the toast never steals focus.
 */
export function UndoToast({ toast, onUndo, onDone }) {
  const [left, setLeft] = useState(5);
  const t = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    setLeft(5);
    const started = Date.now();
    t.current = setInterval(() => {
      const l = 5 - Math.floor((Date.now() - started) / 1000);
      if (l <= 0) { clearInterval(t.current); onDone(); } else setLeft(l);
    }, 250);
    return () => clearInterval(t.current);
  }, [toast, onDone]);
  if (!toast) return null;
  // Portalled to <body> (re-wrapped for the theme tokens): an ancestor of
  // the section can carry a transform, which would pin a fixed toast to
  // the bottom of the page instead of the screen.
  return createPortal(
    <div className="upg-app sec books bk-toast-root">
    <div className="bk-toast" role="status" aria-live="polite">
      <span className="bk-toast-text">{toast.text}</span>
      {toast.undo && (
        <button type="button" className="bk-toast-undo" onClick={() => { clearInterval(t.current); onUndo(toast); }}>
          Undo <span className="bk-toast-left" aria-hidden="true">{left}s</span>
        </button>
      )}
      <button type="button" className="bk-toast-x" aria-label="Dismiss" onClick={() => { clearInterval(t.current); onDone(); }}>
        <Icon name="x" size={14} />
      </button>
    </div>
    </div>,
    document.body,
  );
}

/** A labelled form field with its validation message under it. */
export function Field({ label, error, hint, children, wide = false, id }) {
  return (
    <label className={`bk-field${wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`} htmlFor={id}>
      <span className="bk-field-lbl">{label}</span>
      {children}
      {error ? <span className="bk-field-err" role="alert">{error}</span> : hint ? <span className="bk-field-hint">{hint}</span> : null}
    </label>
  );
}
