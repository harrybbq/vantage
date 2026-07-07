import { useState, useRef, useEffect } from 'react';
import CameraScanner from './CameraScanner';
import { backdropClose } from '../utils/backdropClose';

async function searchByBarcode(barcode) {
  const res = await fetch(`/.netlify/functions/food-search?mode=barcode&q=${encodeURIComponent(barcode)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Lookup failed');
  return json.products || [];
}

async function searchByName(query) {
  const res = await fetch(`/.netlify/functions/food-search?mode=name&q=${encodeURIComponent(query)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Search failed');
  return json.products || [];
}

export default function FoodSearch({ onSelectFood, onClose, onOpenModal }) {
  // Camera scanning is OWNER-ONLY for now (per owner call, 2026-07) —
  // the tab simply doesn't exist for other accounts. ZXing fallback
  // means it works on iOS Safari and desktop webcams too, so no
  // mobile restriction. Widen to Pro later by loosening this flag.
  const canUseCamera = typeof window !== 'undefined' && !!window.__vantageOwner;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // mode: 'search' | 'barcode' | 'camera' (camera only available on mobile + pro)
  const [mode, setMode] = useState('search');
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (mode !== 'camera') inputRef.current?.focus();
  }, [mode]);

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
      const res = mode === 'barcode' ? await searchByBarcode(q) : await searchByName(q);
      if (res.length === 0) setError('No results found. Try a different search or add manually.');
      setResults(res);
    } catch {
      setError('Search failed — check your connection.');
    }
    setLoading(false);
  }

  async function handleBarcodeSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await searchByBarcode(query.trim());
      if (res.length === 0) setError('Barcode not found in Open Food Facts. Add manually instead.');
      setResults(res);
    } catch {
      setError('Lookup failed — check your connection.');
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
    ['search', '🔍 Name'],
    ['barcode', '🔢 Barcode'],
    ...(canUseCamera ? [['camera', '📷 Scan']] : []),
  ];

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 510, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end' }}
      {...backdropClose(() => onClose())}
    >
      <div style={{ width: '100%', background: 'var(--bg-base)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', animation: 'sheet-up 300ms cubic-bezier(0.34,1.56,0.64,1) both', maxHeight: '88dvh', display: 'flex', flexDirection: 'column' }}>
        {/* Handle */}
        <div style={{ width: '40px', height: '4px', background: 'var(--border)', borderRadius: '2px', margin: '0 auto 18px', flexShrink: 0 }} />

        {/* Title + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--text)', fontFamily: 'var(--serif)' }}>Search Foods</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexShrink: 0 }}>
          {tabs.map(([m, label]) => (
            <button key={m} onClick={() => switchMode(m)}
              style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', background: mode === m ? 'var(--em)' : 'transparent', color: mode === m ? '#fff' : 'var(--text-mid)', fontSize: 'var(--text-sm)', cursor: 'pointer', fontFamily: 'var(--sans)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Camera view (owner-only — the tab doesn't render otherwise) */}
        {mode === 'camera' && canUseCamera && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <CameraScanner
              onBarcode={handleCameraBarcode}
              onAIResult={handleAIResult}
              onError={handleCameraError}
            />
            <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
              Point at a barcode or GS1 QR to auto-scan, or tap <strong style={{ color: 'var(--text-mid)' }}>Identify Food with AI</strong> to detect what's in frame.
            </p>
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

        {/* Text / barcode search UI */}
        {mode !== 'camera' && (
          <>
            {/* Search row */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexShrink: 0 }}>
              <input
                ref={inputRef}
                value={query}
                onChange={e => mode === 'search' ? handleQueryChange(e.target.value) : setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && mode === 'barcode' && handleBarcodeSearch()}
                style={inputStyle}
                placeholder={mode === 'search' ? 'e.g. chicken breast, oat milk…' : 'Enter barcode number…'}
                type={mode === 'barcode' ? 'number' : 'text'}
              />
              {mode === 'barcode' && (
                <button onClick={handleBarcodeSearch} style={{ padding: '10px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--em)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--text-sm)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Look up
                </button>
              )}
            </div>

            {/* Attribution */}
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: '10px', flexShrink: 0 }}>
              Data: Open Food Facts (openfoodfacts.org) — CC BY-SA
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {loading && (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 'var(--text-sm)' }}>Searching…</div>
              )}
              {!loading && error && (
                <div style={{ padding: '12px', background: 'rgba(220,38,38,.08)', borderRadius: 'var(--radius-md)', color: '#e05252', fontSize: 'var(--text-sm)', fontFamily: 'var(--mono)' }}>{error}</div>
              )}
              {!loading && !error && results.map((item, i) => (
                <button key={i} onClick={() => onSelectFood(item)}
                  style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'left', marginBottom: '8px', fontFamily: 'var(--sans)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.food_name || '—'}</div>
                    {item.brand && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '1px' }}>{item.brand}</div>}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-mid)' }}>{Math.round(item.calories)} kcal</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>P {Math.round(item.protein_g)}g</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>C {Math.round(item.carbs_g)}g</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>F {Math.round(item.fat_g)}g</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-muted)' }}>per 100g</span>
                    </div>
                  </div>
                  <span style={{ color: 'var(--em)', fontSize: '18px', flexShrink: 0, alignSelf: 'center' }}>+</span>
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
    </div>
  );
}
