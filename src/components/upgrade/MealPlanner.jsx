/**
 * Diet → Planner: recipes laid over a run of days — by default the next
 * shift block from the rotation — checked against each day's targets,
 * with what to add where protein falls short, how many batches to cook,
 * and one shopping list for the lot.
 *
 * Targets are read from the Diet plan exactly as the Plan panel shows
 * them (lib/diet/planner.targetsFor); nothing here edits them.
 * State: S.mealPlan (lib/diet/planner.js).
 */
import { useMemo, useState } from 'react';
import Icon from '../Icon';
import {
  planDays, nextShiftBlock, targetsFor, dayStatus, suggest, batchesOf, shoppingList, EMPTY_PLAN,
} from '../../lib/diet/planner';

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${d} ${dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
};
const SHIFT = { day: 'Day shift', night: 'Night shift', off: 'Off', leave: 'Leave', unknown: '' };
const fmtServ = n => String(Math.round(n * 100) / 100);

export default function MealPlanner({ S, update, plan, proteinG }) {
  const recipes = useMemo(() => S.recipes || [], [S.recipes]);
  const overrides = useMemo(() => (S.rotation && S.rotation.overrides) || {}, [S.rotation]);
  const today = todayIso();
  const block = useMemo(() => nextShiftBlock(today, overrides), [today, overrides]);
  const mp = S.mealPlan || null;
  const start = (mp && mp.start) || block.start;
  const n = Math.max(1, Math.min(14, (mp && mp.days) || block.days));
  const entries = useMemo(() => (mp && mp.entries) || [], [mp]);
  const bought = new Set((mp && mp.bought) || []);
  const days = useMemo(() => planDays(start, n, overrides), [start, n, overrides]);
  const [picker, setPicker] = useState(null);    // day index | 'all' | null
  const [copied, setCopied] = useState(false);

  // Every write goes through here so the plan's range is pinned the
  // first time anything is changed.
  const save = fn => update(prev => {
    const cur = prev.mealPlan || { ...EMPTY_PLAN(), start, days: n };
    return { ...prev, mealPlan: fn({ ...cur, start: cur.start || start, days: cur.days || n }) };
  });
  const add = (dayIdx, recipeId, servings = 1) => save(p => ({
    ...p,
    entries: [...(p.entries || []), ...(dayIdx === 'all' ? days.map(d => d.i) : [dayIdx]).map(day => ({ id: uid(), day, recipeId, servings }))],
  }));
  const setServ = (id, v) => save(p => ({ ...p, entries: p.entries.map(e => (e.id === id ? { ...e, servings: Math.max(0.5, Math.round(v * 2) / 2) } : e)) }));
  const remove = id => save(p => ({ ...p, entries: p.entries.filter(e => e.id !== id) }));
  const setRange = (s, d) => save(p => ({ ...p, start: s, days: Math.max(1, Math.min(14, d)) }));
  const toggleBought = key => save(p => {
    const b = new Set(p.bought || []);
    if (b.has(key)) b.delete(key); else b.add(key);
    return { ...p, bought: [...b] };
  });

  const inRange = entries.filter(e => e.day < n);
  const st = days.map(d => dayStatus(inRange.filter(e => e.day === d.i), recipes, targetsFor(d, plan, proteinG)));
  const filled = st.filter(x => x.status !== 'empty');
  const avgP = filled.length ? Math.round(filled.reduce((a, x) => a + x.total.protein, 0) / filled.length) : 0;
  const shortDays = st.filter(x => x.status !== 'empty' && x.protein < -5).length;
  const batches = batchesOf(inRange, recipes);
  const shop = shoppingList(inRange, recipes);
  const isBlock = start === block.start && n === block.days;
  const shifts = days.filter(d => d.shift === 'day' || d.shift === 'night').length;

  function copyList() {
    const lines = [
      `Shopping · ${dayLabel(start)} – ${dayLabel(days[days.length - 1].iso)}`,
      ...shop.items.filter(i => !bought.has(i.key)).map(i => `- ${i.amount ? i.amount + ' ' : ''}${i.item}`),
    ].join('\n');
    navigator.clipboard?.writeText(lines).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }

  return (
    <div className="upg-plan">
      <div className="upg-card upg-plan-range">
        <div className="upg-plan-range-row">
          <div className="upg-chipset">
            <button type="button" className={'upg-opt' + (isBlock ? ' is-on' : '')} onClick={() => setRange(block.start, block.days)}>
              {block.start <= today ? 'This shift block' : 'Next shift block'} · {block.days} days
            </button>
            <button type="button" className={'upg-opt' + (start === today && n === 7 ? ' is-on' : '')} onClick={() => setRange(today, 7)}>Next 7 days</button>
          </div>
          <label className="upg-num upg-plan-from"><span>From</span>
            <input type="date" value={start} onChange={e => e.target.value && setRange(e.target.value, n)} />
          </label>
          <div className="upg-plan-days" role="group" aria-label="Number of days">
            <button type="button" onClick={() => setRange(start, n - 1)} disabled={n <= 1} aria-label="One day fewer">−</button>
            <b>{n} day{n === 1 ? '' : 's'}</b>
            <button type="button" onClick={() => setRange(start, n + 1)} disabled={n >= 14} aria-label="One day more">+</button>
          </div>
        </div>
        <div className="upg-plan-sum">
          <div><span>Protein a day</span><b className={filled.length ? (avgP >= proteinG - 5 ? 'is-ok' : 'is-bad') : ''}>{filled.length ? `${avgP} / ${proteinG} g` : `— / ${proteinG} g`}</b></div>
          <div><span>Days short</span><b className={shortDays ? 'is-bad' : filled.length ? 'is-ok' : ''}>{filled.length ? `${shortDays} of ${n}` : '—'}</b></div>
          <div><span>Shift days</span><b>{shifts}</b></div>
          <div><span>To cook</span><b>{batches.length ? `${batches.length} recipe${batches.length === 1 ? '' : 's'}` : '—'}</b></div>
          <button type="button" className="link-open-btn upg-plan-all" onClick={() => setPicker('all')} disabled={!recipes.length}>+ Add to every day</button>
        </div>
      </div>

      {!recipes.length && <div className="upg-empty">Add a recipe first, with its macros per serving. Then plan it across your days here.</div>}

      <div className="upg-plan-days-grid">
        {days.map((d, i) => {
          const s = st[i];
          const list = inRange.filter(e => e.day === d.i);
          const pPct = Math.min(100, Math.round((s.total.protein / Math.max(1, s.target.protein)) * 100));
          const kPct = Math.min(100, Math.round((s.total.kcal / Math.max(1, s.target.kcal)) * 100));
          const sug = suggest(s, recipes.filter(r => !list.some(e => e.recipeId === r.id)), { limit: 2 });
          return (
            <section key={d.iso} className={`upg-card upg-pday is-${s.status}${d.iso === today ? ' is-today' : ''}`}>
              <header className="upg-pday-head">
                <b>{dayLabel(d.iso)}</b>
                <span className={`upg-pshift is-${d.shift}`}>{SHIFT[d.shift]}{d.shiftNum ? ` ${d.shiftNum}` : ''}</span>
                <span className="upg-pday-type">{d.train ? 'Training' : 'Rest'} · {s.target.kcal} kcal</span>
              </header>
              <ul className="upg-pday-list">
                {list.map(e => {
                  const r = recipes.find(x => x.id === e.recipeId);
                  if (!r) return null;
                  return (
                    <li key={e.id}>
                      <span className="upg-pday-name">{r.title || 'Untitled recipe'}</span>
                      <span className="upg-pday-serv">
                        <button type="button" onClick={() => setServ(e.id, e.servings - 0.5)} disabled={e.servings <= 0.5} aria-label="Less">−</button>
                        <b>×{fmtServ(e.servings)}</b>
                        <button type="button" onClick={() => setServ(e.id, e.servings + 0.5)} aria-label="More">+</button>
                      </span>
                      <span className="upg-pday-p">{Math.round((r.protein || 0) * e.servings)} g</span>
                      <button type="button" className="upg-pday-x" onClick={() => remove(e.id)} aria-label={`Remove ${r.title || 'recipe'}`}>✕</button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="upg-textbtn upg-pday-add" onClick={() => setPicker(d.i)} disabled={!recipes.length}>+ Add a recipe</button>
              <div className="upg-pday-bars">
                <div className="upg-pbar is-protein" title={`${s.total.protein} of ${s.target.protein} g protein`}>
                  <span>Protein</span><i><em style={{ width: `${pPct}%` }} /></i><b>{s.total.protein}/{s.target.protein} g</b>
                </div>
                <div className="upg-pbar is-kcal" title={`${s.total.kcal} of ${s.target.kcal} kcal`}>
                  <span>kcal</span><i><em style={{ width: `${kPct}%` }} /></i><b>{s.total.kcal}/{s.target.kcal}</b>
                </div>
              </div>
              {s.status !== 'empty' && (
                <div className={`upg-pday-verdict is-${s.protein < -5 ? 'short' : s.status}`}>
                  {s.protein < -5
                    ? `${-s.protein} g protein short`
                    : s.status === 'over' ? `${s.kcal} kcal over, protein covered`
                    : s.kcal < -s.target.kcal * 0.05 ? `Protein covered, ${-s.kcal} kcal to spare`
                    : 'On target'}
                </div>
              )}
              {sug.length > 0 && (
                <div className="upg-pday-sug">
                  {sug.map(x => (
                    <button key={x.recipe.id} type="button" className="upg-opt" onClick={() => add(d.i, x.recipe.id, 1)}>
                      + {x.recipe.title} <em>+{Math.round(x.recipe.protein)} g · {Math.round(x.recipe.kcal)} kcal</em>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {batches.length > 0 && (
        <div className="upg-plan-bottom">
          <section className="upg-card upg-plan-cook">
            <span className="upg-field-lbl">To cook</span>
            <ul>
              {batches.map(b => (
                <li key={b.recipe.id}>
                  <span>{b.recipe.title || 'Untitled recipe'}</span>
                  <b>{fmtServ(b.servings)} serving{b.servings === 1 ? '' : 's'}</b>
                  <em>{b.batches === 1 ? '1 batch' : `${fmtServ(b.batches)} batches`} (makes {b.recipe.servings || 1})</em>
                </li>
              ))}
            </ul>
          </section>

          <section className="upg-card upg-plan-shop">
            <div className="upg-plan-shop-head">
              <span className="upg-field-lbl">Shopping list</span>
              <span className="upg-fine">{shop.items.filter(i => !bought.has(i.key)).length} to buy</span>
              <button type="button" className="upg-textbtn" onClick={copyList} disabled={!shop.items.length}>
                <Icon name="copy" size={11} /> {copied ? 'Copied' : 'Copy list'}
              </button>
            </div>
            {shop.missing.length > 0 && (
              <div className="upg-setup">
                <Icon name="triangle-alert" size={13} /> No ingredients yet for {shop.missing.map(r => r.title || 'Untitled recipe').join(', ')}. Add them, or link the video and read them in, in Recipes.
              </div>
            )}
            <ul className="upg-shop">
              {shop.items.map(i => (
                <li key={i.key} className={bought.has(i.key) ? 'is-bought' : ''}>
                  <label>
                    <input type="checkbox" checked={bought.has(i.key)} onChange={() => toggleBought(i.key)} />
                    <b>{i.amount || '—'}</b>
                    <span>{i.item}</span>
                  </label>
                  {i.from.length > 1 && <em>{i.from.join(' · ')}</em>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {picker != null && (
        <RecipePicker
          recipes={recipes}
          title={picker === 'all' ? `Add to all ${n} days` : `Add to ${dayLabel(days[picker].iso)}`}
          onPick={id => { add(picker, id, 1); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function RecipePicker({ recipes, title, onPick, onClose }) {
  const [q, setQ] = useState('');
  const rows = recipes
    .filter(r => !q.trim() || `${r.title} ${(r.tags || []).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.protein || 0) / Math.max(1, b.kcal || 1) - (a.protein || 0) / Math.max(1, a.kcal || 1));
  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="upg-day-head">
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="upg-sheet-body">
          <input className="upg-search" value={q} autoFocus onChange={e => setQ(e.target.value)} placeholder="Search recipes" />
          <span className="upg-fine">Most protein per calorie first. One serving each; change it on the day.</span>
          <div className="upg-rvid-list" style={{ maxHeight: 'none' }}>
            {rows.map(r => (
              <button key={r.id} type="button" className="upg-rvid-opt upg-pick-row" onClick={() => onPick(r.id)}>
                <span>{r.title || 'Untitled recipe'}</span>
                <em>{Math.round(r.protein || 0)} g protein · {Math.round(r.kcal || 0)} kcal</em>
              </button>
            ))}
            {!rows.length && <div className="upg-fine">Nothing matches that.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
