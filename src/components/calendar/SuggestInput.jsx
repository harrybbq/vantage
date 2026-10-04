/**
 * A text input with a suggestion list and a greyed inline completion —
 * the WAI-ARIA combobox pattern (list + inline autocomplete).
 *
 * Used by the event form for the name and location fields. It owns only
 * the interaction (open/closed, which row is active, keyboard); what the
 * suggestions ARE and what picking one does belong to the caller.
 *
 * Keyboard: ↓/↑ move through the list (↓ opens it), Enter picks the
 * active row, Esc closes the list (a second Esc reaches the modal), and
 * Tab or → accepts the inline completion when the caret is at the end.
 *
 * The list opens only after the user TYPES in this field. A field that
 * arrives pre-filled — editing an existing event — shows nothing until
 * it is edited, so opening an event to fix its time does not throw a
 * menu over the form.
 *
 * The list sits in the flow under the field rather than floating over
 * the form: the sheet scrolls internally, and an absolutely positioned
 * popover would be clipped by that scroll box on a short phone.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export default function SuggestInput({
  inputRef, value, onType, options, ghost, onPick, onAcceptGhost, onEnter,
  label, placeholder, maxLength = 120, listLabel,
}) {
  const id = useId();
  const listId = `${id}-list`;
  const ghostRef = useRef(null);
  const ownRef = useRef(null);
  const ref = inputRef || ownRef;

  const [focused, setFocused] = useState(false);
  const [armed, setArmed] = useState(false);     // user has typed since the last pick/Esc
  const [active, setActive] = useState(0);
  const [caretAtEnd, setCaretAtEnd] = useState(true);

  const count = options.length;
  const optionsKey = options.map(o => o.id).join('\u0001');
  // A new set of matches starts from the top row, so Enter means "the
  // best match" rather than whatever row index was active a letter ago.
  useEffect(() => { setActive(0); }, [optionsKey]);

  const expanded = focused && armed && count > 0;
  const showGhost = !!ghost && focused && armed && caretAtEnd && (!expanded || active === 0);

  // The ghost is a copy of the text laid over the input. If the text is
  // wider than the box (the input has scrolled), the copy no longer lines
  // up — hide it rather than draw the completion in the wrong place.
  useLayoutEffect(() => {
    const g = ghostRef.current, inp = ref.current;
    if (!g || !inp) return;
    g.style.visibility = (g.scrollWidth > g.clientWidth + 1 || inp.scrollLeft > 0) ? 'hidden' : '';
  });

  const syncCaret = e => {
    const el = e.target;
    setCaretAtEnd(el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
  };

  function pick(i) {
    setArmed(false);
    onPick(i);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      if (!count) return;
      e.preventDefault();
      if (!expanded) { setArmed(true); setActive(0); }
      else setActive(a => (a + 1) % count);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!expanded) return;
      e.preventDefault();
      setActive(a => (a - 1 + count) % count);
      return;
    }
    if (e.key === 'Enter') {
      if (expanded && active >= 0 && active < count) {
        e.preventDefault();
        pick(active);
        return;
      }
      onEnter?.(e);
      return;
    }
    if (e.key === 'Escape') {
      if (expanded || showGhost) {
        // Claimed here; the modal's own Esc handler checks defaultPrevented.
        e.preventDefault();
        e.stopPropagation();
        setArmed(false);
      }
      return;
    }
    if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight') {
      const el = e.target;
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
      if (showGhost && atEnd) {
        e.preventDefault();
        setArmed(false);
        onAcceptGhost();
      }
    }
  }

  return (
    <div className="ev-field ev-combo">
      <label className="ev-field-lbl" htmlFor={id}>{label}</label>
      <div className="ev-combo-box">
        <input
          id={id} ref={ref} value={value} maxLength={maxLength} placeholder={placeholder}
          autoComplete="off" spellCheck={false}
          role="combobox"
          aria-autocomplete="both"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded ? `${id}-opt-${active}` : undefined}
          onChange={e => { onType(e.target.value); setArmed(true); syncCaret(e); }}
          onSelect={syncCaret}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        {showGhost && (
          <div className="ev-ghost" ref={ghostRef} aria-hidden="true">
            <span className="ev-ghost-typed">{value}</span>
            <span className="ev-ghost-rest">{ghost}</span>
          </div>
        )}
      </div>
      {showGhost && <span className="ev-sr">Suggestion: {value}{ghost}. Press Tab to accept.</span>}
      <ul id={listId} role="listbox" aria-label={listLabel}
          className="ev-suggest" hidden={!expanded}
          // Keep focus in the input while a row is pressed, so the list
          // is still there when the click lands.
          onMouseDown={e => e.preventDefault()}>
        {expanded && options.map((o, i) => (
          <li key={o.id} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
              className={'ev-suggest-opt' + (i === active ? ' is-active' : '')}
              onMouseMove={() => { if (i !== active) setActive(i); }}
              onClick={() => pick(i)}>
            {o.dot
              ? <span className="ev-suggest-dot" style={{ background: o.dot }} aria-hidden="true" />
              : <span className="ev-suggest-dot is-none" aria-hidden="true" />}
            <span className="ev-suggest-text">
              <span className="ev-suggest-title">{o.title}</span>
              {o.detail && <span className="ev-suggest-detail">{o.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
