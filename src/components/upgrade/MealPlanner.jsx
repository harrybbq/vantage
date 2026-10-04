/**
 * Diet → Planner: recipes laid over a run of days — by default the next
 * shift block from the rotation — checked against each day's targets,
 * with what to add where protein falls short, how many batches to cook,
 * and one shopping list for the lot.
 *
 * A day takes recipes or single foods from the food search (the same
 * search as Track), with one-tap picks of foods planned before.
 *
 * The shopping list comes out as you'd buy it (lib/diet/shopping.js):
 * the cheapest packs that cover each item, grouped by aisle, with
 * seasonings and cupboard staples split off to check rather than buy.
 *
 * Targets are read from the Diet plan exactly as the Plan panel shows
 * them (lib/diet/planner.targetsFor); nothing here edits them.
 * State: S.mealPlan, S.plannerFoods (quick picks), S.shopPrefs (your
 * own pack sizes/prices, and items moved between the two lists).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon';
import {
  planDays, nextShiftBlock, targetsFor, dayStatus, suggest, batchesOf, shoppingList, EMPTY_PLAN,
  portionOptions, planFood, rememberFood,
} from '../../lib/diet/planner';
import { scheduleOf } from '../../lib/rotation/pattern';
import { shopPlan, packLabel, catalogueFor, packsAt, storeName, STORES, PRICES_AS_OF, PRICED_AS } from '../../lib/diet/shopping';
import { searchByName, readCommunityPref } from '../../lib/diet/foodSearch';

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
// Left over after buying: weights to the nearest 5, counts in whole items.
const spareLabel = (left, family) => {
  if (family === 'g' || family === 'ml') return left >= 5 ? ` · ${packLabel({ size: Math.round(left / 5) * 5 }, family)} spare` : '';
  const n = Math.floor(left + 1e-9);
  return n >= 1 ? ` · ${n} spare` : '';
};

export default function MealPlanner({ S, update, plan, proteinG }) {
  const recipes = useMemo(() => S.recipes || [], [S.recipes]);
  const overrides = useMemo(() => (S.rotation && S.rotation.overrides) || {}, [S.rotation]);
  const today = todayIso();
  const schedule = scheduleOf(S);   // cached per stored value — stable identity
  const block = useMemo(() => nextShiftBlock(today, overrides, schedule), [today, overrides, schedule]);
  const mp = S.mealPlan || null;
  const start = (mp && mp.start) || block.start;
  const n = Math.max(1, Math.min(14, (mp && mp.days) || block.days));
  const entries = useMemo(() => (mp && mp.entries) || [], [mp]);
  const bought = new Set((mp && mp.bought) || []);
  const days = useMemo(() => planDays(start, n, overrides, schedule), [start, n, overrides, schedule]);
  const [picker, setPicker] = useState(null);    // day index | 'all' | null
  const [copied, setCopied] = useState(false);

  // Every write goes through here so the plan's range is pinned the
  // first time anything is changed.
  const save = fn => update(prev => {
    const cur = prev.mealPlan || { ...EMPTY_PLAN(), start, days: n };
    return { ...prev, mealPlan: fn({ ...cur, start: cur.start || start, days: cur.days || n }) };
  });
  // `item` is { recipeId } or { food }; a food is also remembered as a
  // one-tap pick.
  const add = (dayIdx, item, servings = 1) => update(prev => {
    const cur = prev.mealPlan || { ...EMPTY_PLAN(), start, days: n };
    const targets = dayIdx === 'all' ? days.map(d => d.i) : [dayIdx];
    const mealPlan = {
      ...cur, start: cur.start || start, days: cur.days || n,
      entries: [...(cur.entries || []), ...targets.map(day => ({ id: uid(), day, ...item, servings }))],
    };
    return item.food
      ? { ...prev, mealPlan, plannerFoods: rememberFood(prev.plannerFoods, item.food) }
      : { ...prev, mealPlan };
  });
  const prefs = S.shopPrefs || {};
  const savePrefs = fn => update(prev => ({ ...prev, shopPrefs: fn(prev.shopPrefs || {}) }));
  const moveItem = (ikey, to) => savePrefs(p => ({ ...p, cats: { ...(p.cats || {}), [ikey]: to } }));
  const store = STORES.some(x => x.id === prefs.store) ? prefs.store : 'tesco';
  const setStore = id => savePrefs(p => ({ ...p, store: id }));
  // Your packs and prices for an item AT ONE SHOP (null clears them, and
  // any older all-shop packs for it, back to the table).
  const setPacks = (shopId, ikey, family, packs) => savePrefs(p => {
    const all = { ...(p.storePacks || {}) };
    const here = { ...(all[shopId] || {}) };
    const mine = { ...(here[ikey] || {}) };
    if (packs) mine[family] = packs; else delete mine[family];
    if (Object.keys(mine).length) here[ikey] = mine; else delete here[ikey];
    all[shopId] = here;
    const generic = { ...(p.packs || {}) };
    if (!packs && generic[ikey]) { const g = { ...generic[ikey] }; delete g[family]; if (Object.keys(g).length) generic[ikey] = g; else delete generic[ikey]; }
    return { ...p, storePacks: all, packs: generic };
  });
  // "Not stocked here", per shop.
  const setOut = (shopId, ikey, isOut) => savePrefs(p => {
    const all = { ...(p.out || {}) };
    const here = { ...(all[shopId] || {}) };
    if (isOut) here[ikey] = true; else delete here[ikey];
    all[shopId] = here;
    return { ...p, out: all };
  });
  const [editPacks, setEditPacks] = useState(null);  // shopping item | null
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
  const sp = shopPlan(shop.items, { ...prefs, store });
  const shopItems = sp.aisles.flatMap(a => a.items);
  const toBuy = shopItems.filter(i => !bought.has(i.key)).length;
  // The running total: what's in the basket so far against the whole shop.
  const inBasket = Math.round(shopItems.filter(i => bought.has(i.key) && i.packs).reduce((a, i) => a + i.packs.cost, 0) * 100) / 100;
  const cheapest = sp.stores.filter(x => !x.missing.length).sort((a, b) => a.cost - b.cost)[0] || null;
  const isBlock = start === block.start && n === block.days;
  const shifts = days.filter(d => d.shift === 'day' || d.shift === 'night').length;

  function copyList() {
    const left = shopItems.filter(i => !bought.has(i.key));
    const block = (title, list) => (list.length ? ['', title, ...list.map(i => `- ${i.buy ? i.buy + ' ' : ''}${i.item}`)] : []);
    const lines = [
      `Shopping · ${dayLabel(start)} – ${dayLabel(days[days.length - 1].iso)} · ≈ £${sp.cost.toFixed(2)}`,
      ...block(storeName(store), left.filter(i => !i.via && i.at.status !== 'out')),
      ...(sp.second ? block(storeName(sp.second.store), left.filter(i => i.via === sp.second.store)) : []),
      ...block('Not found yet', left.filter(i => !i.via && i.at.status === 'out')),
      ...(sp.cupboard.length ? ['', 'Check the cupboard', ...sp.cupboard.map(i => `- ${i.item}${i.amount ? ` (${i.amount})` : ''}`)] : []),
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
          <button type="button" className="link-open-btn upg-plan-all" onClick={() => setPicker('all')}>+ Add to every day</button>
        </div>
      </div>

      {!recipes.length && !entries.length && <div className="upg-empty">Add recipes in Recipes, or search foods straight into a day here.</div>}

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
                  const r = e.food || recipes.find(x => x.id === e.recipeId);
                  if (!r) return null;
                  const name = e.food ? e.food.name : (r.title || 'Untitled recipe');
                  return (
                    <li key={e.id} className={e.food ? 'is-food' : ''}>
                      <span className="upg-pday-name" title={name}>
                        {name}
                        {e.food && <em>{e.food.portion === 'serving' ? `per serving · ${e.food.amount} ${e.food.unit}` : `per ${e.food.amount} ${e.food.unit}`}</em>}
                      </span>
                      <span className="upg-pday-serv">
                        <button type="button" onClick={() => setServ(e.id, e.servings - 0.5)} disabled={e.servings <= 0.5} aria-label="Less">−</button>
                        <b>×{fmtServ(e.servings)}</b>
                        <button type="button" onClick={() => setServ(e.id, e.servings + 0.5)} aria-label="More">+</button>
                      </span>
                      <span className="upg-pday-p">{Math.round((r.protein || 0) * e.servings)} g</span>
                      <button type="button" className="upg-pday-x" onClick={() => remove(e.id)} aria-label={`Remove ${name}`}>✕</button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="upg-textbtn upg-pday-add" onClick={() => setPicker(d.i)}>+ Add a recipe or food</button>
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
                    <button key={x.recipe.id} type="button" className="upg-opt" onClick={() => add(d.i, { recipeId: x.recipe.id }, 1)}>
                      + {x.recipe.title} <em>+{Math.round(x.recipe.protein)} g · {Math.round(x.recipe.kcal)} kcal</em>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {inRange.length > 0 && (
        <div className="upg-plan-bottom">
          {batches.length > 0 && <section className="upg-card upg-plan-cook">
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
          </section>}

          <section className="upg-card upg-plan-shop">
            <div className="upg-plan-shop-head">
              <span className="upg-field-lbl">Shopping list</span>
              <span className="upg-fine">{toBuy} to buy</span>
              <button type="button" className="upg-textbtn" onClick={copyList} disabled={!shop.items.length}>
                <Icon name="copy" size={11} /> {copied ? 'Copied' : 'Copy list'}
              </button>
            </div>
            <div className="upg-stores" role="radiogroup" aria-label="Shop">
              {sp.stores.map(x => (
                <button key={x.id} type="button" role="radio" aria-checked={x.id === store}
                        className={`upg-store${x.id === store ? ' is-on' : ''}`} onClick={() => setStore(x.id)}>
                  <b>{x.name}</b>
                  <span>≈ £{x.cost.toFixed(2)}</span>
                  <em className={x.missing.length ? 'is-gap' : ''}>
                    {x.missing.length ? `+ ${x.missing.length} elsewhere` : cheapest && cheapest.id === x.id ? 'cheapest' : 'has it all'}
                  </em>
                  {PRICED_AS[x.id] && <i className="upg-store-as">priced as {storeName(PRICED_AS[x.id])}</i>}
                </button>
              ))}
            </div>
            <div className="upg-running" aria-live="polite">
              <div><span>Shop total</span><b>≈ £{sp.cost.toFixed(2)}</b></div>
              <div><span>In the basket</span><b>£{inBasket.toFixed(2)}</b></div>
              <div><span>Still to get</span><b>£{Math.max(0, sp.cost - inBasket).toFixed(2)}</b></div>
            </div>
            {sp.second && (
              <div className="upg-second">
                <Icon name="shopping-bag" size={13} />
                <span>
                  {storeName(store)} doesn’t have {sp.missing.length} of these.
                  Get {sp.second.keys.length === sp.missing.length ? 'them' : `${sp.second.keys.length} of them`} at <b>{storeName(sp.second.store)}</b> (≈ £{sp.second.cost.toFixed(2)})
                  {sp.second.keys.length === sp.missing.length ? ', and the whole list is covered in two shops.' : '.'}
                </span>
              </div>
            )}
            <div className="upg-fine">
              Shelf prices checked on the {(n => (n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]))(STORES.filter(x => !PRICED_AS[x.id]).map(x => x.name))} websites, {PRICES_AS_OF}; not live.
              {Object.keys(PRICED_AS).length > 0 && ` ${Object.entries(PRICED_AS).map(([a, b]) => `${storeName(a)} doesn’t list prices online, so it uses ${storeName(b)}’s`).join('; ')}.`}
              {' '}Set a shop’s real price on any item, or mark it not stocked there, and the list uses yours.
            </div>
            {shop.missing.length > 0 && (
              <div className="upg-setup">
                <Icon name="triangle-alert" size={13} /> No ingredients yet for {shop.missing.map(r => r.title || 'Untitled recipe').join(', ')}. Add them, or link the video and read them in, in Recipes.
              </div>
            )}
            {sp.aisles.map(a => (
              <div key={a.name} className="upg-aisle">
                <h4>{a.name}</h4>
                <ul className="upg-shop">
                  {a.items.map(i => {
                    const out = !i.via && i.at.status === 'out';
                    const markedHere = !!(((prefs.out || {})[store] || {})[i.ikey]);
                    return (
                      <li key={i.key} className={`${bought.has(i.key) ? 'is-bought' : ''}${out ? ' is-out' : ''}`}>
                        <label>
                          <input type="checkbox" checked={bought.has(i.key)} onChange={() => toggleBought(i.key)} />
                          <b>{out ? '—' : i.buy || '—'}</b>
                          <span>{i.item}{i.via && <em className="upg-via">@ {storeName(i.via)}</em>}</span>
                        </label>
                        {out && (
                          <div className="upg-out">
                            <span>Not at {storeName(store)}{i.at.why === 'range' ? ' (usually)' : ''}.</span>
                            {i.swap && <span>Try <b>{i.swap.buy} {i.swap.item}</b> here ≈ £{i.swap.best.cost.toFixed(2)}</span>}
                            {i.alt && <span>{i.swap ? 'or get' : 'Get'} it at <b>{storeName(i.alt.store)}</b>: {i.alt.buy} ≈ £{i.alt.best.cost.toFixed(2)}</span>}
                            {!i.swap && !i.alt && <span>None of the four shops lists it; buy it where you can.</span>}
                          </div>
                        )}
                        <div className="upg-shop-sub">
                          {i.packs && <span>need {i.amount}{spareLabel(i.packs.leftover, i.family)} · ≈ £{i.packs.cost.toFixed(2)}{i.at.own ? ' · your price' : ''}</span>}
                          {i.at.status === 'unpriced' && <span>need {i.amount} · {i.at.why === 'unchecked' ? `stocked, price not checked at ${storeName(i.via || store)}` : 'no price yet'}</span>}
                          {i.family && i.base != null && (
                            <button type="button" className="upg-textbtn" onClick={() => setEditPacks({ ...i, shop: i.via || store })}>
                              {i.ownPacks ? `your ${storeName(i.via || store)} price` : `price at ${storeName(i.via || store)}`}
                            </button>
                          )}
                          <button type="button" className="upg-textbtn" onClick={() => setOut(store, i.ikey, !markedHere)}>
                            {markedHere ? `${storeName(store)} has it` : `not at ${storeName(store)}`}
                          </button>
                          <button type="button" className="upg-textbtn" onClick={() => moveItem(i.ikey, 'cupboard')}>→ cupboard</button>
                          {i.from.length > 1 && <em>{i.from.join(' · ')}</em>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {sp.cupboard.length > 0 && (
              <div className="upg-aisle is-cupboard">
                <h4>Seasonings &amp; cupboard <span>check you have these</span></h4>
                <ul className="upg-shop">
                  {sp.cupboard.map(i => (
                    <li key={i.key} className={bought.has(i.key) ? 'is-bought' : ''}>
                      <label>
                        <input type="checkbox" checked={bought.has(i.key)} onChange={() => toggleBought(i.key)} />
                        <b>{i.amount || ''}</b>
                        <span>{i.item}</span>
                      </label>
                      <div className="upg-shop-sub">
                        <button type="button" className="upg-textbtn" onClick={() => moveItem(i.ikey, 'shop')}>→ shopping list</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {editPacks && (
        <PackEditor item={editPacks} prefs={prefs} shop={editPacks.shop}
                    onSave={packs => { setPacks(editPacks.shop, editPacks.ikey, editPacks.family, packs); setEditPacks(null); }}
                    onClose={() => setEditPacks(null)} />
      )}

      {picker != null && (
        <AddSheet
          recipes={recipes}
          quick={S.plannerFoods || []}
          title={picker === 'all' ? `Add to all ${n} days` : `Add to ${dayLabel(days[picker].iso)}`}
          onPick={item => { add(picker, item, 1); setPicker(null); }}
          onForget={f => update(prev => ({ ...prev, plannerFoods: (prev.plannerFoods || []).filter(x => x !== f && !(x.name === f.name && x.amount === f.amount && x.portion === f.portion)) }))}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/**
 * What to add to a day: one of your recipes, or a single food from the
 * same food search Track uses. Before you type, the foods you've planned
 * before are one tap away.
 */
