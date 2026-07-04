/**
 * Overlay close handlers that only fire when the interaction STARTED
 * on the backdrop itself.
 *
 * The naive `onClick={e => e.target === e.currentTarget && close()}`
 * pattern closes the modal when a user drag-selects text inside an
 * input and releases the mouse over the backdrop — the browser
 * dispatches the click on the nearest common ancestor of mousedown
 * and mouseup (the backdrop), nuking their work-in-progress. Arming
 * on pointerdown means a click only counts as "clicked the backdrop"
 * when both the press and the release happened there.
 *
 * Usage:
 *   <div className="modal-overlay" {...backdropClose(() => onClose())}>
 */
export function backdropClose(close) {
  let armed = false;
  return {
    onPointerDown: e => { armed = e.target === e.currentTarget; },
    onClick: e => {
      if (armed && e.target === e.currentTarget) close(e);
      armed = false;
    },
  };
}
