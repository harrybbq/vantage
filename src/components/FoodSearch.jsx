import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { BrandMark } from './food/BrandMark';
import CameraScanner from './CameraScanner';
import { supabase } from '../lib/supabase';
import { backdropClose } from '../utils/backdropClose';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { authFetch } from '../lib/authFetch';

async function searchByBarcode(barcode) {
  const res = await authFetch(`/.netlify/functions/food-search?mode=barcode&q=${encodeURIComponent(barcode)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Lookup failed');
  return json.products || [];
}

async function searchByName(query) {
  const res = await authFetch(`/.netlify/functions/food-search?mode=name&q=${encodeURIComponent(query)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Search failed');
  return json.products || [];
}

export default function FoodSearch({ onSelectFood, onClose, onOpenModal, savedMeals = [], onDeleteMeal, userId }) {
  // Camera scanning (barcode + AI identify) is a Pro feature — matches
  // the privacy policy's "AI food scanner (Pro)" disclosure. The owner
  // flag keeps it testable on the owner account regardless of tier.
  // ZXing fallback means it works on iOS Safari and desktop webcams.
  const { hasPro } = useSubscriptionContext();
  const canUseCamera = hasPro || (typeof window !== 'undefined' && !!window.__vantageOwner);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);
  // mode: 'search' | 'camera' | 'meals' | 'recent'
  // Barcodes are scan-only now — searchByBarcode is still used, but only
  // by the camera scanner's detection callback, never a typed-in number.
  // Default to Meals when the user has saved some — that's usually the
  // fastest path for a repeat log; otherwise Recent if we have history,
  // else the name search.
  const [mode, setMode] = useState(savedMeals.length ? 'meals' : 'search');
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const cameraRef = useRef(null);
  const [identifying, setIdentifying] = useState(false);

  // Recent foods — the user's own last-logged items, deduped by name so
  // repeat meals are one tap to re-log (the biggest daily friction point).
  // RLS scopes nutrition_log to this user; we still filter for perf.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      let data;
      try {
        ({ data } = await supabase
          .from('nutrition_log')
          .select('food_name,brand,serving_g,calories,protein_g,carbs_g,fat_g,fibre_g,sugar_g,sodium_mg,additional_nutrients,log_date,id')
          .eq('user_id', userId)
          .order('log_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(80));
      } catch { return; } // fail soft — the Recent tab just won't appear
      if (cancelled || !Array.isArray(data)) return;
      const seen = new Set();
      const out = [];
      for (const r of data) {
        const key = String(r.food_name || '').toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          food_name: r.food_name, brand: r.brand || '',
          serving_g: r.serving_g, serving_unit: r.additional_nutrients?.serving_unit === 'ml' ? 'ml' : 'g',
          calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g,
          fibre_g: r.fibre_g, sugar_g: r.sugar_g, sodium_mg: r.sodium_mg,
        });
        if (out.length >= 15) break;
      }
      setRecent(out);
      // If the user has no saved meals but does have history, open on
      // Recent — it's the fastest repeat-log path.
      if (!savedMeals.length && out.length) setMode(m => (m === 'search' ? 'recent' : m));
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (mode !== 'camera' && mode !== 'meals' && mode !== 'recent') inputRef.current?.focus();
  }, [mode]);

  // Escape backs out — the third way out, alongside the Cancel button
  // and tapping the backdrop.
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  function handleQueryChange(val) {
    setQuery(val);
    setError('');
    clearTimeout(debounceRef.current);
    if (!val.trim() || val.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(val.trim()), 500);
  }

  async function doSearch(q) {
    setLoading(true);
    try {
      const res = await searchByName(q);
      if (res.length === 0) setError('No results found. Try a different search or add manually.');
      setResults(res);
    } catch (e) {
      // Surface what actually went wrong. The old blanket "check your
      // connection" hid 401s, rate limits and upstream timeouts behind
      // the one message that was almost never the real cause.
      setError(e?.message ? `Search failed — ${e.message}` : 'Search failed — check your connection.');
    }
    setLoading(false);
  }

  // Called when CameraScanner detects a barcode
  async function handleCameraBarcode(code) {
    setMode('search'); // switch away from camera to show results
    setLoading(true);
    setError('');
    try {
      const res = await searchByBarcode(code);
      if (res.length === 0) {
        setError(`Barcode ${code} not found — add manually.`);
      } else {
        setResults(res);
      }
    } catch {
      setError('Barcode lookup failed — check your connection.');
    }
    setLoading(false);
  }

  // Called when CameraScanner returns AI-identified food
  function handleAIResult(food) {
    // Pass AI result directly to the food log sheet (as prefill)
    onSelectFood(food);
  }

  function handleCameraError(msg) {
    setError(msg);
  }

  function switchMode(m) {
    setMode(m);
    setQuery('');
    setResults([]);
    setError('');
  }

  const inputStyle = {
    flex: 1, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-base)', color: 'var(--text)', fontSize: 'var(--text-sm)',
    fontFamily: 'var(--sans)', outline: 'none',
  };

  const tabs = [
    ...(savedMeals.length ? [['meals', 'Meals']] : []),
    ...(recent.length ? [['recent', 'Recent']] : []),
    ['search', 'Name'],
    ...(canUseCamera ? [['camera', 'Scan']] : []),
  ];

  /* PORTALLED TO <body>, and it has to be.
   *
   * This sheet is rendered from inside NutritionSection, whose root is a
   * .card — and .card carries backdrop-filter. Any backdrop-filter (like
   * a transform) makes an element a containing block for position:fixed
   * descendants, so `inset:0` resolved against the nutrition card rather
   * than the viewport. On the desktop Track page that pinned the whole
   * search to the third column and let it travel with page scroll, which
   * is how the header — and with it the only way to cancel — ended up
   * above the top of the screen. Measured before the fix: the overlay's
   * own box sat at y = -428 on a 1440x900 window scrolled 600px down.
   *
   * A portal escapes every ancestor, so `fixed` means the viewport again
   * no matter what the surrounding layout does.
   */
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 510, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}
      {...backdropClose(() => onClose())}
    >
      {/* maxHeight 72dvh (was 88): with many results the sheet used to
          swallow nearly the whole screen, leaving almost no backdrop to
          tap to dismiss. Results scroll internally; the top ~28% of the
          screen always stays tappable to close. */}
      <div style={{ width: '100%', background: 'var(--bg-base)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', animation: 'sheet-up 300ms cubic-bezier(0.34,1.56,0.64,1) both', maxHeight: '72dvh', display: 'flex', flexDirection: 'column' }}>
        {/* Handle */}
        <div style={{ width: '40px', height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '0 auto 18px', flexShrink: 0 }} />

        {/* Title + cancel. A labelled button, not a bare glyph: "no
            visible way to cancel" was the complaint, and an X in a
            corner reads as decoration next to a wall of results. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text)', fontFamily: 'var(--serif)' }}>Search Foods</h3>
          <button
            onClick={onClose}
            aria-label="Cancel and close food search"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0,
              padding: '8px 14px', borderRadius: '999px',
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-mid)', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '1.2px', textTransform: 'uppercase',
            }}
          ><Icon name="x" size={13} />Cancel</button>
        </div>

        {/* Mode tabs — segmented control, mono caps, no glyphs */}
        <div role="tablist" aria-label="Search mode" style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '14px', flexShrink: 0, alignSelf: 'flex-start' }}>
          {tabs.map(([m, label], i) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
              style={{
                padding: '8px 18px', border: 'none',
                borderRight: i < tabs.length - 1 ? '1px solid var(--border)' : 'none',
                background: mode === m ? 'rgba(var(--em-rgb), .14)' : 'transparent',
                color: mode === m ? 'var(--em)' : 'var(--text-muted)',
                fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '1.2px',
                textTransform: 'uppercase', fontWeight: mode === m ? 700 : 500,
                cursor: 'pointer', transition: 'background .15s, color .15s',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Camera view (owner-only — the tab doesn't render otherwise) */}
        {mode === 'camera' && canUseCamera && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <CameraScanner
              ref={cameraRef}
              onBarcode={handleCameraBarcode}
              onAIResult={handleAIResult}
              onError={handleCameraError}
            />
            <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
              Point at a barcode or product QR to auto-scan, or use AI to detect a plate / packaging in frame.
            </p>
            {/* Always-visible AI identify — lives outside the camera box
                so it can never be hidden by camera state. */}
            <button
              onClick={async () => { setIdentifying(true); await cameraRef.current?.identify(); setIdentifying(false); }}
              disabled={identifying}
              style={{ padding: '12px', borderRadius: 'var(--radius-md)', border: 'none', background: identifying ? 'rgba(26,122,74,.6)' : 'var(--em)', color: '#fff', cursor: identifying ? 'default' : 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              {identifying ? 'Identifying…' : 'Identify with AI'}
            </button>
            {error && (
              <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,.08)', borderRadius: 'var(--radius-md)', color: '#e05252', fontSize: 'var(--text-sm)', fontFamily: 'var(--mono)' }}>
                {error}
              </div>
            )}
            <button onClick={() => onSelectFood(null)}
              style={{ marginTop: 'auto', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)' }}>
              Enter manually instead
            </button>
          </div>
        )}

        {/* Saved meals list */}
        {mode === 'meals' && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {!savedMeals.length ? (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
                No saved meals yet. Log a food with its macros and tap
                <strong style={{ color: 'var(--text-mid)' }}> Save as a meal for later</strong> to build your quick-log list.
              </div>
            ) : savedMeals.map(meal => (
              <div key={meal.id} style={{ display: 'flex', alignItems: 'stretch', gap: '8px', marginBottom: '8px' }}>
                <button onClick={() => onSelectFood(meal)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--sans)', minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meal.name}</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-mid)' }}>{Math.round(parseFloat(meal.calories) || 0)} kcal</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>P {Math.round(parseFloat(meal.protein_g) || 0)}g</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>C {Math.round(parseFloat(meal.carbs_g) || 0)}g</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>F {Math.round(parseFloat(meal.fat_g) || 0)}g</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>{Math.round(parseFloat(meal.serving_g) || 0)}g serving</span>
                    </div>
                  </div>
                  <span style={{ color: 'var(--em)', flexShrink: 0, display: 'inline-flex' }}><Icon name="plus" size={16} /></span>
                </button>
                <button onClick={() => onDeleteMeal?.(meal.id)} aria-label={`Delete ${meal.name}`}
                  style={{ flexShrink: 0, width: '40px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="trash-2" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recent foods — one-tap re-log of the user's own history */}
        {mode === 'recent' && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {!recent.length ? (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
                Nothing logged yet — foods you log will show here for one-tap re-logging.
              </div>
            ) : recent.map((item, i) => (
              <button key={i} onClick={() => onSelectFood(item)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', marginBottom: '8px', fontFamily: 'var(--sans)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.food_name}</div>
                  {item.brand && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '1px' }}>{item.brand}</div>}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-mid)' }}>{Math.round(parseFloat(item.calories) || 0)} kcal</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>P {Math.round(parseFloat(item.protein_g) || 0)}g</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>C {Math.round(parseFloat(item.carbs_g) || 0)}g</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>F {Math.round(parseFloat(item.fat_g) || 0)}g</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>{Math.round(parseFloat(item.serving_g) || 0)}{item.serving_unit || 'g'}</span>
                  </div>
                </div>
                <span style={{ color: 'var(--em)', flexShrink: 0, display: 'inline-flex' }}><Icon name="plus" size={16} /></span>
              </button>
            ))}
          </div>
        )}

        {/* Name search UI */}
        {mode !== 'camera' && mode !== 'meals' && mode !== 'recent' && (
          <>
            {/* Search row */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexShrink: 0 }}>
              <input
                ref={inputRef}
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                style={inputStyle}
                placeholder="e.g. chicken breast, oat milk…"
                type="text"
              />
            </div>

            {/* Attribution + the units note. "per 100g" used to repeat on
                every single row; saying it once here buys back a chip's
                width on each result. */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: '10px', flexShrink: 0 }}>
              <span>Data: Open Food Facts (openfoodfacts.org) — CC BY-SA</span>
              {results.length > 0 && (
                <span style={{ flexShrink: 0, letterSpacing: '.6px' }}>
                  {results.length} result{results.length > 1 ? 's' : ''} · per 100g
                </span>
              )}
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {loading && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 'var(--text-sm)' }}>Searching…</div>
              )}
              {!loading && error && (
                <div style={{ padding: '12px', background: 'rgba(220,38,38,.08)', borderRadius: 'var(--radius-md)', color: '#e05252', fontSize: 'var(--text-sm)', fontFamily: 'var(--mono)' }}>{error}</div>
              )}
              {/* Result row: mark · name + brand + macros · kcal · add.
                  The brand mark leads (it's the fastest thing to scan
                  down a list of near-identical names) and calories get
                  their own column on the right, so ten "Big Mac" rows
                  are told apart by the number that actually differs
                  rather than by reading four chips into each line. */}
              {!loading && !error && results.map((item, i) => (
                <button key={i} onClick={() => onSelectFood(item)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '11px', padding: '10px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', marginBottom: '6px', fontFamily: 'var(--sans)' }}>
                  <BrandMark brand={item.brand} name={item.food_name} image={item.image} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.food_name || '—'}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '2px', minWidth: 0 }}>
                      {item.brand && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.brand}</span>
                      )}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        P {Math.round(item.protein_g)} · C {Math.round(item.carbs_g)} · F {Math.round(item.fat_g)}
                      </span>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right', fontFamily: 'var(--mono)' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(item.calories)}</div>
                    <div style={{ fontSize: '8.5px', letterSpacing: '.8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>kcal</div>
                  </div>
                  <span style={{ color: 'var(--em)', flexShrink: 0, alignSelf: 'center', display: 'inline-flex' }}><Icon name="plus" size={16} /></span>
                </button>
              ))}
              {!loading && !error && !results.length && query.trim().length >= 2 && mode === 'search' && (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 'var(--text-sm)' }}>Searching…</div>
              )}
            </div>

            {/* Enter manually shortcut */}
            <button onClick={() => onSelectFood(null)}
              style={{ marginTop: '14px', width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)', flexShrink: 0 }}>
              Enter manually instead
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
