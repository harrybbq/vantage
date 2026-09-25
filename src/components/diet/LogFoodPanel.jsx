/**
 * Log food, desktop: a panel docked to the right edge of the Track → Diet
 * page (from the Claude Design brief, 25 Sep).
 *
 * ── Why docked, and why nothing is dimmed ───────────────────────────
 * The phone bottom sheet stretched across a 2,000px screen as a slab of
 * 1,900px-wide rows and hid the rings. Docked right, the panel covers
 * the "One tap again" rail and nothing else: the Energy & macros card
 * stays visible and undimmed, so every log visibly lands on the ring.
 * Phones keep the bottom sheet (FoodSearch + FoodLogSheet).
 *
 * ── Two views in one panel ──────────────────────────────────────────
 *   list  search (always visible) + Meals / Recent / Name / Scan
 *   log   meal, serving (rescales live), totals after this, save/share
 * + on a row logs one serving at once; clicking the row opens the log
 * step for anything that needs adjusting.
 *
 * ── Motion (timings as in the design's spec) ────────────────────────
 * Panel enter 300ms spring · exit 180ms · rows cascade 180ms/24ms ·
 * tab content ±12px 180ms · list↔log ±24px 260/200ms · the kcal chip
 * flies 620ms to the calorie ring, which pulses on arrival. Reduced
 * motion turns every one of them into a short fade or nothing.
 *
 * ── Data ────────────────────────────────────────────────────────────
 * Every log goes through logFoodEntry (insert, recompute the day's
 * summary, refresh every card showing it) for the DATE BEING VIEWED.
 * Saved meals are S.savedMeals, changed only through the callbacks the
 * Track page passes in. Deleting one can be undone for five seconds.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrandMark } from '../food/BrandMark';
import CameraScanner from '../CameraScanner';
import { supabase } from '../../lib/supabase';
import { contributionProblem, toContribution } from '../../lib/diet/contribute';
import { searchByBarcode, searchByName, readCommunityPref, writeCommunityPref } from '../../lib/diet/foodSearch';
import { fetchRecentFoods, logFoodEntry } from '../../lib/diet/quickLog';
import {
  mealForTime, scaled, fromPer100, presetsFor, energySplit, logRow, savedMeal, mealAsFood,
  unitOf, baseOf,
} from '../../lib/diet/logMath';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const TAB_KEY = 'vb4_logfood_tab';
const SPRING = 'cubic-bezier(.32,1.28,.5,1)';
const OUT = 'cubic-bezier(.2,.8,.2,1)';
const IN = 'cubic-bezier(.4,0,1,1)';
const MACRO_COL = { protein_g: '#5b8cff', carbs_g: '#d99114', fat_g: '#d0498f' };
const MANUAL_FIELDS = [
  ['calories', 'Calories'], ['protein_g', 'Protein g'], ['carbs_g', 'Carbs g'], ['fat_g', 'Fat g'],
  ['fibre_g', 'Fibre g'], ['sugar_g', 'Sugar g'], ['sodium_mg', 'Sodium mg'],
];
const EMPTY_MANUAL = { name: '', brand: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', fibre_g: '', sugar_g: '', sodium_mg: '' };

const reduced = () => typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const kcal = n => Math.round(Number(n) || 0).toLocaleString('en-GB');
const g1 = v => { const n = Number(v) || 0; return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const readTab = () => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } };
const writeTab = t => { try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ } };
const isTyping = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
const shortDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();

/** What a row says under the name. */
function subOf(food) {
  const unit = unitOf(food);
  const base = baseOf(food);
  const brand = food.brand && food.source !== 'community' ? food.brand : '';
  const per = base === 100 && food.per100 !== false && food.__kind === 'search' ? `per 100 ${unit}` : `${Math.round(base)} ${unit}`;
  return [brand, per].filter(Boolean).join(' · ');
}

/** Chip flight: a "+N kcal" pill arcs from the source to the calorie
 *  ring, which pulses as it lands. Nothing happens without a ring. */
function flyToRing(fromEl, text) {
  const ring = document.querySelector('.nut-wrap .tv-cal-ring');
  if (!fromEl || !ring || reduced()) return;
  const a = fromEl.getBoundingClientRect();
  const b = ring.getBoundingClientRect();
  if (!b.width) return;
  const chip = document.createElement('div');
  chip.className = 'lfp-fly';
  chip.textContent = `+${text} kcal`;
  document.body.appendChild(chip);
  const cw = chip.offsetWidth, ch = chip.offsetHeight;
  const x0 = a.left + a.width / 2 - cw / 2, y0 = a.top + a.height / 2 - ch / 2;
  const x1 = b.left + b.width / 2 - cw / 2, y1 = b.top + b.height / 2 - ch / 2;
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 60;
  const anim = chip.animate([
    { transform: `translate(${x0}px,${y0}px) scale(1)`, opacity: 1 },
    { transform: `translate(${mx}px,${my}px) scale(.9)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${x1}px,${y1}px) scale(.7)`, opacity: 1, offset: 0.8 },
    { transform: `translate(${x1}px,${y1}px) scale(.6)`, opacity: 0 },
  ], { duration: 620, easing: 'cubic-bezier(.3,0,.2,1)' });
  anim.onfinish = () => chip.remove();
  setTimeout(() => {
    ring.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
      { duration: 360, easing: OUT });
  }, 560);
}

