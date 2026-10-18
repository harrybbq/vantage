/**
 * The number pad (touch screens only): docked at the bottom of the
 * screen, no backdrop — the set table above stays live, so tapping
 * another cell moves the pad to it. Digits, backspace, "." (not for
 * reps), ± a step (±1 reps, ±2.5 kg, ±1 per dumbbell, ±0.5 RPE), an RPE
 * chip row 5–10, Next (reps → kg → the next set) and Done.
 *
 * The first key after landing on a field replaces its value, as a
 * keyboard's select-all would; after that keys append. Every key is
 * written straight through (the save is debounced upstream), so the
 * workout is persisted as it is typed.
 */
import Icon from '../../Icon';
import { RPE_CHIPS } from '../../../lib/lifts/workout';

const LABEL = { reps: 'Reps', weight: 'KG', rpe: 'RPE' };

export default function NumPad({ field, title, value, rpe, step, onKey, onStep, onRpe, onNext, onDone, hasNext }) {
  const key = (k, label, extra = {}) => (
    <button type="button" className={`wk-key${extra.cls ? ` ${extra.cls}` : ''}`} onClick={() => onKey(k)} aria-label={label || k}
            disabled={extra.disabled} data-key={k}>
      {extra.icon || k}
    </button>
  );
  const stepTxt = String(step).replace('.0', '');
  return (
    <div className="wk-pad" role="group" aria-label={`Number pad · ${title} · ${LABEL[field]}`} data-testid="wk-pad">
        <div className="wk-pad-head">
          <span className="wk-pad-field"><b>{LABEL[field]}</b> <span>{title}</span></span>
          <span className="wk-pad-val" aria-live="polite">{value === '' || value == null ? '—' : value}</span>
        </div>
        <div className="wk-rpe" role="group" aria-label="RPE for this set">
          {RPE_CHIPS.map(n => (
            <button key={n} type="button" className={`wk-rpe-chip r${n}${Number(rpe) === n ? ' is-on' : ''}`} aria-pressed={Number(rpe) === n} onClick={() => onRpe(n)}>
              {n}
            </button>
          ))}
          <span className="wk-rpe-lbl" aria-hidden="true">RPE</span>
        </div>
        <div className="wk-keys">
          {key('1')}{key('2')}{key('3')}
          {key('back', 'Backspace', { icon: <Icon name="delete" size={20} />, cls: 'is-fn' })}
          {key('4')}{key('5')}{key('6')}
          <button type="button" className="wk-key is-fn" onClick={() => onStep(1)} aria-label={`Up ${stepTxt}`}>+{stepTxt}</button>
          {key('7')}{key('8')}{key('9')}
          <button type="button" className="wk-key is-fn" onClick={() => onStep(-1)} aria-label={`Down ${stepTxt}`}>−{stepTxt}</button>
          {key('.', 'Decimal point', { disabled: field === 'reps' })}
          {key('0')}
          <button type="button" className="wk-key is-fn is-next" onClick={onNext} aria-label={hasNext ? 'Next field' : 'Close pad'}>
            {hasNext ? <>Next <Icon name="arrow-right" size={15} /></> : 'Close'}
          </button>
          <button type="button" className="wk-key is-done" onClick={onDone} aria-label="Done" data-testid="wk-pad-done">
            <Icon name="check" size={20} strokeWidth={2.4} />
          </button>
      </div>
    </div>
  );
}
