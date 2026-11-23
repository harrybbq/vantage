/**
 * Goals on a phone, console design: "Next up" (owner, 2026-11-23, from
 * the "Goals on a Phone" mockup, option A). The desktop board and
 * classic's phone player are untouched.
 *
 * AchievementsSection mounts this in place of its path player when it is
 * given one (`phoneGoals`), and hands it the SAME handlers the board and
 * the player use (complete, edit, link, delete), so what finishing or
 * linking a goal does cannot differ between views. The arrangement comes
 * from lib/achievements/goalsList.js:
 *
 *   summary   "5 of 22 done · 10 you can do now" and Honours; New goal is
 *             the + in the app's bar, where the calendar's Add is
 *   Next up   every goal that can be finished now, across all paths:
 *             its path and step, what it pays, and a tick on the row
 *   Paths     one card a path, named by where it ends, with its steps
 *   Waiting   goals still locked behind another (folded)
 *   Done      finished goals, newest first (folded)
 *
 * Tap any goal for its sheet: state, description, tracker progress, its
 * whole path as a trail (tap a step to move to it), then Mark complete,
 * Edit, Link and Delete as buttons. Nothing is behind a long press.
 *
 * A tick completes at once, as the player's button did, and offers Undo
 * for a few seconds (the same toggle; it refunds the coins).
 *
 * Linking keeps the section's two-step rule: Link on a goal makes it the
 * one that comes first, then the page becomes a picker for what it
 * unlocks. An existing link unlinks; a loop is refused (and marked).
 *
 * Writes nothing itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import SectionHelp from '../../../components/SectionHelp';
import LinkProgress from '../../../components/achievements/LinkProgress';
import { Button, Sheet } from '../ui';
import TopBarActions from '../shell/TopBarActions';
import { goalsView } from '../../../lib/achievements/goalsList';
import { wouldCycle } from '../../../lib/achievements/pathPlayer';
import './goals-phone.css';

const CATS = { finance: 'Finance', fitness: 'Fitness', brain: 'Brain', social: 'Social', general: 'General' };
const WORD = { completed: 'Done', locked: 'Locked', active: 'Open' };
const UNDO_MS = 7000;
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-GB');

function GoalIcon({ goal }) {
  return <span className="cx-gl-ico" aria-hidden="true">{goal.icon || <Icon name="star" size={15} strokeWidth={1.75} />}</span>;
}

/** One goal as a row: tap the row for its sheet; `action` is the control at its end. */
function GoalRow({ goal, sub, state, prog = null, onOpen, action = null }) {
  return (
    <li className={`cx-gl-row is-${state}`} data-goal={goal.id}>
      <button type="button" className="cx-gl-row-main" onClick={onOpen}>
        <GoalIcon goal={goal} />
        <span className="cx-gl-row-text">
          <span className="cx-gl-row-name">{goal.name}</span>
          <span className="cx-gl-row-sub">{sub}{prog && !prog.missing ? ` · ${prog.done}/${prog.target}` : ''}</span>
        </span>
        {!!goal.coins && <span className="cx-gl-coins cx-num" aria-label={`${goal.coins} coins`}>{fmt(goal.coins)}</span>}
      </button>
      {action}
    </li>
  );
}

function Fold({ title, count, open, onToggle, children, testId }) {
  return (
    <section className="cx-gl-sec">
      <button type="button" className="cx-gl-fold" aria-expanded={open} onClick={onToggle} data-testid={testId}>
        <span className="cx-gl-h">{title}</span><span className="cx-gl-n cx-num">{count}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} strokeWidth={1.75} />
      </button>
      {open && children}
    </section>
  );
}

/** A path's steps as a bar of segments: gold done, accent open, grey locked. */
function Steps({ states }) {
  return <span className="cx-gl-steps" aria-hidden="true">{states.map((s, i) => <i key={i} className={`is-${s}`} />)}</span>;
}