export default function LogFoodPanel({
  open, onOpen, onClose,
  userId, date, today,
  savedMeals = [], onSaveMeal, onDeleteMeal, onRestoreMeal,
  totals = {}, goals = {},        // the day so far and its targets, for "after this"
  onLogged,                       // ({ id, day }) → the page reloads its figures
  canUseCamera = false,
}) {
  const [present, setPresent] = useState(open);
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const contentRef = useRef(null);
  const searchRef = useRef(null);
  const logBtnRef = useRef(null);
  const cameraRef = useRef(null);
  const [top, setTop] = useState(52);
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1680);

  const mealNow = () => { const d = new Date(); return mealForTime(d.getHours(), d.getMinutes()); };
  // Read from the clock each time the panel opens (see the reset below).
  const [defaultMeal, setDefaultMeal] = useState(mealNow);

  // ── list state ──
  const [mode, setMode] = useState(() => {
    const t = readTab();
    return t === 'meals' || t === 'recent' || (t === 'scan' && canUseCamera) ? t : (savedMeals.length ? 'meals' : 'recent');
  });
  const [prevMode, setPrevMode] = useState(mode === 'name' ? 'recent' : mode);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('idle');   // idle | loading | results | error | none
  const [results, setResults] = useState([]);
  const [searchErr, setSearchErr] = useState('');
  const [community, setCommunity] = useState(readCommunityPref);
  const [recent, setRecent] = useState(null);
  const [focus, setFocus] = useState(-1);
  const [logged, setLogged] = useState(null);     // row key showing "Logged ✓"
  const [busyKey, setBusyKey] = useState(null);
  const [rowErr, setRowErr] = useState(null);     // { key, msg }
  const [ghosts, setGhosts] = useState([]);       // deleted meals awaiting undo: { meal, index, key }
  const debounce = useRef(0);

  // ── log state ──
  const [view, setView] = useState('list');
  const [pick, setPick] = useState(null);         // { food, key } | { manual: true }
  const [amount, setAmount] = useState('100');
  const [unit, setUnit] = useState('g');
  const [meal, setMeal] = useState(defaultMeal);
  const [saveMealOn, setSaveMealOn] = useState(false);
  const [share, setShare] = useState(false);
  const [phase, setPhase] = useState('idle');     // idle | saving | error
  const [saveErr, setSaveErr] = useState('');
  const [manual, setManual] = useState(EMPTY_MANUAL);

  // ── mount / unmount with the exit animation ──
  useEffect(() => { if (open) setPresent(true); }, [open]);
  useLayoutEffect(() => {
    if (!present) return;
    const el = panelRef.current;
    if (!el) return;
    if (open) {
      const hdr = document.getElementById('pageHeader');
      const b = hdr ? hdr.getBoundingClientRect().bottom : 52;
      setTop(Math.max(0, Math.min(120, Math.round(b))));
      setWide(window.innerWidth >= 1680);
      if (reduced()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      else {
        el.animate([{ transform: 'translateX(calc(100% + 40px))' }, { transform: 'none' }], { duration: 300, easing: SPRING });
        cascade(140);
      }
      const t = setTimeout(() => searchRef.current && searchRef.current.focus({ preventScroll: true }), 320);
      return () => clearTimeout(t);
    }
    const anim = reduced()
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' })
      : el.animate([{ transform: 'none' }, { transform: 'translateX(calc(100% + 40px))' }], { duration: 180, easing: IN, fill: 'forwards' });
    anim.onfinish = () => setPresent(false);
    return undefined;
  }, [open, present]);

  /* Make room: the panel is meant to cover the right rail and nothing
     else, but the rail is 280–380px and the panel 420–460px, so it
     overhangs the main column a little. Measure the overhang and ease
     the main column in by exactly that much, in time with the panel. */
  useLayoutEffect(() => {
    const main = document.querySelector('.nut-wrap .tv-diet .tv-main');
    if (!main) return undefined;
    const fit = () => {
      if (!open || !panelRef.current) { main.style.marginRight = ''; return; }
      main.style.marginRight = '';
      // Layout width, not the on-screen rect: this runs while the panel
      // is still sliding in, when its transformed rect is off-screen.
      const room = document.documentElement.clientWidth - panelRef.current.offsetWidth - 16;
      const over = Math.ceil(main.getBoundingClientRect().right - room);
      main.style.marginRight = over > 0 ? `${over}px` : '';
    };
    main.style.transition = reduced() ? '' : `margin-right ${open ? 300 : 180}ms ${open ? OUT : IN}`;
    fit();
    if (!open) return undefined;
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, present, wide]);
  useEffect(() => () => {
    const main = document.querySelector('.nut-wrap .tv-diet .tv-main');
    if (main) main.style.marginRight = '';
  }, []);

  // Back to a clean list each time it opens.
  useEffect(() => {
    if (!open) return;
    const m = mealNow();
    setDefaultMeal(m); setMeal(m);
    setView('list'); setPhase('idle'); setFocus(-1); setLogged(null); setRowErr(null);
  }, [open]);

  // Recent foods, fetched when the panel opens (cached a minute).
  useEffect(() => {
    if (!open || !userId) return;
    let live = true;
    fetchRecentFoods(userId, { limit: 15 })
      .then(list => { if (live) setRecent(list); })
      .catch(() => { if (live) setRecent([]); });
    return () => { live = false; };
  }, [open, userId]);

  // ── motion helpers ──
  function cascade(base) {
    if (reduced() || !panelRef.current) return;
    const rows = [...panelRef.current.querySelectorAll('[data-row]')].slice(0, 8);
    rows.forEach((r, i) => r.animate([
      { opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' },
    ], { duration: 180, delay: base + i * 24, easing: OUT, fill: 'backwards' }));
  }
  function slide(el, dx, ms, rows) {
    if (!el) return;
    if (reduced()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 }); return; }
    el.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: 'none' }], { duration: ms, easing: OUT });
    if (rows) cascade(40);
  }
  const lastMode = useRef(mode);
  useLayoutEffect(() => {
    const order = ['meals', 'recent', 'name', 'scan'];
    if (lastMode.current !== mode && view === 'list') {
      slide(contentRef.current, order.indexOf(mode) > order.indexOf(lastMode.current) ? 12 : -12, 180, true);
    }
    lastMode.current = mode;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const lastView = useRef(view);
  useLayoutEffect(() => {
    if (lastView.current !== view) {
      slide(bodyRef.current, view === 'log' ? 24 : -24, view === 'log' ? 260 : 200, view === 'list');
    }
    lastView.current = view;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const lastSearch = useRef(search);
  useLayoutEffect(() => {
    if (search === 'results' && lastSearch.current !== 'results') cascade(0);
    lastSearch.current = search;
  }, [search]);

  // ── rows ──
  const mealRows = useMemo(() => {
    const list = (savedMeals || []).map((m, i) => ({
      key: 'm:' + (m.id || i), food: { ...mealAsFood(m), __kind: 'meal' }, mealId: m.id, canDel: true,
    }));
    for (const g of ghosts) list.splice(Math.min(g.index, list.length), 0, { key: g.key, ghost: g, food: { ...mealAsFood(g.meal), __kind: 'meal' } });
    return list;
  }, [savedMeals, ghosts]);
  const recentRows = useMemo(() => (recent || []).map(r => ({
    key: 'r:' + String(r.food_name || '').toLowerCase(), food: { ...r, __kind: 'recent' },
  })), [recent]);
  const searchRows = useMemo(() => results.map((r, i) => ({
    key: 's:' + i + ':' + (r.food_name || ''), food: { ...r, __kind: 'search' }, user: r.source === 'community',
  })), [results]);
  const rows = view !== 'list' ? []
    : mode === 'meals' ? mealRows
    : mode === 'recent' ? recentRows
    : mode === 'name' && search === 'results' ? searchRows : [];

  // ── search ──
  const runSearch = useCallback(async (q, withCommunity) => {
    setSearch('loading'); setSearchErr('');
    try {
      const res = await searchByName(q, withCommunity);
      setResults(res);
      setSearch(res.length ? 'results' : 'none');
    } catch (e) {
      setSearchErr(e && e.message ? e.message : 'The search did not finish.');
      setSearch('error');
    }
  }, []);
  function onQuery(v) {
    setQuery(v);
    setFocus(-1);
    clearTimeout(debounce.current);
    if (!v.trim()) { setMode(prevMode || 'recent'); setSearch('idle'); setResults([]); return; }
    if (mode !== 'name') { setPrevMode(mode); setMode('name'); }
    if (v.trim().length < 2) { setSearch('idle'); setResults([]); return; }
    setSearch('loading');
    debounce.current = setTimeout(() => runSearch(v.trim(), community), 450);
  }
  function toggleCommunity() {
    const next = !community;
    setCommunity(next);
    writeCommunityPref(next);
    if (query.trim().length >= 2) runSearch(query.trim(), next);
  }
  function pickMode(m) {
    setFocus(-1);
    if (m !== 'name') { setPrevMode(m); writeTab(m); }
    setMode(m);
    if (m === 'name') setTimeout(() => searchRef.current && searchRef.current.focus(), 30);
  }

  // ── log step ──
  function openLog(row) {
    const f = row.food;
    setPick({ food: f, key: row.key });
    setAmount(String(Math.round(baseOf(f) * 10) / 10));
    setUnit(unitOf(f));
    setMeal(defaultMeal);
    setSaveMealOn(false); setShare(false); setPhase('idle'); setSaveErr('');
    setView('log');
  }
  function openManual(name = '') {
    setPick({ manual: true, key: null });
    setManual({ ...EMPTY_MANUAL, name });
    setAmount('100'); setUnit('g'); setMeal(defaultMeal);
    setSaveMealOn(false); setShare(false); setPhase('idle'); setSaveErr('');
    setView('log');
  }
  const back = () => { setView('list'); setPhase('idle'); };

  const values = useMemo(() => {
    if (!pick) return null;
    if (pick.manual) return fromPer100(manual, amount);
    return scaled(pick.food, amount);
  }, [pick, manual, amount]);

  const pickName = pick ? (pick.manual ? manual.name : pick.food.food_name || pick.food.name) : '';
  const pickBrand = pick ? (pick.manual ? manual.brand : (pick.food.source === 'community' ? '' : pick.food.brand || '')) : '';
  const shareForm = pick && pick.manual && values ? {
    food_name: manual.name, brand: manual.brand, serving_g: String(amount), serving_unit: unit,
    ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])),
  } : null;
  const shareProblem = shareForm ? contributionProblem(shareForm) : 'n/a';
  const canLog = !!pick && phase !== 'saving' && Number(amount) > 0
    && (!pick.manual || (manual.name.trim().length > 0 && Number(manual.calories) > 0));

  async function commit(row, fromEl) {
    const res = await logFoodEntry(userId, row);
    if (onLogged) onLogged({ id: res.id, day: res.day });
    flyToRing(fromEl, kcal(row.calories));
    return res;
  }

  async function logIt() {
    if (!canLog || !userId) return;
    setPhase('saving'); setSaveErr('');
    const row = logRow({
      userId, day: date, meal, name: pickName, brand: pickBrand, amount: Number(amount), unit, values,
      source: pick.manual ? 'manual' : pick.food.__kind === 'search' ? 'search' : 'again',
    });
    try {
      await commit(row, logBtnRef.current);
      if (saveMealOn && onSaveMeal) {
        onSaveMeal(savedMeal({ id: 'meal' + Date.now(), name: pickName, brand: pickBrand, meal, amount, unit, values }));
      }
      if (share && pick.manual && !shareProblem) {
        const c = toContribution(shareForm, userId);
        // Never fails the log: the food IS saved; sharing is a bonus.
        if (c) { try { await supabase.from('food_contributions').insert(c); } catch { /* already there */ } }
      }
      setPhase('idle');
      setTimeout(() => {
        setView('list');
        setLogged(pick.key);
        if (mode === 'name' && search !== 'results') setMode(prevMode || 'recent');
      }, reduced() ? 0 : 250);
      fetchRecentFoods(userId, { force: true, limit: 15 }).then(setRecent).catch(() => {});
    } catch (e) {
      setSaveErr(e && e.message ? e.message : 'It did not save.');
      setPhase('error');
    }
  }

  async function logNow(row, el) {
    if (busyKey || !userId) return;
    setBusyKey(row.key); setRowErr(null);
    const f = row.food;
    const amt = baseOf(f);
    const r = logRow({
      userId, day: date, meal: defaultMeal, name: f.food_name || f.name, brand: f.source === 'community' ? '' : f.brand,
      amount: amt, unit: unitOf(f), values: scaled(f, amt), source: f.__kind === 'search' ? 'search' : 'again',
    });
    try {
      await commit(r, el);
      setLogged(row.key);
      fetchRecentFoods(userId, { force: true, limit: 15 }).then(setRecent).catch(() => {});
    } catch (e) {
      setRowErr({ key: row.key, msg: e && e.message ? e.message : 'It did not save.' });
    } finally {
      setBusyKey(null);
    }
  }

  // Delete a saved meal, undoable for five seconds.
  function deleteMeal(row) {
    const index = (savedMeals || []).findIndex(m => m.id === row.mealId);
    const m = (savedMeals || [])[index];
    if (!m || !onDeleteMeal) return;
    onDeleteMeal(m.id);
    const key = 'g:' + m.id;
    const timer = setTimeout(() => setGhosts(gs => gs.filter(g => g.key !== key)), 5000);
    setGhosts(gs => [...gs.filter(g => g.key !== key), { meal: m, index, key, timer }]);
  }
  function undoDelete(g) {
    clearTimeout(g.timer);
    setGhosts(gs => gs.filter(x => x.key !== g.key));
    if (onRestoreMeal) onRestoreMeal(g.meal, g.index);
  }
  useEffect(() => () => ghosts.forEach(g => clearTimeout(g.timer)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── keyboard ──
  const stateRef = useRef({});
  stateRef.current = { open, view, rows, focus, mode };
  useEffect(() => {
    const onKey = e => {
      const s = stateRef.current;
      const typing = isTyping(e.target);
      if (!s.open) {
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        const page = document.querySelector('.nut-wrap');
        if (!page || !page.getClientRects().length) return;      // Diet not on screen
        if (e.key === '/' || e.key === 'l' || e.key === 'L') { e.preventDefault(); onOpen && onOpen(); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); if (s.view === 'log') back(); else onClose(); return; }
      if (s.view !== 'list') return;
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current && searchRef.current.focus(); return; }
      if (!s.rows.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (typing && e.target !== searchRef.current) return;
        e.preventDefault();
        const f = Math.max(0, Math.min(s.rows.length - 1, s.focus + (e.key === 'ArrowDown' ? 1 : -1)));
        setFocus(f);
        const el = panelRef.current && panelRef.current.querySelectorAll('[data-row]')[f];
        const sc = contentRef.current;
        if (el && sc) {
          const t = el.offsetTop, b = t + el.offsetHeight;
          if (t < sc.scrollTop) sc.scrollTop = t - 8;
          else if (b > sc.scrollTop + sc.clientHeight) sc.scrollTop = b - sc.clientHeight + 8;
        }
      } else if (e.key === 'Enter' && s.focus >= 0 && s.rows[s.focus] && !s.rows[s.focus].ghost) {
        if (typing && e.target !== searchRef.current) return;
        e.preventDefault();
        openLog(s.rows[s.focus]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOpen, onClose]);

  // Click anywhere outside closes — except the button that opened it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.tv-log-btn, .lfp-fly')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onClose]);

  if (!present) return null;

  // ── render ──
  const tabs = [
    ['meals', 'Meals', mealRows.filter(r => !r.ghost).length],
    ['recent', 'Recent', recent ? recent.length : ''],
    ['name', 'Name', mode === 'name' && search === 'results' ? results.length : ''],
    ...(canUseCamera ? [['scan', 'Scan', '']] : []),
  ];
  const ti = Math.max(0, tabs.findIndex(t => t[0] === mode));
  const dayTag = date && today && date !== today ? ` · ${shortDay(date)}` : '';
  const head = view === 'log' ? `// LOG · ${meal.toUpperCase()}${dayTag}` : `// LOG FOOD · ${defaultMeal.toUpperCase()}${dayTag}`;
  const listLabel = mode === 'meals' ? '// SAVED MEALS' : mode === 'recent' ? '// RECENT' : '// RESULTS';

  const after = values ? (Number(totals.calories) || 0) + values.calories : 0;
  const calGoal = Number(goals.calories) || 0;
  const over = calGoal > 0 && after > calGoal;

  const emptyMeals = mode === 'meals' && mealRows.length === 0;
  const emptyRecent = mode === 'recent' && recent && recent.length === 0;

  return createPortal(
    <aside
      ref={panelRef}
      className={`lfp${wide ? ' is-wide' : ''}`}
      style={{ top }}
      role="dialog"
      aria-label="Log food"
    >
      <div className="lfp-head">
        {view === 'log' && (
          <button type="button" className="lfp-ghostbtn" onClick={back}><span aria-hidden="true">‹</span>Back</button>
        )}
        <span className="lfp-label lfp-grow">{head}</span>
        <button type="button" className="lfp-ghostbtn" onClick={onClose}>Cancel <kbd>ESC</kbd></button>
      </div>

      <div ref={bodyRef} className="lfp-body">
        {view === 'list' ? (
          <>
            <div className="lfp-top">
              <div className="lfp-search">
                <span aria-hidden="true">⌕</span>
                <input
                  ref={searchRef}
                  id="lfp-search"
                  value={query}
                  onChange={e => onQuery(e.target.value)}
                  placeholder="Search foods, e.g. chicken breast"
                  aria-label="Search foods"
                  autoComplete="off"
                />
                <kbd>/</kbd>
              </div>
              <div className="lfp-tabs" role="tablist">
                {tabs.map(([k, label, n]) => (
                  <button key={k} type="button" role="tab" aria-selected={mode === k}
                          className={`lfp-tab${mode === k ? ' is-on' : ''}`} onClick={() => pickMode(k)}>
                    {label}{n !== '' && <span className="lfp-tab-n">{n}</span>}
                  </button>
                ))}
                <span className="lfp-tab-ind" style={{ left: `${(ti * 100) / tabs.length}%`, width: `${100 / tabs.length}%` }} />
              </div>
              {mode === 'name' && (
                <div className="lfp-searchbar">
                  <span className="lfp-mono-muted">
                    {search === 'results' ? `${results.length} results · UK databases` : search === 'loading' ? 'Searching…' : 'UK databases'}
                  </span>
                  <button type="button" role="switch" aria-checked={community} className="lfp-switch" onClick={toggleCommunity}>
                    Show user additions
                    <span className={`lfp-switch-track${community ? ' is-on' : ''}`}><i /></span>
                  </button>
                </div>
              )}
            </div>

            <div ref={contentRef} className="lfp-content">
              {rows.length > 0 && mode !== 'scan' && (
                <>
                  <div className="lfp-cols">
                    <span className="lfp-cols-name">{listLabel}</span><span>P·C·F</span><span className="lfp-right">KCAL</span><span />
                  </div>
                  {rows.map((row, i) => {
                    const f = row.food;
                    if (row.ghost) {
                      return (
                        <div key={row.key} data-row="1" className="lfp-row is-ghost">
                          <span className="lfp-ghost-t">Deleted · {f.food_name}</span>
                          <button type="button" className="lfp-undo" onClick={() => undoDelete(row.ghost)}>Undo</button>
                        </div>
                      );
                    }
                    const sp = energySplit(f);
                    const isLogged = logged === row.key;
                    const err = rowErr && rowErr.key === row.key ? rowErr.msg : null;
                    return (
                      <div
                        key={row.key}
                        data-row="1"
                        className={`lfp-row${focus === i ? ' is-focus' : ''}${isLogged ? ' is-logged' : ''}`}
                        onClick={() => openLog(row)}
                        onMouseEnter={() => { if (focus !== i) setFocus(i); }}
                      >
                        <span className="lfp-mark">
                          {row.user
                            ? <span className="lfp-mark-u">U</span>
                            : <BrandMark brand={f.brand} name={f.food_name} image={f.image} size={32} />}
                        </span>
                        <span className="lfp-name">
                          <span className="lfp-name-t">{f.food_name || f.name || '—'}</span>
                          <span className="lfp-name-s">
                            {row.user && <span className="lfp-userbadge">Added by a user</span>}
                            <span className={err ? 'lfp-err-t' : ''}>{err || subOf(f)}</span>
                          </span>
                        </span>
                        <span className="lfp-split" title={`Protein ${g1(f.protein_g)} g · Carbs ${g1(f.carbs_g)} g · Fat ${g1(f.fat_g)} g`}>
                          <i style={{ width: `${sp.p}%`, background: MACRO_COL.protein_g }} />
                          <i style={{ width: `${sp.c}%`, background: MACRO_COL.carbs_g }} />
                          <i style={{ width: `${sp.f}%`, background: MACRO_COL.fat_g }} />
                        </span>
                        <span className="lfp-kcal">{kcal(f.calories)}</span>
                        <span className="lfp-acts">
                          {isLogged && <span className="lfp-logged">Logged ✓</span>}
                          {row.canDel && (
                            <button type="button" className="lfp-del" aria-label={`Delete ${f.food_name}`}
                                    onClick={e => { e.stopPropagation(); deleteMeal(row); }}>×</button>
                          )}
                          {!isLogged && (
                            <button type="button" className="lfp-add" aria-label={`Log ${f.food_name} now`}
                                    disabled={!!busyKey}
                                    onClick={e => { e.stopPropagation(); logNow(row, e.currentTarget); }}>
                              {busyKey === row.key ? <span className="lfp-spin" /> : '+'}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}

              {mode === 'name' && search === 'loading' && (
                <>
                  <div className="lfp-loading"><span className="lfp-spin" />SEARCHING…</div>
                  {[90, 70, 80, 60, 75].map((w, i) => (
                    <div key={w} className="lfp-skel" style={{ opacity: 1 - i * 0.15 }}>
                      <span /><span><i style={{ width: `${w}%` }} /><i /></span><i /><i /><i />
                    </div>
                  ))}
                </>
              )}
              {mode === 'name' && search === 'idle' && (
                <div className="lfp-note">
                  <b>Search UK food databases</b>
                  <span>Type at least two letters.</span>
                </div>
              )}
              {mode === 'name' && search === 'error' && (
                <div className="lfp-alert" role="alert">
                  <span className="lfp-alert-l">// SEARCH DIDN&apos;T FINISH</span>
                  <span>{searchErr}</span>
                  <div className="lfp-alert-acts">
                    <button type="button" className="lfp-btn-ink" onClick={() => runSearch(query.trim(), community)}>Retry</button>
                    <button type="button" className="lfp-btn-line" onClick={() => openManual('')}>Enter manually</button>
                  </div>
                </div>
              )}
              {mode === 'name' && search === 'none' && (
                <div className="lfp-note">
                  <b>No matches for &quot;{query}&quot;</b>
                  <span>{community
                    ? 'Check the spelling, or try the brand name. User additions are already included.'
                    : 'Check the spelling, or turn on user additions above: other people may have added it.'}</span>
                  <button type="button" className="lfp-btn-acc" onClick={() => openManual(query.trim())}>Enter &quot;{query.trim()}&quot; manually</button>
                </div>
              )}
              {emptyMeals && (
                <div className="lfp-note">
                  <span className="lfp-label">// SAVED MEALS</span>
                  <b>No saved meals yet</b>
                  <span>When you log something you eat often, tick <b>Save as meal</b> and it will be one tap away here.</span>
                  <button type="button" className="lfp-btn-line" onClick={() => pickMode('name')}>Search for a food</button>
                </div>
              )}
              {emptyRecent && (
                <div className="lfp-note">
                  <span className="lfp-label">// RECENT</span>
                  <b>Nothing logged yet</b>
                  <span>Your last 15 foods will appear here, so logging them again takes a single +.</span>
                  <button type="button" className="lfp-btn-line" onClick={() => pickMode('name')}>Search for a food</button>
                </div>
              )}
              {mode === 'recent' && recent == null && <div className="lfp-loading"><span className="lfp-spin" />LOADING…</div>}
              {mode === 'scan' && canUseCamera && (
                <div className="lfp-scan">
                  <CameraScanner
                    ref={cameraRef}
                    onBarcode={async code => {
                      setPrevMode('scan'); setMode('name'); setQuery(code); setSearch('loading');
                      try {
                        const res = await searchByBarcode(code);
                        setResults(res); setSearch(res.length ? 'results' : 'none');
                      } catch (e) { setSearchErr(e && e.message ? e.message : 'Lookup failed.'); setSearch('error'); }
                    }}
                    onAIResult={food => openLog({ key: null, food: { ...food, __kind: 'search' } })}
                    onError={msg => { setSearchErr(msg); }}
                  />
                  <button type="button" className="lfp-btn-line" onClick={() => cameraRef.current && cameraRef.current.identify()}>Identify with AI</button>
                  <span className="lfp-mono-muted">Point at a barcode, or use AI to read a plate or packet.</span>
                </div>
              )}
            </div>

            <div className="lfp-foot">
              <button type="button" className="lfp-link" onClick={() => openManual('')}>Enter manually instead →</button>
              <span className="lfp-mono-muted">↑↓ move · ↵ pick · esc close</span>
            </div>
          </>
        ) : (
          <>
            <div className="lfp-logbody">
              <div className="lfp-loghead">
                <span className="lfp-mark lfp-mark-lg">
                  {pick && pick.manual
                    ? <span className="lfp-mark-u">+</span>
                    : pick && pick.food.source === 'community'
                      ? <span className="lfp-mark-u">U</span>
                      : <BrandMark brand={pick && pick.food.brand} name={pickName} image={pick && pick.food.image} size={40} />}
                </span>
                {pick && pick.manual ? (
                  <div className="lfp-manualname">
                    <input id="lfp-mname" value={manual.name} onChange={e => setManual(m => ({ ...m, name: e.target.value }))} placeholder="Food name" aria-label="Food name" />
                    <input id="lfp-mbrand" value={manual.brand} onChange={e => setManual(m => ({ ...m, brand: e.target.value }))} placeholder="Brand (optional)" aria-label="Brand" />
                  </div>
                ) : (
                  <div className="lfp-logname">
                    <span className="lfp-logname-t">{pickName}</span>
                    <span className="lfp-name-s">
                      {pick && pick.food.source === 'community' && <span className="lfp-userbadge">Added by a user</span>}
                      <span>{pick ? subOf(pick.food) : ''}</span>
                    </span>
                  </div>
                )}
              </div>

              <div className="lfp-sect">
                <span className="lfp-label">// MEAL</span>
                <div className="lfp-seg">
                  {MEALS.map(m => (
                    <button key={m} type="button" className={meal === m ? 'is-on' : ''} onClick={() => setMeal(m)}>{cap(m)}</button>
                  ))}
                </div>
              </div>

              <div className="lfp-sect">
                <span className="lfp-label">// SERVING</span>
                <div className="lfp-serving">
                  <div className="lfp-amount">
                    <input id="lfp-amount" type="number" min="0" inputMode="decimal" value={amount}
                           onChange={e => setAmount(e.target.value.slice(0, 6))} aria-label="Serving amount" />
                    <div className="lfp-unit">
                      {['g', 'ml'].map(u => (
                        <button key={u} type="button" className={unit === u ? 'is-on' : ''} onClick={() => setUnit(u)}>{u}</button>
                      ))}
                    </div>
                  </div>
                  {pick && !pick.manual && presetsFor(pick.food).map(p => (
                    <button key={p.amount} type="button"
                            className={`lfp-pill${Number(amount) === p.amount ? ' is-on' : ''}`}
                            onClick={() => setAmount(String(p.amount))}>
                      {p.label ? `${p.label} · ${p.amount}${unit}` : `${p.amount} ${unit}`}
                    </button>
                  ))}
                </div>
              </div>

              {values && (
                <div className="lfp-sum">
                  <div className="lfp-sum-top">
                    <span className="lfp-label">{`// FOR ${amount || 0} ${unit.toUpperCase()}`}</span>
                    <span className="lfp-mono-muted">
                      {pick.manual ? 'from your per-100 values' : `${kcal(pick.food.calories)} kcal per ${Math.round(baseOf(pick.food))} ${unit}`}
                    </span>
                  </div>
                  <div className="lfp-sum-kcal">
                    <b>{kcal(values.calories)}</b><span>kcal</span>
                    {calGoal > 0 && (
                      <em className={over ? 'is-over' : ''}>
                        {over ? `${kcal(after - calGoal)} over goal after this` : `${kcal(calGoal - after)} left after this`}
                      </em>
                    )}
                  </div>
                  <div className="lfp-sum-macros">
                    {[['Protein', 'protein_g', 'protein'], ['Carbs', 'carbs_g', 'carbs'], ['Fat', 'fat_g', 'fat']].map(([n, k, gk]) => {
                      const goal = Number(goals[gk]) || 0;
                      const had = Number(totals[k]) || 0;
                      const e0 = goal ? Math.min(100, (had / goal) * 100) : 0;
                      const add = goal ? Math.min(100 - e0, (values[k] / goal) * 100) : 0;
                      return (
                        <div key={k} className="lfp-mc">
                          <span className="lfp-mc-n"><i style={{ background: MACRO_COL[k] }} />{n}</span>
                          <span className="lfp-mc-v">{g1(values[k])}<small> g</small></span>
                          <span className="lfp-mc-bar">
                            <i style={{ width: `${e0}%`, background: MACRO_COL[k], opacity: 0.35 }} />
                            <i style={{ width: `${add}%`, background: MACRO_COL[k] }} />
                          </span>
                          {goal > 0 && <span className="lfp-mono-muted">→ {Math.round(((had + values[k]) / goal) * 100)}% of goal</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="lfp-micro">
                    <span>Fibre<b>{g1(values.fibre_g)} g</b></span>
                    <span>Sugar<b>{g1(values.sugar_g)} g</b></span>
                    <span>Sodium<b>{Math.round(values.sodium_mg)} mg</b></span>
                  </div>
                </div>
              )}

              {pick && pick.manual && (
                <div className="lfp-sect">
                  <span className="lfp-label">{`// NUTRITION PER 100 ${unit.toUpperCase()}`}</span>
                  <div className="lfp-manual">
                    {MANUAL_FIELDS.map(([k, label]) => (
                      <label key={k}>
                        {label}
                        <input id={`lfp-m-${k}`} type="number" min="0" inputMode="decimal" value={manual[k]}
                               onChange={e => { const v = e.target.value.slice(0, 7); setManual(m => ({ ...m, [k]: v })); }} />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="lfp-checks">
                <button type="button" role="checkbox" aria-checked={saveMealOn} className="lfp-check" onClick={() => setSaveMealOn(v => !v)}>
                  <span className={`lfp-box${saveMealOn ? ' is-on' : ''}`}>{saveMealOn ? '✓' : ''}</span>Save as meal
                </button>
                {pick && pick.manual && !shareProblem && (
                  <button type="button" role="checkbox" aria-checked={share} className="lfp-check lfp-check-top" onClick={() => setShare(v => !v)}>
                    <span className={`lfp-box${share ? ' is-on' : ''}`}>{share ? '✓' : ''}</span>
                    <span className="lfp-check-t">
                      <span>Add to the shared food database</span>
                      <span className="lfp-check-s">Other users searching for this will find it. Your name is not attached.</span>
                    </span>
                  </button>
                )}
              </div>

              {phase === 'error' && (
                <div className="lfp-alert" role="alert">
                  <span className="lfp-alert-l">// NOT SAVED</span>
                  <span>{saveErr} Everything you entered is still here. Retry, or cancel and try again later.</span>
                </div>
              )}
            </div>
            <div className="lfp-logfoot">
              <button type="button" className="lfp-btn-line lfp-btn-lg" onClick={onClose}>Cancel</button>
              <button ref={logBtnRef} type="button" className="lfp-btn-acc lfp-btn-lg lfp-grow" disabled={!canLog} onClick={logIt}>
                {phase === 'saving' && <span className="lfp-spin" />}
                {phase === 'saving' ? 'Saving…' : phase === 'error' ? `Retry · ${kcal(values ? values.calories : 0)} kcal` : `Log it · ${kcal(values ? values.calories : 0)} kcal`}
              </button>
            </div>
          </>
        )}
      </div>
    </aside>,
    document.body,
  );
}