function AddSheet({ recipes, quick, title, onPick, onForget, onClose }) {
  const [tab, setTab] = useState(recipes.length ? 'recipes' : 'food');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [chosen, setChosen] = useState(null);   // search result awaiting a portion
  const [grams, setGrams] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (tab !== 'food') return undefined;
    const term = q.trim();
    if (term.length < 2) { setResults([]); setErr(''); return undefined; }
    const my = ++seq.current;
    const id = setTimeout(async () => {
      setBusy(true); setErr('');
      try {
        const r = await searchByName(term, readCommunityPref());
        if (my === seq.current) setResults(r.slice(0, 25));
      } catch (e) {
        if (my === seq.current) setErr(e.message || 'Search failed');
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [q, tab]);

  const recipeRows = recipes
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
          <div className="upg-chipset" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'recipes'} className={'upg-opt' + (tab === 'recipes' ? ' is-on' : '')}
                    onClick={() => { setTab('recipes'); setChosen(null); }}>Recipes</button>
            <button type="button" role="tab" aria-selected={tab === 'food'} className={'upg-opt' + (tab === 'food' ? ' is-on' : '')}
                    onClick={() => setTab('food')}>Search food</button>
          </div>
          <input className="upg-search" value={q} autoFocus onChange={e => { setQ(e.target.value); setChosen(null); }}
                 placeholder={tab === 'recipes' ? 'Search your recipes' : 'Search foods, e.g. banana, whey, Greek yoghurt'} />

          {tab === 'recipes' && (
            <>
              <span className="upg-fine">Most protein per calorie first. One serving each; change it on the day.</span>
              <div className="upg-rvid-list" style={{ maxHeight: 'none' }}>
                {recipeRows.map(r => (
                  <button key={r.id} type="button" className="upg-rvid-opt upg-pick-row" onClick={() => onPick({ recipeId: r.id })}>
                    <span>{r.title || 'Untitled recipe'}</span>
                    <em>{Math.round(r.protein || 0)} g protein · {Math.round(r.kcal || 0)} kcal</em>
                  </button>
                ))}
                {!recipeRows.length && <div className="upg-fine">{recipes.length ? 'Nothing matches that.' : 'No recipes yet. Search a food instead.'}</div>}
              </div>
            </>
          )}

          {tab === 'food' && !chosen && (
            <>
              {q.trim().length < 2 && quick.length > 0 && (
                <div className="upg-quick">
                  <span className="upg-fine">Planned before, one tap</span>
                  <div className="upg-quick-row">
                    {quick.map((f, i) => (
                      <span key={`${f.name}-${f.amount}-${i}`} className="upg-quick-chip">
                        <button type="button" onClick={() => onPick({ food: f })}>
                          {f.name} <em>{f.portion === 'serving' ? '1 serving' : `${f.amount} ${f.unit}`} · {Math.round(f.protein)} g P</em>
                        </button>
                        <button type="button" className="upg-quick-x" aria-label={`Forget ${f.name}`} onClick={() => onForget(f)}>✕</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {busy && <div className="upg-fine"><span className="upg-spin" aria-hidden="true" /> Searching…</div>}
              {err && <div className="upg-fine" style={{ color: '#e0796a' }}>{err}</div>}
              <div className="upg-rvid-list" style={{ maxHeight: 'none' }}>
                {results.map((f, i) => (
                  <button key={`${f.food_name}-${f.brand}-${i}`} type="button" className="upg-rvid-opt upg-pick-row"
                          onClick={() => { setChosen(f); setGrams(''); }}>
                    <span>{f.food_name}{f.brand ? <i className="upg-brand"> · {f.brand}</i> : null}</span>
                    <em>{Math.round(f.protein_g || 0)} g protein · {Math.round(f.calories || 0)} kcal per {Math.round(f.serving_g || 100)} {f.serving_unit === 'ml' ? 'ml' : 'g'}</em>
                  </button>
                ))}
                {!busy && !err && q.trim().length >= 2 && !results.length && <div className="upg-fine">No foods found.</div>}
              </div>
            </>
          )}

          {tab === 'food' && chosen && (
            <div className="upg-portion">
              <b>{chosen.food_name}</b>
              {chosen.brand && <span className="upg-fine">{chosen.brand}</span>}
              <span className="upg-fine">How much, per time you eat it?</span>
              <div className="upg-chipset">
                {portionOptions(chosen).map(o => {
                  const f = planFood(chosen, o);
                  return (
                    <button key={o.label} type="button" className="upg-opt" onClick={() => onPick({ food: f })}>
                      {o.label} · {Math.round(f.protein)} g P · {f.kcal} kcal
                    </button>
                  );
                })}
              </div>
              <div className="upg-logrow">
                <label className="upg-num" style={{ flex: '0 0 130px' }}>
                  <span>Or an amount ({chosen.serving_unit === 'ml' ? 'ml' : 'g'})</span>
                  <input type="number" min="1" value={grams} onChange={e => setGrams(e.target.value)} />
                </label>
                <button type="button" className="link-open-btn" disabled={!(Number(grams) > 0)}
                        onClick={() => onPick({ food: planFood(chosen, { portion: 'amount', amount: Number(grams) }) })}>Add</button>
                <button type="button" className="upg-textbtn" onClick={() => setChosen(null)}>Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Your own pack sizes and prices for an item, replacing the typical ones.
 */
function PackEditor({ item, prefs, shop, onSave, onClose }) {
  const typical = packsAt(catalogueFor(item.ikey), item.family, shop);
  const mine = (((prefs.storePacks || {})[shop] || {})[item.ikey] || {})[item.family]
    || ((prefs.packs || {})[item.ikey] || {})[item.family];
  const [rows, setRows] = useState(() => (mine || typical).map(p => ({ size: String(p.size), price: String(p.price), label: p.label || '' })));
  const unit = item.family === 'x' ? 'count' : item.family;
  const clean = rows.map(r => ({ size: Number(r.size), price: Number(r.price), ...(r.label ? { label: r.label } : {}) }))
    .filter(r => r.size > 0 && r.price >= 0);
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v, ...(k === 'size' ? { label: '' } : {}) } : r)));
  return (
    <div className="modal-overlay open" onClick={onClose} role="presentation">
      <div className="modal upg-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${item.item} at ${storeName(shop)}`}>
        <div className="upg-day-head">
          <h3 style={{ margin: 0, fontSize: 16 }}>{item.item} · {storeName(shop)}</h3>
          <button type="button" className="link-del-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="upg-sheet-body">
          <span className="upg-fine">The sizes {storeName(shop)} sells and what they cost there. The list picks the cheapest mix that covers {item.amount}.{!typical.length && !mine ? ` ${storeName(shop)} isn’t in the price table for this — add what you find.` : ''}</span>
          <div className="upg-packs">
            <span>Size ({unit})</span><span>Price (£)</span><span />
            {rows.map((r, i) => (
              <div key={i} className="upg-packs-row">
                <input type="number" min="0" value={r.size} onChange={e => set(i, 'size', e.target.value)} aria-label="Pack size" />
                <input type="number" min="0" step="0.01" value={r.price} onChange={e => set(i, 'price', e.target.value)} aria-label="Pack price" />
                <button type="button" className="link-del-btn" aria-label="Remove pack" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className="upg-textbtn" style={{ alignSelf: 'flex-start' }} onClick={() => setRows(rs => [...rs, { size: '', price: '', label: '' }])}>+ Add a pack size</button>
        </div>
        <div className="upg-day-actions">
          {mine && <button type="button" className="upg-textbtn" onClick={() => onSave(null)}>Use the price table</button>}
          <button type="button" className="link-open-btn" onClick={() => onSave(clean.length ? clean : null)}>Save</button>
        </div>
      </div>
    </div>
  );
}
