/**
 * Shift pattern — the rota as something that can change.
 *
 * Shows the cycle in force today as a row of blocks, the versions
 * before and after it, and an editor that adds a new version from a
 * chosen date. A change only ever applies from its date forward: the
 * past keeps the pattern it was worked on (lib/rotation/pattern.js,
 * S.rotation.schedule), so changing rota never redraws history.
 *
 * Owner-only like the rest of the Rotation tab. Writes go through the
 * pure updaters in pattern.js, which touch `rotation.schedule` alone.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import {
  SCHEDULE_LIMITS, SHIFT_KINDS, chipText, cleanCycle, cycleLength, cycleShape, cycleSummary,
  isRealIso, patternDay, removeScheduleVersion, scheduleOf, setScheduleFrom,
} from '../../lib/rotation/pattern';

const SHIFT_NAME = { night: 'Night', day: 'Day', off: 'Off' };
const SHORT = { night: 'N', day: 'D', off: 'off' };
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const fmtDate = iso => new Date(iso + 'T12:00:00Z')
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The cycle as proportional coloured blocks: N×4 · off×4 · D×4 · off×4. */
function CycleStrip({ cycle, small }) {
  return (
    <div className={'upg-pat-strip' + (small ? ' is-small' : '')} role="img"
         aria-label={cycleSummary(cycle)}>
      {cycle.map((b, i) => (
        <span key={i} className={`upg-pat-blk is-${b.shift}`} style={{ flexGrow: b.days }}>
          {SHORT[b.shift]}×{b.days}
        </span>
      ))}
    </div>
  );
}

/** Four weeks from `from` under a proposed schedule — what Save would draw. */
function Preview({ schedule, from }) {
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => {
    const iso = addDays(from, i);
    const [y, m, d] = iso.split('-').map(Number);
    const r = patternDay(y, m - 1, d, schedule);
    return { iso, d, dow: DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], ...r };
  }), [schedule, from]);
  return (
    <div className="upg-pat-preview" aria-label="Four-week preview">
      {days.map(c => (
        <div key={c.iso} className={`upg-pat-day is-${c.inPattern ? c.shift : 'none'}`}
             title={`${c.iso}: ${c.shift === 'off' ? 'Off' : chipText(c)} · ${c.session}`}>
          <span className="upg-pat-dow">{c.dow}</span>
          <span className="upg-pat-dt">{c.d}</span>
          <span className="upg-pat-chip">{c.inPattern ? (chipText(c) || 'off') : '—'}</span>
          <span className="upg-pat-sess">{c.session === 'Rest' ? '·' : c.session.slice(0, 2)}</span>
        </div>
      ))}
    </div>
  );
}

