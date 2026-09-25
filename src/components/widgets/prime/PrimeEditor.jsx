/**
 * Choosing which blocks a prime card shows, and in what order.
 *
 * ── One config, two presentations ────────────────────────────────────
 * Desktop gets a popover anchored to the count chip; mobile gets a
 * bottom sheet. They edit exactly the same thing and are built from the
 * same row list — the difference is touch-target size and where it
 * appears, not what it can do.
 *
 * ── Why you reorder here and never on the card ───────────────────────
 * On a phone the card itself is already a drag target: hold for 450ms
 * and it lifts out of the stack. A second vertical drag INSIDE the card
 * would be competing for the same gesture, and the loser would be
 * whichever one the user did not mean. In the sheet there is no such
 * competition, so the arrows work immediately.
 *
 * ── Ticked blocks sit on top, in order; hidden ones sit below ────────
 * Ticking one appends it to the end rather than restoring some
 * remembered position — a list that reshuffles when you tick something
 * is a list you cannot aim at.
 *
 * The last ticked block cannot be unticked. A card showing nothing is
 * not a state worth being able to reach by accident; the way to get rid
 * of a card is to delete it.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../Icon';
import { PRIMES, blocksOf, blockOpts, primeOf } from '../../../lib/hub/primeBlocks';

/** The shared body: presets, the showing list, the hidden list. */
/**
 * Which pots a Pots block shows. None ticked means all of them — the
 * default, and what every card that predates the choice already does —
 * so the first tick narrows rather than the last untick blanking it.
 */
function PotPicks({ pots, picks, onPicks }) {
  if (!pots || pots.length < 2) return null;
  const on = new Set(picks || []);
  const all = on.size === 0;
  return (
    <div className="pe-picks" role="group" aria-label="Which pots to show">
      <button
        type="button"
        className={`pe-pick${all ? ' is-on' : ''}`}
        onClick={() => onPicks([])}
      >All</button>
      {pots.map(p => (
        <button
          key={p.id}
          type="button"
          className={`pe-pick${on.has(p.id) ? ' is-on' : ''}`}
          onClick={() => {
            const next = new Set(on);
            if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
            onPicks(pots.filter(x => next.has(x.id)).map(x => x.id));
          }}
        >{p.name || 'Pot'}</button>
      ))}
    </div>
  );
}

function EditorBody({ P, ids, onSet, onTitle, title, variant, widget, pots, onOpts }) {
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    onSet(next);
  };
  const hidden = Object.keys(P.blocks).filter(id => !ids.includes(id));
  const onlyOne = ids.length === 1;

  return (
    <>
      {onTitle && (
        <input
          className="pe-title"
          value={title || ''}
          onChange={e => onTitle(e.target.value.slice(0, 24))}
          placeholder="Name this card (optional)"
          aria-label="Card name"
        />
      )}

      <div className="pe-group">
        <span className="pe-lbl">Start from</span>
        <div className="pe-presets">
          {P.presets.map(([name, list]) => {
            const on = list.join() === ids.join();
            return (
              <button
                key={name}
                type="button"
                className={`pe-preset${on ? ' is-on' : ''}`}
                onClick={() => onSet([...list])}
              >{name}</button>
            );
          })}
        </div>
      </div>

      <div className="pe-group">
        <span className="pe-lbl">Showing · in order</span>
        {ids.map((id, i) => (
          <div className="pe-rowwrap" key={id}>
          <div className={`pe-row${variant === 'sheet' ? ' is-sheet' : ''}`}>
            <button
              type="button"
              className="pe-tick is-on"
              onClick={() => !onlyOne && onSet(ids.filter(x => x !== id))}
              disabled={onlyOne}
              title={onlyOne ? 'A card has to show something' : 'Hide this block'}
              aria-label={onlyOne ? 'A card has to show something' : `Hide ${P.blocks[id].name}`}
            >✓</button>
            <span className="pe-n" aria-hidden="true">{i + 1}</span>
            <span className="pe-name">{P.blocks[id].name}</span>
            <button
              type="button" className="pe-arrow" onClick={() => move(i, -1)}
              disabled={i === 0} aria-label={`Move ${P.blocks[id].name} up`}
            >↑</button>
            <button
              type="button" className="pe-arrow" onClick={() => move(i, 1)}
              disabled={i === ids.length - 1} aria-label={`Move ${P.blocks[id].name} down`}
            >↓</button>
          </div>
          {P.blocks[id].options === 'pots' && onOpts && (
            <PotPicks
              pots={pots}
              picks={blockOpts(widget, id).picks}
              onPicks={picks => onOpts(id, { picks, count: undefined })}
            />
          )}
          </div>
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="pe-group">
          <span className="pe-lbl">Hidden · tick to add at the end</span>
          {hidden.map(id => (
            <button
              key={id}
              type="button"
              className={`pe-row pe-row-off${variant === 'sheet' ? ' is-sheet' : ''}`}
              onClick={() => onSet([...ids, id])}
            >
              <span className="pe-tick" />
              <span className="pe-name">{P.blocks[id].name}</span>
            </button>
          ))}
        </div>
      )}
      {hidden.length === 0 && (
        <span className="pe-allon">Every block is showing.</span>
      )}
    </>
  );
}

