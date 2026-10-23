/**
 * Finish (brief §3.7) — what Finish WOULD save, before anything is written.
 *
 *   eyebrow  // PUSH · DXC · ☾ NIGHT 80 %
 *   tiles    DURATION · VOLUME · SETS 17/19 · EXERCISES — 2×2 (value 28
 *            mono, label 12 mono; the 560 px dialog is too narrow for 4×1)
 *   ◆ N NEW BESTS · REAL SETS, one row each: "◆ Machine shoulder press ·
 *            82.5 × 8 (was 80 × 8) DXC" — a machine's against the workout's
 *            gym only; else "No new bests — PBs count real sets only".
 *   ☾ night  "Night session — compared with your last night Push" + the
 *            like-for-like deltas (never against a day, never red)
 *   ⚠        "2 sets aren't ticked — they won't be saved" (only if any)
 *   actions  [Save workout] · [Keep going] … Discard (danger text, asks first)
 *   after    "Workout saved", the tiles stay, Save as template (prefilled
 *            with the session name; started from a saved template →
 *            Update template · Keep original), then Done.
 * An estimate never appears as a win — at most ONE muted line
 * "est. 1RM ~221 → ~224 kg (Machine shoulder press)", no ◆, no gold.
 *
 * Phone: a bottom sheet (≤ 85 vh, internal scroll). Desktop: a centred
 * 560 px dialog (max 80 vh).
 *
 * After saving, one Track line: the trackers a finished workout ticks
 * ("Gym — ticked for today"), or, with none linked, a picker to point
 * one at Lifts (the same 'lifts' auto-fill rule Track offers). The tick
 * itself is written by useAutomations, never here.
 *
 * Three pages, swiped or stepped with ‹ › (owner, Oct 2026: "instead of
 * a long page to scroll down through … it starts with the body heatmap,
 * then the user taps right to navigate to the next page"):
 *   Body      the body map (BodyMap): where the sets went, each muscle
 *             filled by the share of its session target that was done —
 *             or, on its This week tab, of the week's target, this
 *             workout included.
 *   Muscles   the same as done / target rows, same tab and switch.
 *   Summary   the tiles, bests, night comparison and estimate; after
 *             saving, the tracker line and Save as template — Save lands
 *             here.
 * The unticked-sets warning sits above the pages, so it shows on all
 * three; the actions stay in the footer. Nothing ticked → no body map,
 * so no pages: the summary alone.
 *
 * Props: summary (summariseWorkout), saved, templateSaved, gymLabel, lifts
 * (the lift list, for the body map's muscle tags), S + today (the body
 * map's This week tab: the rota block's tally with this workout in it),
 * gymName(id), onSave, onKeepGoing, onDiscard, onSaveTemplate(name, { update }),
 * onClose, trackers, linked (trackers on a lifts/workout rule), dayLog
 * (S.logs for the workout's day), onLinkTracker(id).
 */
import { useEffect, useState } from 'react';
import Icon from '../../Icon';
import { Sheet, Button, PbMark, NightMark, Pager, SwipePage } from './ui';
import { clock, volumeText } from '../../../lib/lifts/workout';
import { realSetText, roundEstimate } from '../../../lib/lifts/ui';
import { perGymOf, fmtKg } from '../../../lib/lifts/lifts';
import BodyMap from './BodyMap';

const PAGES = [{ id: 'body', label: 'Body' }, { id: 'muscles', label: 'Muscles' }, { id: 'summary', label: 'Summary' }];

