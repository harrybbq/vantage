/**
 * Practice — a curriculum, not a diary.
 *
 * The first version only recorded whatever you happened to do, which
 * means it could tell you what you had done and never what to do next.
 * This hands you actual problems: the Blind 75 for LeetCode (links out
 * — the statements are LeetCode's, not ours) and a written-from-scratch
 * KQL set against real Sentinel and Defender tables.
 *
 * Selection logic lives in lib/career/problems.js and is asserted on
 * directly. The opinion it encodes: finish what you started, repair what
 * you got wrong, work the weakest topic, and only then start something
 * new.
 *
 * Progress is one new key, S.practice.progress, keyed by problem id.
 * The free-form log from before is untouched and still reachable — it
 * is where anything outside the curriculum goes.
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import {
  ALL_PROBLEMS, SHAKY, isDue, nextUp, progressOf, summarise,
} from '../../lib/career/problems';

const KINDS = [{ id: 'leetcode', label: 'LeetCode' }, { id: 'kql', label: 'KQL' }];
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'due', label: 'Due' },
  { id: 'todo', label: 'To do' },
  { id: 'attempted', label: 'Started' },
  { id: 'solved', label: 'Solved' },
];
const today = () => new Date().toISOString().slice(0, 10);

export default function PracticePanel({ S, update, onOpenLog }) {
  const [kind, setKind] = useState('leetcode');
  const [filter, setFilter] = useState('all');
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);   // problem | null

  const stats = useMemo(() => summarise(S, kind), [S, kind]);
  const suggestions = useMemo(() => nextUp(S, kind, 3), [S, kind]);

  /**
   * Record an attempt. Writes progress AND appends to the free-form log,
   * so the two surfaces agree — the streak and history you already had
   * keep counting, they just no longer need typing by hand.
   */
  function record(problem, patch) {
    update(prev => {
      const practice = prev.practice || {};
      const progress = { ...(practice.progress || {}) };
      const before = progress[problem.id] || { status: 'todo', confidence: 0, attempts: 0 };
      const next = { ...before, ...patch, lastAt: today() };
      if (patch.status && patch.status !== before.status) next.attempts = (before.attempts || 0) + 1;
      progress[problem.id] = next;

      let log = practice.log || [];
      // One log row per problem per day: marking, then re-rating, then
      // adding a note should read as one session, not three.
      if (patch.status) {
        const key = `auto:${problem.id}:${today()}`;
        log = log.filter(r => r.id !== key).concat([{
          id: key, kind: problem.kind, name: problem.title,
          topic: problem.topic, difficulty: problem.difficulty,
          date: today(), confidence: next.confidence || 0,
          notes: next.notes || '', url: problem.url || '',
        }]);
      }
      return { ...prev, practice: { ...practice, progress, log } };
    });
    setOpen(o => (o && o.id === problem.id ? o : o));
  }

  const needle = q.trim().toLowerCase();
  const rows = ALL_PROBLEMS
    .filter(p => p.kind === kind)
    .filter(p => !topic || p.topic === topic)
    .filter(p => !needle || `${p.title} ${p.topic} ${p.pattern}`.toLowerCase().includes(needle))
    .filter(p => {
      if (filter === 'all') return true;
      const pr = progressOf(S, p.id);
      if (filter === 'due') return isDue(pr);
      return pr.status === filter;
    });

  return (
    <>
      <div className="upg-subnav is-inner">
        {KINDS.map(k => (
          <button key={k.id} type="button" className={'upg-subtab' + (kind === k.id ? ' is-on' : '')}
                  onClick={() => { setKind(k.id); setTopic(''); }}>{k.label}</button>
        ))}
        <button type="button" className="upg-textbtn" style={{ marginLeft: 'auto' }} onClick={onOpenLog}>
          Free-form log
        </button>
      </div>

      <div className="upg-stats is-four">
        <div className="upg-stat is-leave">
          <div className="upg-stat-num">{stats.solved}<span className="upg-stat-of">/{stats.total}</span></div>
          <div className="upg-stat-lbl">Solved · {stats.pct}%</div>
        </div>
        <div className="upg-stat"><div className="upg-stat-num">{stats.attempted}</div><div className="upg-stat-lbl">Started</div></div>
        <div className="upg-stat is-day"><div className="upg-stat-num">{stats.due}</div><div className="upg-stat-lbl">Due now</div></div>
        <div className="upg-stat"><div className="upg-stat-num">{stats.shaky}</div><div className="upg-stat-lbl">Shaky</div></div>
      </div>

      {/* Next up — the whole point. A list you scroll is a list; three
          problems with a reason attached is a session you can start. */}
      {suggestions.length > 0 && (
        <div className="upg-card upg-next">
          <div className="upg-card-head">
            <h3>Next up</h3>
            <span className="upg-card-sub">Unfinished, then shaky, then your weakest topic</span>
          </div>
          <div className="upg-list">
            {suggestions.map(({ p, pr, why }) => (
              <button key={p.id} type="button" className="upg-prow is-next" onClick={() => setOpen(p)}>
                <span className="upg-why">{why}</span>
                <span className="upg-prow-name">{p.title}</span>
                <span className={`upg-diff is-${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                <span className="upg-topic">{p.topic}</span>
                {pr.attempts > 0 && <span className="upg-prow-date">{pr.attempts} attempt{pr.attempts === 1 ? '' : 's'}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="upg-card">
        <div className="upg-card-head">
          <h3>By topic</h3>
          <span className="upg-card-sub">{topic ? `Filtered — ${topic}` : 'Tap one to filter'}</span>
        </div>
        <div className="upg-topics">
          {stats.topics.map(t => (
            <button key={t.topic} type="button"
                    className={'upg-topicrow' + (topic === t.topic ? ' is-on' : '')}
                    onClick={() => setTopic(topic === t.topic ? '' : t.topic)}>
              <span className="upg-topicrow-name">{t.topic}</span>
              <span className="upg-bar">
                <span className="upg-bar-fill" style={{ width: `${(t.solved / t.total) * 100}%` }} />
                {t.shaky > 0 && <span className="upg-bar-shaky" title={`${t.shaky} shaky`} />}
              </span>
              <span className="upg-topicrow-n">{t.solved}/{t.total}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="upg-subnav is-inner">
        {FILTERS.map(f => (
          <button key={f.id} type="button" className={'upg-subtab' + (filter === f.id ? ' is-on' : '')}
                  onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <input className="upg-search" value={q} onChange={e => setQ(e.target.value)}
             placeholder="Search problems — name, topic or pattern" />

      {!rows.length && <div className="upg-empty">Nothing matches that filter.</div>}
      <div className="upg-list">
        {rows.map(p => {
          const pr = progressOf(S, p.id);
          return (
            <button key={p.id} type="button"
                    className={`upg-prow is-${pr.status}${isDue(pr) ? ' is-due' : ''}`}
                    onClick={() => setOpen(p)}>
              <span className={`upg-tick is-${pr.status}`} aria-hidden="true">
                {pr.status === 'solved' ? '✓' : pr.status === 'attempted' ? '·' : ''}
              </span>
              <span className="upg-prow-name">{p.title}</span>
              <span className={`upg-diff is-${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
              <span className="upg-topic">{p.pattern}</span>
              {pr.confidence > 0 && (
                <span className={'upg-conf' + (pr.confidence <= SHAKY ? ' is-shaky' : '')}>
                  {'★'.repeat(pr.confidence)}{'☆'.repeat(5 - pr.confidence)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {open && (
        <ProblemSheet problem={open} pr={progressOf(S, open.id)}
                      onClose={() => setOpen(null)}
                      onSet={patch => record(open, patch)} />
      )}
    </>
  );
}

/**
 * One problem.
 *
 * For KQL the hint and the solution start hidden and stay behind an
 * explicit tap. Reading the answer before trying is the one way to make
 * practice worthless, so it has to be a decision rather than something
 * your eye does on the way past.
 */
function ProblemSheet({ problem, pr, onClose, onSet }) {
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const isKql = problem.kind === 'kql';

  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="upg-day-head">
          <div>
            <div className="upg-day-date">{problem.title}</div>
            <div className="upg-day-base">
              {problem.difficulty} · {problem.topic}
              {problem.pattern !== problem.topic && ` · ${problem.pattern}`}
              {pr.attempts > 0 && ` · ${pr.attempts} attempt${pr.attempts === 1 ? '' : 's'}`}
            </div>
          </div>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upg-sheet-body">
          {isKql ? (
            <>
              <div className="upg-field">
                <span className="upg-field-lbl">Scenario</span>
                <p className="upg-prompt">{problem.prompt}</p>
                <div className="upg-tables">
                  {problem.tables.map(t => <span key={t} className="upg-tag">{t}</span>)}
                </div>
              </div>

              <div className="upg-reveal">
                {!showHint
                  ? <button type="button" className="upg-opt" onClick={() => setShowHint(true)}>Show hint</button>
                  : <div className="upg-hint"><b>Hint</b> {problem.hint}</div>}
                {!showSolution
                  ? <button type="button" className="upg-opt" onClick={() => setShowSolution(true)}>Show solution</button>
                  : null}
              </div>
              {showSolution && (
                <div className="upg-field">
                  <span className="upg-field-lbl">One correct answer</span>
                  <pre className="upg-snip-body">{problem.solution}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="upg-field">
              <span className="upg-field-lbl">Problem</span>
              <p className="upg-prompt">
                The statement lives on LeetCode — it&apos;s their text, so it isn&apos;t copied in here.
                Open it, solve it, then come back and record how it went.
              </p>
              <a className="link-open-btn" href={problem.url} target="_blank" rel="noreferrer noopener">
                Open on LeetCode <Icon name="external-link" size={12} />
              </a>
            </div>
          )}

          <div className="upg-field">
            <span className="upg-field-lbl">How did it go</span>
            <div className="upg-chipset">
              <button type="button" className={'upg-opt' + (pr.status === 'todo' ? ' is-on' : '')}
                      onClick={() => onSet({ status: 'todo', confidence: 0 })}>Not started</button>
              <button type="button" className={'upg-opt' + (pr.status === 'attempted' ? ' is-on' : '')}
                      onClick={() => onSet({ status: 'attempted' })}>Tried, stuck</button>
              <button type="button" className={'upg-opt' + (pr.status === 'solved' ? ' is-on' : '')}
                      onClick={() => onSet({ status: 'solved', confidence: pr.confidence || 3 })}>Solved</button>
            </div>
          </div>

          {pr.status !== 'todo' && (
            <div className="upg-field">
              <span className="upg-field-lbl">
                Confidence {pr.confidence ? `— ${pr.confidence}/5` : ''}
              </span>
              <div className="upg-chipset">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" className={'upg-opt' + (pr.confidence === n ? ' is-on' : '')}
                          onClick={() => onSet({ confidence: n })}>{n}</button>
                ))}
              </div>
              <div className="upg-fine">
                {SHAKY} or below keeps it in the queue. 3 comes back in 10 days, 4 in 30, 5 in 90.
              </div>
            </div>
          )}

          <div className="upg-field">
            <span className="upg-field-lbl">Notes</span>
            <textarea rows={4} value={pr.notes || ''}
                      placeholder="The approach, and what you missed first time."
                      onChange={e => onSet({ notes: e.target.value })} />
          </div>
        </div>

        <div className="upg-day-actions">
          <button type="button" className="link-open-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