/**
 * Desktop: a popover beside the count chip.
 *
 * Anchored rather than replacing the card body, because the smallest
 * card a prime supports is 280×200 and an editor inside that is a
 * letterbox. Closes on outside pointer-down or Escape, like the other
 * chrome menus.
 */
export function PrimeEditorPopover({ widget, onSet, onTitle, onOpts, pots, onClose, anchorRect }) {
  const ref = useRef(null);
  const P = PRIMES[primeOf(widget)];
  const ids = blocksOf(widget);

  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!P) return null;

  // Keep it on screen: flip to the left of the card when there is no
  // room to the right, and never let it run off the bottom.
  const W = 292;
  const gap = 10;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const r = anchorRect || { left: 40, top: 80, right: 320, bottom: 280 };
  const left = r.right + gap + W > vw ? Math.max(8, r.left - W - gap) : r.right + gap;
  const top = Math.max(8, Math.min(r.top, vh - 420));

  return createPortal(
    <div className="pe-pop" ref={ref} style={{ left, top, width: W, maxHeight: vh - top - 12 }} role="dialog" aria-label={`Edit ${P.name} card`}>
      <div className="pe-pop-head">
        <span className="pe-lbl">Edit card</span>
        <button type="button" className="pe-done" onClick={onClose}>Done</button>
      </div>
      <EditorBody P={P} ids={ids} onSet={onSet} onTitle={onTitle} title={widget.title} variant="pop"
        widget={widget} pots={pots} onOpts={onOpts} />
    </div>,
    document.body,
  );
}

/**
 * Mobile: a bottom sheet.
 *
 * Full-height rows with 44px targets, and it caps at 72% of the viewport
 * with its own scroll so the card stays visible behind it — you are
 * editing something you should be able to see change.
 */
export function PrimeEditorSheet({ widget, onSet, onTitle, onOpts, pots, onClose }) {
  const P = PRIMES[primeOf(widget)];
  const ids = blocksOf(widget);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!P) return null;

  return createPortal(
    <div className="pe-sheet-wrap" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pe-sheet" role="dialog" aria-label={`Edit ${P.name} card`}>
        <span className="pe-grab" aria-hidden="true" />
        <div className="pe-sheet-head">
          <span className="pe-sheet-title">
            <Icon name={P.icon} size={14} /> {P.name} card
          </span>
          <button type="button" className="pe-done is-big" onClick={onClose}>Done</button>
        </div>
        <div className="pe-sheet-body">
          <EditorBody P={P} ids={ids} onSet={onSet} onTitle={onTitle} title={widget.title} variant="sheet"
            widget={widget} pots={pots} onOpts={onOpts} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