export default function FinishSheet({
  summary, saved, onSave, onKeepGoing, onDiscard, onSaveTemplate, onClose, templateSaved, gymLabel = null,
  trackers = [], linked = [], dayLog = {}, onLinkTracker = null, lifts = [], S = null, today = null,
}) {
  const [name, setName] = useState(summary ? summary.session.name : '');
  // The likeliest "gym" tracker first; the owner can pick any other.
  const [linkId, setLinkId] = useState(() => {
    const t = trackers.find(x => /\b(gym|lift|lifting|weights|train|training|workout)/i.test(String(x.name || ''))) || trackers[0];
    return t ? t.id : '';
  });
  const [asking, setAsking] = useState(false);
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(0);
  const [mapTab, setMapTab] = useState('workout');
  const [mapAll, setMapAll] = useState(false);
  const go = i => {
    if (i < 0 || i >= PAGES.length || i === page) return;
    setDir(i > page ? 1 : -1);
    setPage(i);
  };
  // Saving lands on Summary, where the template and tracker lines are.
  useEffect(() => { if (saved) go(PAGES.length - 1); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!summary) return null;
  const s = summary.session;
  const nothing = summary.setsDone === 0;
  const night = s.shift === 'night';
  const planned = summary.setsPlanned || summary.setsDone + summary.setsOpen;
  const eyebrow = ['//', String(s.name || 'Workout').toUpperCase(), gymLabel ? `· ${gymLabel}` : '', night ? '· ☾ NIGHT 80 %' : ''].filter(Boolean).join(' ');
  const title = saved ? 'Workout saved' : nothing ? 'Nothing ticked yet' : 'Finish workout';
  const tpl = summary.template;

  const footer = saved ? (
    <Button variant="primary" size="lg" block onClick={onClose} data-testid="lw-done">Done</Button>
  ) : (
    <div className="lw-fin-acts">
      <Button variant="primary" size="lg" block onClick={onSave} disabled={nothing} data-testid="lw-save">{nothing ? 'Tick a set to save' : 'Save workout'}</Button>
      <div className="lw-fin-row">
        <Button variant="secondary" onClick={onKeepGoing} data-testid="lw-keep">Keep going</Button>
        {asking ? (
          <span className="lw-confirm" role="alert">
            <Button variant="danger" onClick={onDiscard} data-testid="lw-discard-yes">Discard — nothing is saved</Button>
            <Button variant="quiet" onClick={() => setAsking(false)}>Keep</Button>
          </span>
        ) : (
          <Button variant="danger" onClick={() => setAsking(true)} data-testid="lw-discard">Discard…</Button>
        )}
      </div>
    </div>
  );

  const summaryPage = (
    <div className="lw-fin-sum">
      <dl className="lw-tiles">
        <div><dt>Duration</dt><dd>{clock(summary.durationSec)}</dd></div>
        <div><dt>Volume</dt><dd>{volumeText(summary.volume).replace(/ kg$/, '')}<span className="lw-tile-of"> kg</span></dd></div>
        <div><dt>Sets</dt><dd>{summary.setsDone}<span className="lw-tile-of">/{planned}</span></dd></div>
        <div><dt>Exercises</dt><dd>{summary.exercises}</dd></div>
      </dl>

      {summary.pbs.length > 0 ? (
        <section className="lw-fin-pbs" aria-label="New personal bests — real sets">
          <p className="lw-fin-pbh"><PbMark /> {summary.pbs.length} new {summary.pbs.length === 1 ? 'best' : 'bests'} · real sets</p>
          <ul>
            {summary.pbs.map((p, i) => (
              <li key={i} data-testid="lw-fin-pb">
                <PbMark />
                <span className="lw-fin-pbtxt">
                  <b>{p.lift.name}</b> · <span className="lf-num">{realSetText(p.entry.weight, p.entry.reps, p.lift)}</span>
                  {p.was && <span className="lw-fin-was"> (was {realSetText(p.was.weight, p.was.reps, p.lift)})</span>}
                </span>
                {perGymOf(p.lift) && gymLabel && <span className="lf-gymchip">{gymLabel}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : !nothing && <p className="lf-meta">No new bests — PBs count real sets only (heaviest, or a 1–12 rep max).</p>}

      {summary.night && (
        <section className="lw-fin-night" aria-label="Night session comparison">
          <p><NightMark /> Night session — compared with your last night {s.rotaSession || s.name}</p>
          <p className="lw-fin-deltas lf-num">{summary.night.lines.map(l => `${l.name} ${l.text}`).join(' · ')}</p>
        </section>
      )}
      {night && !summary.night && !nothing && (
        <p className="lf-meta"><NightMark /> Night session at 80 % — nothing to compare like for like yet.</p>
      )}

      {summary.estimate && (
        <p className="lw-fin-est">est. 1RM ~{fmtKg(roundEstimate(summary.estimate.from))} → ~{fmtKg(roundEstimate(summary.estimate.to))} kg ({summary.estimate.name})</p>
      )}

      {nothing && !saved && <p className="lf-meta">Only ticked sets are saved. Tick the sets you did, or discard this workout.</p>}

      {saved && (
        <div className="lw-fin-saved">
          <p className="lw-fin-ok"><Icon name="check" size={16} /> Saved — {summary.setsDone} {summary.setsDone === 1 ? 'set' : 'sets'} in your log.</p>
          {linked.length > 0 ? (
            <p className="lw-fin-ok" data-testid="lw-fin-track">
              <Icon name="check" size={16} /> {linked.map(t => t.name).join(', ')} {dayLog[linked[0].id] ? '— ticked on Track' : '— ticks on Track from Lifts'}
            </p>
          ) : onLinkTracker && trackers.length > 0 && (
            <div className="lw-fin-link" data-testid="lw-fin-link">
              <label className="lw-field" htmlFor="lw-link-tracker">
                <span className="lf-eyebrow">Tick a tracker when I finish a workout</span>
                <select id="lw-link-tracker" className="lf-cellbox lw-input" value={linkId} onChange={e => setLinkId(e.target.value)}>
                  {trackers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <Button variant="secondary" icon="check" disabled={!linkId} onClick={() => onLinkTracker(linkId)} data-testid="lw-link-on">Turn on</Button>
            </div>
          )}
          {templateSaved ? (
            <p className="lw-fin-ok" data-testid="lw-tpl-saved"><Icon name="check" size={16} /> {templateSaved}</p>
          ) : (
            <form className="lw-tplform" onSubmit={e => { e.preventDefault(); if (name.trim()) onSaveTemplate(name, { update: false }); }}>
              <label className="lw-field" htmlFor="lw-tpl-name">
                <span className="lf-eyebrow">Save as template</span>
                <input id="lw-tpl-name" className="lf-cellbox lw-input" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
              </label>
              {tpl ? (
                <div className="lw-fin-row">
                  <Button variant="secondary" onClick={() => onSaveTemplate(tpl.name, { update: true })} data-testid="lw-tpl-update">Update “{tpl.name}”</Button>
                  <Button variant="secondary" type="submit" disabled={!name.trim()} data-testid="lw-tpl-new">Keep original · save new</Button>
                </div>
              ) : (
                <Button variant="secondary" type="submit" icon="plus" disabled={!name.trim()} data-testid="lw-tpl-save">Save as template</Button>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Sheet title={title} eyebrow={eyebrow} onClose={saved ? onClose : onKeepGoing} footer={footer} testId="lw-finish" className="lw-finish" width={560}>
      <div className="lw-fin" data-testid="lw-summary">
        {!nothing && <Pager pages={PAGES} page={page} go={go} label="Finish pages" />}
        {!saved && summary.setsOpen > 0 && !nothing && (
          <p className="lw-fin-warn" data-testid="lw-fin-warn"><Icon name="triangle-alert" size={15} /> {summary.setsOpen} {summary.setsOpen === 1 ? 'set isn’t' : 'sets aren’t'} ticked — {summary.setsOpen === 1 ? 'it won’t' : 'they won’t'} be saved</p>
        )}
        {nothing ? summaryPage : (
          <SwipePage pages={PAGES} page={page} dir={dir} go={go}>
            {page < 2
              ? <BodyMap session={s} list={lifts} S={S} today={today} view={page === 0 ? 'figure' : 'rows'}
                         tab={mapTab} onTab={setMapTab} all={mapAll} onAll={setMapAll} />
              : summaryPage}
          </SwipePage>
        )}
      </div>
    </Sheet>
  );
}
