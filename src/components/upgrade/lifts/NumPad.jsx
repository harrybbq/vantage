/**
 * The number pad (coarse pointers) — brief §3.5.6, fixing A10:
 *
 *   header   "KG · Machine shoulder press · set 3"  value (28 mono)  ⌄ close (44)
 *   sub-line "prev 80 × 8 · best 85 × 6 · step 2.5" (12 mono, muted)
 *   chips    KG: "= prev 80" · "+2.5 → 82.5" · "☾ 64"; REPS: the target range
 *            RPE mode instead: 8 single-hue chips 6 · 7 · 7.5 … 10 and the
 *            "8 · 2 reps left" line (no traffic-light colours, A10b)
 *   keys     1 2 3 ⌫ / 4 5 6 +step / 7 8 9 −step / . 0 Done Next →
 *            Next is the accent; Done is a WORD and only closes (A10c);
 *            ⌄ in the header closes too (A10d), as does Esc.
 *
 * Touch behaviour: a key highlights on pointer-down and commits on
 * pointer-UP; moving > 10 px cancels; a repeat of the same key within
 * 80 ms is ignored; ⌫ and ± repeat every 150 ms after a 400 ms hold.
 * Keyboard: Enter/Space on a focused key, and while the pad is open the
 * physical keys 0–9 . Backspace + − Enter (Next) Esc (close).
 *
 * The pad is just the panel — the caller docks it (WorkoutLive puts it in
 * the bottom dock under the rest bar). `onHeight` reports its height so the
 * caller can set scroll-padding-bottom and keep the active row above it.
 *
 * API — the original props still work unchanged:
 *   field ('reps'|'weight'|'rpe'), title, value, rpe, step, onKey(k),
 *   onStep(dir), onRpe(n), onNext, onDone, hasNext
 * New, all optional:
 *   label        header text (defaults to `title`)
 *   fieldLabel   'KG' | 'KG/hand' | '+KG' … (defaults by field)
 *   placeholder  shown when the value is empty ('—'; '+0' for a dip)
 *   prevText, bestText   for the sub-line ("80 × 8", "85 × 6"); `sub` overrides it
 *   prevValue    this field's Previous value → "= prev 80" chip (KG) / a rep chip
 *   nightValue   KG: the ☾ 80 % target → "☾ 64" chip
 *   targetReps   "6–10" | [6, 10] → REPS chips 6 7 8 9 10
 *   chips        [{ label, value, tone?: 'night'|'accent' }] — replaces the derived chips
 *   onSet(v)     set the field to a value (the chips need it; without it they hide)
 *   onClose      ⌄ and Esc (defaults to onDone)
 *   onHeight(px) the pad's rendered height, on mount and on every change
 *   testId       defaults to 'wk-pad'
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../Icon';
import { RPE_STEPS } from '../../../lib/lifts/workout';
import { rpeLine } from '../../../lib/lifts/ui';
import { fmtKg } from '../../../lib/lifts/lifts';
import './ui/ui.css';

const LABEL = { reps: 'Reps', weight: 'KG', rpe: 'RPE' };
const HOLD_MS = 400, REPEAT_MS = 150, MOVE_PX = 10, GUARD_MS = 80;

const rangeOf = t => {
  if (Array.isArray(t)) return t.length >= 2 ? [Number(t[0]), Number(t[1])] : t.length ? [Number(t[0]), Number(t[0])] : null;
  const m = /(\d+)\s*[–-]\s*(\d+)/.exec(String(t || ''));
  if (m) return [Number(m[1]), Number(m[2])];
  const one = /(\d+)/.exec(String(t || ''));
  return one ? [Number(one[1]), Number(one[1])] : null;
};
const trimStep = s => String(Math.round(Number(s) * 100) / 100);

export default function NumPad({
  field, title, value, rpe, step, onKey, onStep, onRpe, onNext, onDone, hasNext = true,
  label, fieldLabel, placeholder = '—', prevText, bestText, sub, prevValue, nightValue, targetReps, chips, onSet, onClose, onHeight,
  testId = 'wk-pad',
}) {
  const root = useRef(null);
  const press = useRef(null);       // { key, x, y, cancelled, repeated, hold, rep }
  const last = useRef({ key: null, t: 0 });
  const [down, setDown] = useState(null);
  const close = onClose || onDone;
  const stepTxt = trimStep(step || 1);

  // Report the height (scroll-padding-bottom upstream).
  useLayoutEffect(() => {
    if (!onHeight || !root.current) return undefined;
    const el = root.current;
    const report = () => onHeight(Math.round(el.getBoundingClientRect().height));
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  const act = useCallback(k => {
    if (k === 'step+') onStep(1);
    else if (k === 'step-') onStep(-1);
    else if (k === 'next') onNext();
    else if (k === 'done') onDone();
    else onKey(k);
  }, [onKey, onStep, onNext, onDone]);
  const commit = useCallback(k => {
    const now = performance.now();
    if (last.current.key === k && now - last.current.t < GUARD_MS) return;   // double-tap guard
    last.current = { key: k, t: now };
    act(k);
  }, [act]);

  const clearTimers = (p = press.current) => {
    if (p) { clearTimeout(p.hold); clearInterval(p.rep); }
  };
  useEffect(() => () => clearTimers(), []);

  const repeatable = k => k === 'back' || k === 'step+' || k === 'step-';
  const pd = k => e => {
    if (e.button != null && e.button !== 0) return;
    clearTimers();
    const p = { key: k, x: e.clientX, y: e.clientY, cancelled: false, repeated: false };
    if (repeatable(k)) {
      p.hold = setTimeout(() => {
        p.repeated = true;
        act(k);
        p.rep = setInterval(() => act(k), REPEAT_MS);
      }, HOLD_MS);
    }
    press.current = p;
    setDown(k);
  };
  const pm = e => {
    const p = press.current;
    if (!p || p.cancelled) return;
    if (Math.abs(e.clientX - p.x) > MOVE_PX || Math.abs(e.clientY - p.y) > MOVE_PX) {
      p.cancelled = true;
      clearTimers();
      setDown(null);
    }
  };
  const pu = k => () => {
    const p = press.current;
    clearTimers(p);
    press.current = null;
    setDown(null);
    if (!p || p.key !== k || p.cancelled || p.repeated) return;
    commit(k);
  };
  const pc = () => { clearTimers(); press.current = null; setDown(null); };
  // Keyboard activation of a focused key (no pointer events): detail === 0.
  const click = k => e => { if (e.detail === 0) commit(k); };

  // Physical keys while the pad is open.
  useEffect(() => {
    const h = e => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      // Keys typed inside a sheet (or its popovers) belong to the sheet, not the pad.
      if (e.target && e.target.closest && e.target.closest('.lf-sheet-root, .sec-sheet-root, .lf-pop-root')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (root.current && root.current.contains(e.target) && (e.key === 'Enter' || e.key === ' ')) return; // the focused key handles it
      if (/^\d$/.test(e.key)) { e.preventDefault(); commit(e.key); }
      else if (e.key === '.' || e.key === ',') { if (field !== 'reps') { e.preventDefault(); commit('.'); } }
      else if (e.key === 'Backspace') { e.preventDefault(); commit('back'); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); commit('step+'); }
      else if (e.key === '-') { e.preventDefault(); commit('step-'); }
      else if (e.key === 'Enter') { e.preventDefault(); commit('next'); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [close, commit, field]);

  // A render helper, not a component: keys must keep their DOM node across
  // the re-render a press causes (a touch's pointerup goes to the node it began on).
  const K = ({ k, children, cls = '', aria, disabled = false, testid }) => (
    <button key={k} type="button" className={`lf-padkey${cls ? ` ${cls}` : ''}${down === k ? ' is-down' : ''}`} aria-label={aria || String(k)} disabled={disabled}
            data-key={k} data-testid={testid}
            onPointerDown={pd(k)} onPointerMove={pm} onPointerUp={pu(k)} onPointerCancel={pc} onPointerLeave={pc} onClick={click(k)}
            onContextMenu={e => e.preventDefault()}>
      {children ?? k}
    </button>
  );

  // Context chips.
  let chipRow = [];
  if (Array.isArray(chips)) chipRow = chips;
  else if (onSet && field === 'weight') {
    const pv = prevValue != null && prevValue !== '' ? Number(prevValue) : null;
    if (pv != null && Number.isFinite(pv)) {
      chipRow.push({ label: `= prev ${fmtKg(pv, 2)}`, value: pv });
      chipRow.push({ label: `+${stepTxt} → ${fmtKg(pv + Number(step || 0), 2)}`, value: Math.round((pv + Number(step || 0)) * 100) / 100 });
    }
    const nv = nightValue != null && nightValue !== '' ? Number(nightValue) : null;
    if (nv != null && Number.isFinite(nv)) chipRow.push({ label: `☾ ${fmtKg(nv, 2)}`, value: nv, tone: 'night', aria: `Night target ${fmtKg(nv, 2)}` });
  } else if (onSet && field === 'reps') {
    const r = rangeOf(targetReps);
    if (r) {
      const [lo, hi] = [Math.max(1, Math.min(r[0], r[1])), Math.min(50, Math.max(r[0], r[1]))];
      const from = hi - lo > 5 ? hi - 5 : lo;
      for (let n = from; n <= hi; n++) chipRow.push({ label: String(n), value: n });
    } else if (prevValue != null && Number.isFinite(Number(prevValue))) {
      chipRow.push({ label: `= prev ${prevValue}`, value: Number(prevValue) });
    }
  }
  const cur = value === '' || value == null ? null : Number(value);
  const subLine = sub != null ? sub : [prevText ? `prev ${prevText}` : null, bestText ? `best ${bestText}` : null, field !== 'rpe' ? `step ${stepTxt}` : null].filter(Boolean).join(' · ');
  const fl = fieldLabel || LABEL[field] || '';
  const head = label || title || '';
  const rpeN = rpe == null || rpe === '' ? null : Number(rpe);

  return (
    <div ref={root} className={`lf-pad is-${field}`} role="group" aria-label={`Number pad · ${head} · ${fl}`} data-testid={testId}>
      <div className="lf-pad-head">
        <span className="lf-pad-label"><b>{fl}</b>{head ? <> · {head}</> : null}</span>
        <span className={`lf-pad-val lf-num${cur == null ? ' is-empty' : ''}`} aria-live="polite" data-testid="lf-pad-val">{cur == null ? placeholder : value}</span>
        <button type="button" className="lf-iconbtn lf-pad-close" onClick={close} aria-label="Close number pad" data-testid="lf-pad-close">
          <Icon name="chevron-down" size={22} />
        </button>
      </div>
      {subLine && <p className="lf-pad-sub">{subLine}</p>}
      {field === 'rpe' ? (
        <>
          <div className="lf-pad-rpe" role="group" aria-label="RPE — how hard the set was">
            {RPE_STEPS.map(n => (
              <button key={n} type="button" className={`lf-rpechip${rpeN === n ? ' is-on' : ''}`} aria-pressed={rpeN === n} onClick={() => onRpe(n)} data-testid="lf-rpe-chip">
                {String(n)}
              </button>
            ))}
          </div>
          <p className="lf-pad-rpeline" aria-live="polite">{rpeN != null ? rpeLine(rpeN) : 'RPE 10 = nothing left · 8 = 2 reps left'}</p>
        </>
      ) : chipRow.length > 0 && (
        <div className="lf-pad-chips" role="group" aria-label="Quick values">
          {chipRow.map((c, i) => (
            <button key={`${c.label}-${i}`} type="button" className={`lf-padchip${c.tone ? ` is-${c.tone}` : ''}${cur != null && Number(c.value) === cur ? ' is-on' : ''}`}
                    aria-label={c.aria || c.label} onClick={() => (onSet ? onSet(c.value) : null)} data-testid="lf-pad-chip">
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="lf-pad-keys">
        {K({ k: '1' })}{K({ k: '2' })}{K({ k: '3' })}
        {K({ k: 'back', cls: 'is-fn', aria: 'Backspace', children: <><Icon name="delete" size={22} /></> })}
        {K({ k: '4' })}{K({ k: '5' })}{K({ k: '6' })}
        {K({ k: 'step+', cls: 'is-fn', aria: `Up ${stepTxt}`, children: <>+{stepTxt}</> })}
        {K({ k: '7' })}{K({ k: '8' })}{K({ k: '9' })}
        {K({ k: 'step-', cls: 'is-fn', aria: `Down ${stepTxt}`, children: <>−{stepTxt}</> })}
        {K({ k: '.', aria: 'Decimal point', disabled: field === 'reps', children: <>.</> })}
        {K({ k: '0' })}
        {K({ k: 'done', cls: 'is-done', aria: 'Done — close the pad', testid: 'wk-pad-done', children: <>Done</> })}
        {K({ k: 'next', cls: 'is-next', aria: hasNext ? 'Next field' : 'Close the pad', testid: 'lf-pad-next', children: <>{hasNext ? <>Next <Icon name="arrow-right" size={16} /></> : 'Close'}</> })}
      </div>
    </div>
  );
}
