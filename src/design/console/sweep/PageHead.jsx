/**
 * The console page header for SWEEP's screens: a 28/600 sentence-case
 * title, an optional one-line meta under it, and actions on the right.
 * No eyebrow, no `//`, no serif — the audit's tells 2 and 3.
 */
export default function PageHead({ title, meta = null, actions = null, children = null, className = '' }) {
  return (
    <header className={`cx-sweep-head${className ? ` ${className}` : ''}`}>
      <div className="cx-sweep-head-titles">
        <h1 className="cx-sweep-title">{title}</h1>
        {meta && <p className="cx-sweep-meta">{meta}</p>}
      </div>
      {actions && <div className="cx-sweep-head-actions">{actions}</div>}
      {children}
    </header>
  );
}
