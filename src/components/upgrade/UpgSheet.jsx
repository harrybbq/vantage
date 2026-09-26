/**
 * The Upgrade section's form sheet and labelled field — shared by the
 * Career tab's practice log, snippet library and plan editors, so every
 * owner-side editor opens, saves and closes the same way.
 */
export function Field({ label, children }) {
  return <label className="upg-field"><span className="upg-field-lbl">{label}</span>{children}</label>;
}

export function Sheet({ title, children, onClose, onSave, onDelete, saveLabel = 'Save', wide = false }) {
  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className={`modal upg-sheet${wide ? ' is-wide' : ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="upg-day-head">
          <div className="upg-day-date">{title}</div>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="upg-sheet-body">{children}</div>
        {(onSave || onDelete) && (
          <div className="upg-day-actions">
            {onDelete && <button type="button" className="upg-textbtn" onClick={onDelete}>Delete</button>}
            {onSave && <button type="button" className="link-open-btn" onClick={onSave}>{saveLabel}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
