/**
 * The console page header for SWEEP's screens: an optional one-line meta,
 * actions on the right, and any extra row (children).
 *
 * No title. The shell already prints the page title as the page's h1 (the
 * desktop top bar, and the phone app bar), so a second one here would be
 * the same word twice and two h1s on one page. `title` is still accepted,
 * as the header's accessible name, so callers read the same as before.
 * No eyebrow, no `//`, no serif (the audit's tells 2 and 3).
 */
export default function PageHead({ title = null, meta = null, actions = null, children = null, className = '' }) {
  if (!meta && !actions && !children) return null;
  return (
    <header className={`cx-sweep-head${className ? ` ${className}` : ''}`} aria-label={title || undefined}>
      {meta && (
        <div className="cx-sweep-head-titles">
          <p className="cx-sweep-meta">{meta}</p>
        </div>
      )}
      {actions && <div className="cx-sweep-head-actions">{actions}</div>}
      {children}
    </header>
  );
}
