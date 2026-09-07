/**
 * Choosing what fills a tracker in for you.
 *
 * The app already knows a great deal it never used: a weight reading
 * arrived this morning, WHOOP logged a workout, last night was 7h20.
 * This is where a tracker is pointed at one of those, so it stops being
 * a thing to remember to tick.
 *
 * ── Why it is opt-in ─────────────────────────────────────────────────
 * Guessing which rule a tracker wants from its name is a trick that
 * works until it does not, and the failure is a tick appearing on a day
 * nothing happened — which is worse than no automation, because it is a
 * record that lies. So the user says which reading, and the bar it has
 * to clear, and can see what it would have done before agreeing.
 *
 * A source with no data behind it is shown, dimmed, saying what would
 * feed it — the same shape as the Add Widget picker, and for the same
 * reason: a dead option offered as a live one is a worse answer than an
 * explanation.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { backdropClose } from '../../utils/backdropClose';
import {
  AUTO_SOURCES, ruleFor, sourceHasData, proposeAutoLogs, BACKFILL_DAYS,
} from '../../lib/trackers/autoLog';

const NEEDS = {
  vitals: 'a weight, sleep or heart-rate source — WHOOP, Oura, Apple Health, or entered by hand',
  wearable: 'WHOOP or Oura connected',
  whoop: 'WHOOP connected',
  health: 'an Apple Health import',
};

export default function AutoFillModal({ tracker, S, update, onClose }) {
  const existing = ruleFor(tracker);
  const [sourceId, setSourceId] = useState(existing ? existing.source.id : '');
  const [threshold, setThreshold] = useState(existing && existing.threshold != null ? String(existing.threshold) : '');

  const source = AUTO_SOURCES.find(s => s.id === sourceId) || null;
  const wantsThreshold = !!(source && source.threshold != null && tracker.type === 'boolean');

  function pick(s) {
    setSourceId(s.id);
    setThreshold(s.threshold != null ? String(s.threshold) : '');
  }

  // What the rule would do to the last fortnight, worked out against a
  // copy of the state rather than described — the honest way to answer
  // "what will this do to my calendar".
  const preview = source
    ? proposeAutoLogs(
      { ...S, trackers: [{ ...tracker, auto: { source: sourceId, threshold: Number(threshold) } }] },
      {},
    ).length
    : 0;

  function save() {
    update(prev => ({
      ...prev,
      trackers: (prev.trackers || []).map(t => {
        if (t.id !== tracker.id) return t;
        if (!sourceId) { const { auto, ...rest } = t; return rest; }
        const n = parseFloat(threshold);
        return { ...t, auto: { source: sourceId, threshold: Number.isFinite(n) ? n : null } };
      }),
    }));
    onClose();
  }

  return createPortal(
    <div className="modal-overlay open" {...backdropClose(onClose)}>
      <div className="modal af-modal" role="dialog" aria-label={`Fill ${tracker.name} automatically`}>
        <h3>Fill “{tracker.name}” in for me</h3>
        <p className="af-lead">
          Point this tracker at something the app already receives. It only ever fills
          days you left empty — anything you tick, untick or type stays exactly as you left it.
        </p>

        <div className="af-list" role="radiogroup" aria-label="Source">
          <button
            type="button" role="radio" aria-checked={!sourceId}
            className={`af-opt${!sourceId ? ' is-on' : ''}`}
            onClick={() => { setSourceId(''); setThreshold(''); }}
          >
            <span className="af-opt-title">Off — I’ll log it myself</span>
          </button>

          {AUTO_SOURCES.map(s => {
            const live = sourceHasData(S, s);
            return (
              <button
                key={s.id} type="button" role="radio" aria-checked={sourceId === s.id}
                className={`af-opt${sourceId === s.id ? ' is-on' : ''}${live ? '' : ' is-dim'}`}
                onClick={() => pick(s)}
              >
                <span className="af-opt-title">
                  {s.label}
                  {s.threshold != null && tracker.type === 'boolean' && sourceId !== s.id && (
                    <span className="af-opt-th"> {s.threshold}{s.unit}</span>
                  )}
                </span>
                <span className="af-opt-hint">{live ? s.hint : `Needs ${NEEDS[s.needs] || 'a connected source'}.`}</span>
              </button>
            );
          })}
        </div>

        {wantsThreshold && (
          <div className="af-th">
            <label htmlFor="af-threshold">{source.label}</label>
            <input
              id="af-threshold" type="number" inputMode="decimal"
              step={source.step || 1} min="0" max={source.max}
              value={threshold}
              onChange={e => setThreshold(e.target.value)}
            />
            <span className="af-th-unit">{source.unit}</span>
          </div>
        )}

        {source && tracker.type !== 'boolean' && (
          <p className="af-note">
            This is a number tracker, so it records the reading itself rather than a tick.
          </p>
        )}

        {source && (
          <p className="af-note">
            {/* "Empty" is doing real work here. Zero usually means the
                matching days are already logged, not that nothing
                matches — saying "nothing matches" would be a lie about
                data sitting on the calendar behind this modal. */}
            {preview === 0
              ? `No empty days in the last ${BACKFILL_DAYS} for this to fill — it fills them as readings arrive.`
              : `Would fill ${preview} empty day${preview === 1 ? '' : 's'} in the last ${BACKFILL_DAYS}.`}
          </p>
        )}

        <div className="af-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
