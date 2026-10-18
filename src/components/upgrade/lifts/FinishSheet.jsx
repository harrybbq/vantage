/**
 * Finish → the summary, before anything is written: duration, volume,
 * sets done, exercises, and the REAL-SET PBs this session hit ("New
 * best: Leg press 185 kg × 8 · new 8RM"). Sets that were never ticked
 * are named — they are not saved.
 *
 * Save writes the workout in one go (finishWorkout: log entries +
 * session + active cleared), then the sheet offers "Save as template".
 * Nothing ticked → there is nothing to save; Discard is offered (asks
 * first), and Keep going returns to the workout.
 */
import { useState } from 'react';
import { Sheet, ConfirmButton } from '../security/parts';
import Icon from '../../Icon';
import { clock, volumeText } from '../../../lib/lifts/workout';

export default function FinishSheet({ summary, saved, onSave, onKeepGoing, onDiscard, onSaveTemplate, onClose, templateSaved }) {
  const [name, setName] = useState(summary ? summary.session.name : '');
  if (!summary) return null;
  const nothing = summary.setsDone === 0;
  return (
    <Sheet title={saved ? 'Workout saved' : nothing ? 'Nothing ticked yet' : 'Finish workout'} eyebrow={`// ${summary.session.name}`}
           onClose={saved ? onClose : onKeepGoing} className="lifts wk-finish-sheet">
      <div className="wk-sum" data-testid="wk-summary">
        <dl className="wk-sum-grid">
          <div><dt>Duration</dt><dd>{clock(summary.durationSec)}</dd></div>
          <div><dt>Volume</dt><dd>{volumeText(summary.volume)}</dd></div>
          <div><dt>Sets done</dt><dd>{summary.setsDone}</dd></div>
          <div><dt>Exercises</dt><dd>{summary.exercises}</dd></div>
        </dl>

        {summary.pbs.length > 0 && (
          <section className="wk-sum-pbs" aria-label="Personal bests this session">
            <span className="sec-eyebrow"><Icon name="trophy" size={12} /> {summary.pbs.length === 1 ? 'A new best' : `${summary.pbs.length} new bests`} · real sets</span>
            <ul>
              {summary.pbs.map((p, i) => <li key={i} data-testid="wk-sum-pb"><Icon name="trophy" size={14} /> {p.text}</li>)}
            </ul>
          </section>
        )}
        {!nothing && !summary.pbs.length && <p className="lf-muted">No new bests this time — PBs count real sets only (heaviest, or a 1–12 rep max).</p>}
        {!saved && summary.setsOpen > 0 && !nothing && (
          <p className="wk-sum-warn"><Icon name="triangle-alert" size={14} /> {summary.setsOpen} {summary.setsOpen === 1 ? 'set isn’t' : 'sets aren’t'} ticked — {summary.setsOpen === 1 ? 'it won’t' : 'they won’t'} be saved.</p>
        )}
        {nothing && !saved && <p className="lf-muted">Only ticked sets are saved. Tick the sets you did, or discard this workout.</p>}

        {!saved && (
          <div className="lf-form-acts">
            {!nothing && <button type="button" className="sec-btn is-primary lf-btn-lg" onClick={onSave} data-testid="wk-save">Save workout</button>}
            <button type="button" className="sec-btn is-quiet lf-btn-lg" onClick={onKeepGoing}>Keep going</button>
            {nothing && <ConfirmButton label="Discard workout" confirmLabel="Yes, discard" onConfirm={onDiscard} className="lf-btn-lg" />}
          </div>
        )}
        {saved && (
          <>
            <p className="wk-sum-ok"><Icon name="check" size={15} /> Saved to your log — {summary.setsDone} {summary.setsDone === 1 ? 'set' : 'sets'} in your PB tables.</p>
            {templateSaved ? (
              <p className="wk-sum-ok"><Icon name="check" size={15} /> Saved as template “{templateSaved}” — it’s in Library.</p>
            ) : (
              <form className="wk-tpl-form" onSubmit={e => { e.preventDefault(); onSaveTemplate(name); }}>
                <label className="lf-field" htmlFor="wk-tpl-name">
                  <span className="lf-field-lbl">Save as template</span>
                  <input id="wk-tpl-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
                </label>
                <button type="submit" className="sec-btn lf-btn-lg" disabled={!name.trim()}><Icon name="plus" size={14} /> Save as template</button>
              </form>
            )}
            <div className="lf-form-acts">
              <button type="button" className="sec-btn is-primary lf-btn-lg" onClick={onClose} data-testid="wk-done">Done</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
