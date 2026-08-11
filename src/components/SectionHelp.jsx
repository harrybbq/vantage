import { useState, useEffect, useRef } from 'react';

/**
 * The "?" beside a section title.
 *
 * Takes STRUCTURED rows, not a paragraph. It used to take one `text`
 * string, and every caller had grown into 200–400 characters of
 * comma-spliced prose describing every feature on the page at once. A
 * playtester's verdict was "a big chunk of unformatted text pops up" —
 * so he didn't read any of them, which makes the whole component worth
 * nothing.
 *
 * The row shape is the forcing function: a term and a definition short
 * enough to scan. If a definition won't fit in about ten words, that's
 * a sign the screen under it needs the work rather than the tooltip.
 *
 * @param title  Screen name, shown as the heading.
 * @param rows   [{ term, def }] — keep to 3–4.
 * @param foot   Optional single line, for the one thing that isn't a
 *               feature (a privacy opt-out, usually).
 */
export default function SectionHelp({ title, rows = [], foot }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="section-help-wrap">
      <button
        type="button"
        className="section-help-btn"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`About ${title || 'this screen'}`}
      >?</button>
      {open && (
        <div className="section-help-tooltip" role="dialog" aria-label={`About ${title || 'this screen'}`}>
          <div className="section-help-arrow" />
          {title && <div className="section-help-title">{title}</div>}
          <dl className="section-help-rows">
            {rows.map(r => (
              <div key={r.term} className="section-help-row">
                <dt>{r.term}</dt>
                <dd>{r.def}</dd>
              </div>
            ))}
          </dl>
          {foot && <div className="section-help-foot">{foot}</div>}
        </div>
      )}
    </span>
  );
}
