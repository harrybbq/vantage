/**
 * Career → Plan: the master timeline, its filters, and the contingencies.
 *
 * Status is stored apart from the plan (`career.status`, keyed by item
 * id), so ticking an item done never rewrites the plan document — an edit
 * in the JSON drawer and a tick on the timeline cannot clobber each other.
 */
import { useMemo, useState } from 'react';
import { Sheet } from '../UpgSheet';
import Timeline from './Timeline';
import JsonDrawer from './JsonDrawer';
import { KEYS } from '../../../lib/career/schema';
import { STATUSES, STATUS_LABEL, statusOf, bonusShift } from '../../../lib/career/planTimeline';
import { addMonths, monthDiff, monthLabel, monthOf, readiness } from '../../../lib/career/money';

const whenLabel = (it, postMonth) => {
  if (it.start === 'post-completion') return `After completion${postMonth ? ` (≈ ${monthLabel(postMonth)})` : ''}`;
  return it.end && it.end !== it.start ? `${monthLabel(it.start)} – ${monthLabel(it.end)}` : monthLabel(it.start);
};

export default function PlanPanel({ oc, isMobile, scenarioId, setScenarioId }) {
  const plan = oc.data[KEYS.plan];
  const money = oc.data[KEYS.money];
  const statusMap = useMemo(() => oc.data[KEYS.status] || {}, [oc.data]);
  const streams = plan.streams || [];

  const [visible, setVisible] = useState(() => new Set(streams.map(s => s.id)));
  const [hideDone, setHideDone] = useState(false);
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const scenarios = (money && money.scenarios) || [];
  const scenario = scenarios.find(s => s.id === scenarioId) || scenarios[0];
  const keys = scenario && money ? readiness(money, scenario).keys : null;
  const postMonth = keys ? addMonths(keys, 1) : null;

  const items = useMemo(() => plan.items || [], [plan.items]);
  const counts = useMemo(() => {
    const st = items.map(it => statusOf(it, statusMap));
    return { done: st.filter(s => s === 'done').length, risk: st.filter(s => s === 'at_risk').length, total: items.length };
  }, [items, statusMap]);
  const today = monthOf();
  const nextDecision = items
    .filter(it => it.decision && /^\d{4}-\d{2}$/.test(it.start) && monthDiff(today, it.end || it.start) >= 0 && statusOf(it, statusMap) !== 'done')
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const toggle = id => setVisible(v => {
    const n = new Set(v);
    if (n.has(id)) { if (n.size > 1) n.delete(id); } else n.add(id);
    return n;
  });

  async function setStatus(item, status) {
    const next = { ...statusMap, [item.id]: { status, at: new Date().toISOString().slice(0, 10) } };
    const r = await oc.save(KEYS.status, next);
    setSaveMsg(r.ok ? '' : r.message);
  }

  const openStatus = open ? statusOf(open, statusMap) : null;
  const stream = open ? streams.find(s => s.id === open.stream) : null;

  return (
    <div className="cp">
      <header className="cp-head">
        <div>
          <span className="cp-eyebrow">// master timeline</span>
          <h3 className="cp-title">{monthLabel(plan.range.from)} → {monthLabel(plan.range.to)}</h3>
        </div>
        <button type="button" className="upg-textbtn cp-edit" onClick={() => setEditing(true)}>Edit data</button>
      </header>

      <div className="cp-stats">
        <div className="cp-stat"><b>{counts.done}<em>/{counts.total}</em></b><span>done</span></div>
        <div className="cp-stat"><b className={counts.risk ? 'is-bad' : ''}>{counts.risk}</b><span>at risk</span></div>
        <div className="cp-stat is-wide">
          <b className="is-text">{nextDecision ? `◆ ${monthLabel(nextDecision.start)}` : '—'}</b>
          <span>{nextDecision ? nextDecision.title : 'no open decisions'}</span>
        </div>
      </div>

      <div className="cp-filters" role="group" aria-label="Streams">
        {streams.map(s => (
          <button key={s.id} type="button" className={`cp-chip${visible.has(s.id) ? ' is-on' : ''}`}
                  style={{ '--s': s.color }} aria-pressed={visible.has(s.id)} onClick={() => toggle(s.id)}>
            <i aria-hidden="true" />{s.id}
          </button>
        ))}
        <button type="button" className={`cp-chip is-plain${hideDone ? ' is-on' : ''}`} aria-pressed={hideDone}
                onClick={() => setHideDone(h => !h)}>Hide done</button>
        {scenarios.length > 0 && (
          <label className="cp-select">
            <span>After completion follows</span>
            <select value={scenario?.id || ''} onChange={e => setScenarioId(e.target.value)}>
              {scenarios.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="cp-card is-flush">
        <Timeline plan={plan} statusMap={statusMap} visible={visible} hideDone={hideDone}
                  postMonth={postMonth} onOpen={setOpen} isMobile={isMobile} />
        <div className="cp-legend" aria-hidden="true">
          <span><i className="cp-diamond">◆</i> decision point</span>
          <span><i className="cp-it-s is-in_progress" /> in progress</span>
          <span><i className="cp-it-s is-done">✓</i> done</span>
          <span><i className="cp-it-s is-at_risk">!</i> at risk</span>
        </div>
      </div>
      {saveMsg && <div className="cp-warn" role="alert">{saveMsg}</div>}

      <Contingencies plan={plan} money={money} />

      {open && (
        <Sheet title={open.title} onClose={() => setOpen(null)}>
          <div className="cp-detail-meta">
            <span className="cp-tag" style={{ '--s': stream?.color }}>{open.stream}</span>
            <span>{whenLabel(open, postMonth)}</span>
            {open.decision && <span className="cp-decision">◆ Decision point</span>}
          </div>
          {open.detail && <p className="cp-detail">{open.detail}</p>}
          <div className="upg-field-lbl">Status</div>
          <div className="upg-chipset" role="radiogroup" aria-label="Status">
            {STATUSES.map(s => (
              <button key={s} type="button" role="radio" aria-checked={openStatus === s}
                      className={`upg-opt cp-st is-${s}${openStatus === s ? ' is-on' : ''}`}
                      onClick={() => setStatus(open, s)}>{STATUS_LABEL[s]}</button>
            ))}
          </div>
        </Sheet>
      )}

      {editing && (
        <JsonDrawer title="Edit plan" contentKey={KEYS.plan} value={plan}
                    onSave={v => oc.save(KEYS.plan, v)} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function Contingencies({ plan, money }) {
  const list = plan.contingencies || [];
  if (!list.length) return null;
  return (
    <section className="cp-section">
      <span className="cp-eyebrow">// contingencies</span>
      <div className="cp-ifs">
        {list.map(c => (
          <article key={c.id || c.if} className="cp-if">
            <div className="cp-if-if"><span>If</span>{c.if}</div>
            <div className="cp-if-then"><span>Then</span>{c.then}</div>
            {c.kind === 'bonus' && money && <BonusShift plan={plan} money={money} fallback={c.shiftMonths ?? 1} />}
          </article>
        ))}
      </div>
    </section>
  );
}

/** The "bonus failed" card's adjusted dates — computed, not typed. */
function BonusShift({ plan, money, fallback }) {
  const rows = (money.scenarios || []).map(sc => ({ sc, r: readiness(money, sc) }));
  const moved = bonusShift(plan.items, money, fallback);
  return (
    <div className="cp-shift">
      <table className="cp-mini">
        <thead><tr><th>Scenario</th><th>With bonus</th><th>Without</th></tr></thead>
        <tbody>
          {rows.map(({ sc, r }) => (
            <tr key={sc.id}>
              <td>{sc.label}</td>
              <td>{monthLabel(r.keysBonus) || '—'}</td>
              <td className={r.keys !== r.keysBonus ? 'is-moved' : ''}>{monthLabel(r.keys) || 'beyond range'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="upg-fine">Keys month shown. </div>
      {moved.length > 0 && (
        <ul className="cp-moved">
          {moved.map(m => <li key={m.id}>{m.title}: {monthLabel(m.from)} → <b>{monthLabel(m.to)}</b></li>)}
        </ul>
      )}
    </div>
  );
}