function GoalSheet({ goal, view, prog, onClose, onGo, onComplete, onEdit, onLink, onDelete }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { setSure(false); }, [goal.id]);
  const state = view.state(goal);
  const w = view.at(goal.id);
  const needs = state === 'locked' ? (view.locked.find(x => x.goal.id === goal.id)?.needs || []) : [];
  const footer = state === 'active'
    ? <Button variant="primary" block icon="check" onClick={() => onComplete(goal)} data-testid="cx-gl-complete">Mark complete</Button>
    : state === 'completed'
      ? <Button block icon="rotate-ccw" onClick={() => onComplete(goal)} data-testid="cx-gl-undo-complete">Completed · undo</Button>
      : <Button block disabled>Locked{needs.length ? ` · finish ${needs[0].name} first` : ''}</Button>;
  return (
    <Sheet title={goal.name} eyebrow={w ? `${w.path.name} · step ${w.step} of ${w.of}` : 'On its own'} onClose={onClose} footer={footer} testId="cx-gl-sheet" className="cx-gl-sheet">
      <div className="cx-gl-sheet-in">
        <div className="cx-gl-tags">
          <span className={`cx-gl-tag is-${state}`}>{WORD[state]}</span>
          {goal.category && <span className="cx-gl-tag">{CATS[goal.category] || goal.category}</span>}
          {!!goal.coins && <span className="cx-gl-tag is-coins cx-num">{fmt(goal.coins)} coins</span>}
        </div>
        {goal.desc && <p className="cx-gl-desc">{goal.desc}</p>}
        {!goal.completed && prog && <LinkProgress prog={prog} claim="tap Mark complete to claim it" />}
        {w && (
          <div className="cx-gl-trailbox">
            <p className="cx-gl-trail-h">{w.path.name} <span className="cx-num">{w.path.done}/{w.path.total}</span></p>
            <ol className="cx-gl-trail">
              {w.path.queue.map((g, i) => {
                const s = w.path.states[i];
                const here = g.id === goal.id;
                return (
                  <li key={g.id} className={`is-${s}${here ? ' is-here' : ''}`}>
                    <button type="button" onClick={() => !here && onGo(g.id)} aria-current={here ? 'step' : undefined} disabled={here}>
                      <span className="cx-gl-node" aria-hidden="true">{s === 'completed' && <Icon name="check" size={12} strokeWidth={3} />}</span>
                      <span className="cx-gl-trail-name">{g.name}</span>
                      <span className="cx-gl-trail-st">{here ? 'You are here' : WORD[s]}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <div className="cx-gl-acts">
          <Button icon="pencil" onClick={() => onEdit(goal)} data-testid="cx-gl-edit">Edit</Button>
          <Button icon="waypoints" onClick={() => onLink(goal)} data-testid="cx-gl-link">Link</Button>
          {sure
            ? <Button variant="danger" onClick={() => onDelete(goal)} data-testid="cx-gl-delete-yes">Delete it</Button>
            : <Button variant="danger" icon="trash-2" onClick={() => setSure(true)} data-testid="cx-gl-delete">Delete</Button>}
        </div>
        {sure && <p className="cx-gl-sure" role="alert">This removes the goal and its links. Coins already paid stay. Tap Delete it to confirm.</p>}
      </div>
    </Sheet>
  );
}

export default function GoalsPhone({
  achievements = [], connections = [], linkProg = {}, connectingFrom = null,
  onComplete, onEdit, onConnect, onDelete, onCancelConnect, onNew, onOpenVisions,
  visions = null, credit = null,
}) {
  const view = useMemo(() => goalsView(achievements, connections), [achievements, connections]);
  const [openId, setOpenId] = useState(null);
  const [showLocked, setShowLocked] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [undo, setUndo] = useState(null);     // { id, name, n }
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const byId = id => achievements.find(a => a.id === id) || null;
  const open = openId ? byId(openId) : null;
  const from = connectingFrom ? byId(connectingFrom) : null;

  const complete = goal => {
    const was = goal.completed;
    onComplete?.(goal.id);
    setOpenId(null);
    clearTimeout(timer.current);
    if (was) { setUndo(null); return; }
    setUndo({ id: goal.id, name: goal.name, n: Date.now() });
    timer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const undoIt = () => { if (undo) onComplete?.(undo.id); clearTimeout(timer.current); setUndo(null); };

  if (!achievements.length) {
    return (
      <div className="cx-gl cx-gl-empty">
        <Icon name="target" size={28} strokeWidth={1.5} />
        <p className="cx-gl-empty-t">No goals yet</p>
        <p className="cx-gl-empty-s">Add one thing you want to get done. Link goals later to make a path.</p>
        <Button variant="primary" icon="plus" onClick={onNew} data-ob="add-goal" data-testid="cx-gl-new">Add a goal</Button>
      </div>
    );
  }

  // ── Linking: the page becomes a picker for what the chosen goal unlocks ──
  if (from) {
    const linked = new Set(connections.filter(c => c[0] === from.id).map(c => c[1]));
    return (
      <div className="cx-gl is-linking" data-testid="cx-gl-linking">
        <div className="cx-gl-linkbar" role="status">
          <p><b>{from.name}</b> comes first. Tap the goal it unlocks.</p>
          <Button onClick={onCancelConnect} data-testid="cx-gl-link-cancel">Cancel</Button>
        </div>
        <ul className="cx-gl-list">
          {achievements.filter(g => g.id !== from.id).map(g => {
            const on = linked.has(g.id);
            const loop = !on && wouldCycle(connections, from.id, g.id);
            return (
              <li key={g.id} className={`cx-gl-row is-pick${on ? ' is-linked' : ''}`}>
                <button type="button" className="cx-gl-row-main" onClick={() => onConnect?.(g.id)} disabled={loop} data-pick={g.id}>
                  <GoalIcon goal={g} />
                  <span className="cx-gl-row-text">
                    <span className="cx-gl-row-name">{g.name}</span>
                    <span className="cx-gl-row-sub">{on ? 'Linked · tap to unlink' : loop ? 'Would loop back on itself' : WORD[view.state(g)]}</span>
                  </span>
                  {on && <Icon name="check" size={16} strokeWidth={2.4} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const sub = e => (e.path ? `${e.path.name} · step ${e.step} of ${e.of}` : 'On its own');
  return (
    <div className="cx-gl" data-testid="cx-gl">
      <header className="cx-gl-sum">
        <div className="cx-gl-sum-text">
          <p><b className="cx-num">{view.done} of {view.total}</b> done{view.next.length ? <> · <span className="cx-num">{view.next.length}</span> you can do now</> : null}</p>
          <span className="cx-gl-prog" role="progressbar" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done} aria-label="Goals done">
            <i style={{ width: `${Math.round(view.pct * 100)}%` }} />
          </span>
        </div>
        {onOpenVisions && (
          <Button onClick={onOpenVisions} className="cx-gl-hon" data-testid="cx-gl-honours">
            Honours{visions ? <span className="cx-num cx-gl-hon-n">{visions.unlocked}/{visions.total}</span> : null}
          </Button>
        )}
      </header>
      {/* New sits in the app's bar, as Add does on the calendar: the summary row keeps its one line. */}
      <TopBarActions placement="end">
        <Button variant="primary" icon="plus" iconOnly label="New goal" onClick={onNew} data-ob="add-goal" data-testid="cx-gl-new" />
      </TopBarActions>

      <section className="cx-gl-sec">
        <h2 className="cx-gl-head"><span className="cx-gl-h">Next up</span><span className="cx-gl-n cx-num">{view.next.length}</span></h2>
        {view.next.length ? (
          <ul className="cx-gl-list" data-testid="cx-gl-next">
            {view.next.map(e => (
              <GoalRow key={e.goal.id} goal={e.goal} sub={sub(e)} state="active" prog={linkProg[e.goal.id]} onOpen={() => setOpenId(e.goal.id)}
                       action={(
                         <button type="button" className="cx-gl-tick" onClick={() => complete(e.goal)} aria-label={`Mark ${e.goal.name} complete`} data-testid="cx-gl-tick">
                           <Icon name="check" size={18} strokeWidth={2.6} />
                         </button>
                       )} />
            ))}
          </ul>
        ) : (
          <p className="cx-gl-quiet">{view.locked.length ? 'Nothing is open right now. Everything left is waiting on another goal.' : 'Everything is done. Add the next thing you want.'}</p>
        )}
      </section>

      {view.paths.length > 0 && (
        <section className="cx-gl-sec">
          <h2 className="cx-gl-head"><span className="cx-gl-h">Paths</span><span className="cx-gl-n cx-num">{view.paths.length}</span></h2>
          <ul className="cx-gl-paths" data-testid="cx-gl-paths">
            {view.paths.map(p => {
              const target = p.next || p.queue[p.queue.length - 1];
              return (
                <li key={p.key}>
                  <button type="button" className={`cx-gl-path${p.pct >= 1 ? ' is-done' : ''}`} onClick={() => setOpenId(target.id)} data-path={p.key}>
                    <span className="cx-gl-path-top"><span className="cx-gl-path-name">{p.name}</span><span className="cx-num cx-gl-path-n">{p.done}/{p.total}</span></span>
                    <Steps states={p.states} />
                    <span className="cx-gl-path-next">{p.pct >= 1 ? 'Path complete' : p.next ? <>Next: <b>{p.next.name}</b></> : 'Waiting on a locked step'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view.locked.length > 0 && (
        <Fold title="Waiting" count={view.locked.length} open={showLocked} onToggle={() => setShowLocked(v => !v)} testId="cx-gl-fold-locked">
          <ul className="cx-gl-list">
            {view.locked.map(e => (
              <GoalRow key={e.goal.id} goal={e.goal} state="locked" onOpen={() => setOpenId(e.goal.id)}
                       sub={e.needs.length ? `Needs ${e.needs.map(g => g.name).join(', ')}` : 'Locked'} />
            ))}
          </ul>
        </Fold>
      )}

      {view.finished.length > 0 && (
        <Fold title="Done" count={view.finished.length} open={showDone} onToggle={() => setShowDone(v => !v)} testId="cx-gl-fold-done">
          <ul className="cx-gl-list">
            {view.finished.map(g => {
              const w = view.at(g.id);
              return <GoalRow key={g.id} goal={g} state="completed" onOpen={() => setOpenId(g.id)} sub={w ? `${w.path.name} · step ${w.step} of ${w.of}` : 'On its own'} />;
            })}
          </ul>
        </Fold>
      )}

      {credit && (
        <div className="cx-gl-credit">
          <span><b className="cx-num">{credit.atFullCredit}/{credit.fullCredit}</b> count in full toward your rating</span>
          <SectionHelp
            title="Rating credit"
            rows={[
              { term: 'Full credit', def: `The first ${credit.fullCredit} completed count in full.` },
              { term: 'After that', def: 'Each one is worth less than the last, so bulk-adding gains little.' },
              { term: `${credit.spacingDays}-day rule`, def: `Finish something within ${credit.spacingDays} days of creating it and it counts nothing.` },
            ]}
            foot={credit.pending > 0
              ? `${credit.pending} of yours are waiting out the ${credit.spacingDays} days.`
              : 'Make as many as you like — this only affects your rating.'}
          />
        </div>
      )}

      {undo && (
        <div className="cx-gl-undo" role="status" data-testid="cx-gl-undo">
          <span><b>{undo.name}</b> done</span>
          <button type="button" onClick={undoIt}>Undo</button>
        </div>
      )}

      {open && (
        <GoalSheet goal={open} view={view} prog={linkProg[open.id]} onClose={() => setOpenId(null)} onGo={setOpenId}
                   onComplete={complete}
                   onEdit={g => { setOpenId(null); onEdit?.(g.id); }}
                   onLink={g => { setOpenId(null); onConnect?.(g.id); }}
                   onDelete={g => { setOpenId(null); onDelete?.(g.id); }} />
      )}
    </div>
  );
}