function Editor({ S, update, current, today, onClose }) {
  const [from, setFrom] = useState(today);
  const [blocks, setBlocks] = useState(() => current.cycle.map(b => ({ ...b })));
  const [note, setNote] = useState('');

  const total = cycleLength(blocks);
  const clean = cleanCycle(blocks);
  const fromOk = isRealIso(from);
  const valid = !!clean && fromOk;
  const existing = scheduleOf(S).versions.find(v => v.from === from);
  // What Save would produce, applied to a throwaway copy — the preview is
  // the real derivation, not a separate drawing of it.
  const proposed = useMemo(
    () => (valid ? scheduleOf(setScheduleFrom(S, from, clean, note, { id: 'preview' })) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S.rotation, from, JSON.stringify(clean), valid]);

  const setBlock = (i, patch) => setBlocks(bs => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const move = (i, dir) => setBlocks(bs => {
    const j = i + dir;
    if (j < 0 || j >= bs.length) return bs;
    const next = bs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = i => setBlocks(bs => (bs.length > 1 ? bs.filter((_, j) => j !== i) : bs));
  const add = () => setBlocks(bs => (bs.length < SCHEDULE_LIMITS.maxBlocks
    ? [...bs, { shift: bs.length && bs[bs.length - 1].shift === 'off' ? 'night' : 'off', days: 4 }] : bs));

  const problem = !fromOk ? 'Pick the date the new pattern starts.'
    : total > SCHEDULE_LIMITS.maxTotal ? `A cycle can be at most ${SCHEDULE_LIMITS.maxTotal} days — this one is ${total}.`
    : !clean ? 'Each block needs 1–28 days.'
    : null;

  function save() {
    if (!valid) return;
    update(prev => setScheduleFrom(prev, from, clean, note));
    onClose();
  }

  return (
    <div className="upg-pat-editor">
      <div className="upg-pat-row">
        <label className="upg-pat-field">
          <span>Starts on</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <span className="upg-pat-hint">
          Day 1 of the new cycle. Dates before it keep the pattern they had.
        </span>
      </div>
      {fromOk && from < today && (
        <div className="upg-pat-warn">
          <Icon name="triangle-alert" size={12} /> That date is in the past — days from {fmtDate(from)} to today will be redrawn.
        </div>
      )}

      <div className="upg-pat-blocks">
        {blocks.map((b, i) => (
          <div key={i} className={`upg-pat-brow is-${b.shift}`}>
            <span className="upg-pat-bn">{i + 1}</span>
            <select value={b.shift} aria-label={`Block ${i + 1} shift`}
                    onChange={e => setBlock(i, { shift: e.target.value })}>
              {SHIFT_KINDS.map(k => <option key={k} value={k}>{SHIFT_NAME[k]}</option>)}
            </select>
            <div className="upg-pat-step" role="group" aria-label={`Block ${i + 1} days`}>
              <button type="button" onClick={() => setBlock(i, { days: Math.max(1, b.days - 1) })}
                      disabled={b.days <= 1} aria-label="One day fewer">−</button>
              <span>{b.days}<i className="upg-pat-unit"> day{b.days === 1 ? '' : 's'}</i></span>
              <button type="button" onClick={() => setBlock(i, { days: Math.min(SCHEDULE_LIMITS.maxBlockDays, b.days + 1) })}
                      disabled={b.days >= SCHEDULE_LIMITS.maxBlockDays} aria-label="One day more">+</button>
            </div>
            <div className="upg-pat-bact">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down">↓</button>
              <button type="button" onClick={() => remove(i)} disabled={blocks.length <= 1} aria-label="Remove block">✕</button>
            </div>
          </div>
        ))}
        <button type="button" className="upg-opt upg-pat-add" onClick={add}
                disabled={blocks.length >= SCHEDULE_LIMITS.maxBlocks}>+ Add block</button>
      </div>

      <div className="upg-pat-sum">
        <CycleStrip cycle={blocks.filter(b => b.days > 0)} small />
        <span className={'upg-pat-total' + (total > SCHEDULE_LIMITS.maxTotal ? ' is-bad' : '')}>{total}-day cycle</span>
      </div>

      {proposed && <Preview schedule={proposed} from={from} />}

      <label className="upg-pat-field is-wide">
        <span>Note</span>
        <input type="text" maxLength={120} value={note} onChange={e => setNote(e.target.value)}
               placeholder="Optional — e.g. new team" />
      </label>

      {problem && <div className="upg-pat-warn">{problem}</div>}
      <div className="upg-pat-actions">
        <button type="button" className="upg-textbtn" onClick={onClose}>Cancel</button>
        <button type="button" className="link-open-btn" onClick={save} disabled={!valid}>
          {existing ? `Replace pattern from ${fmtDate(from)}` : `Save — from ${fmtDate(from)}`}
        </button>
      </div>
    </div>
  );
}

export default function ShiftPatternCard({ S, update, schedule, today }) {
  const [editing, setEditing] = useState(false);
  const versions = schedule.versions;
  const shape = cycleShape(schedule, today);
  const current = versions.find(v => v.from === shape.from) || versions[0];
  const upcoming = versions.find(v => v.from > today);

  function del(v) {
    if (!window.confirm(`Remove the pattern from ${fmtDate(v.from)}? Those dates go back to the pattern before it.`)) return;
    update(prev => removeScheduleVersion(prev, v.id));
  }

  return (
    <section className="upg-card upg-pat">
      <div className="upg-card-head">
        <h3>Shift pattern</h3>
        <span className="upg-card-sub">since {fmtDate(current.from)} · {shape.len}-day cycle</span>
      </div>
      <CycleStrip cycle={current.cycle} />
      <div className="upg-pat-line">
        {cycleSummary(current.cycle)} · {shape.train} sessions every {shape.len} days
        {current.note && <> · <i>{current.note}</i></>}
      </div>
      {upcoming && (
        <div className="upg-pat-next">
          <Icon name="calendar-days" size={12} /> <span>Changes on <b>{fmtDate(upcoming.from)}</b></span>
          <span>→ {cycleSummary(upcoming.cycle)}</span>
        </div>
      )}

      {versions.length > 1 && (
        <ul className="upg-pat-versions">
          {versions.map((v, i) => {
            const isCur = v === current;
            return (
              <li key={v.id} className={isCur ? 'is-current' : v.from > today ? 'is-future' : 'is-past'}>
                <span className="upg-pat-vfrom">from {fmtDate(v.from)}</span>
                <span className="upg-pat-vsum">{cycleSummary(v.cycle)}{v.note ? ` — ${v.note}` : ''}</span>
                {isCur && <span className="upg-pat-tag">now</span>}
                {!isCur && v.from > today && <span className="upg-pat-tag is-future">next</span>}
                {/* The first version is what every earlier date is drawn
                    from — removing it would empty the past, so it can be
                    replaced (same start date) but not deleted. */}
                {i > 0 && (
                  <button type="button" className="upg-block-x" aria-label={`Remove the pattern from ${fmtDate(v.from)}`}
                          onClick={() => del(v)}>✕</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <Editor S={S} update={update} current={upcoming || current} today={today} onClose={() => setEditing(false)} />
      ) : (
        <button type="button" className="upg-opt upg-pat-open" onClick={() => setEditing(true)}>
          <Icon name="pencil" size={12} /> Change pattern
        </button>
      )}
    </section>
  );
}
