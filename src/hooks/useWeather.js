import { useEffect, useState } from 'react';

/**
 * useWeather — current conditions for the greeting-header chip.
 *
 * Calls the key-less `weather` Netlify function (server-side IP geo +
 * Open-Meteo), caches the result in localStorage for 30 minutes so the
 * chip is instant on subsequent loads and we don't hammer the function.
 * Returns null until loaded, and stays null on any failure (the chip
 * simply doesn't render — never blocks the header).
 *
 * `enabled` lets the caller skip fetching entirely when the user has
 * toggled weather off.
 */
const LS_KEY = 'vb4_weather_cache';
const TTL_MS = 30 * 60 * 1000;

// WMO weather code → { icon (Icon.jsx name), label }. `isDay` swaps the
// clear-sky glyph between sun and moon.
export function weatherGlyph(code, isDay = true) {
  if (code === 0) return { icon: isDay ? 'sun' : 'moon', label: 'Clear' };
  if (code === 1 || code === 2) return { icon: isDay ? 'cloud-sun' : 'cloud', label: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: 'cloud-fog', label: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: 'cloud-drizzle', label: 'Drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: 'cloud-rain', label: 'Rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'cloud-snow', label: 'Snow' };
  if (code >= 95) return { icon: 'cloud-lightning', label: 'Thunderstorm' };
  return { icon: 'cloud', label: 'Cloudy' };
}

export function useWeather(enabled = true) {
  const [weather, setWeather] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (raw && Date.now() - raw.at < TTL_MS && raw.data && raw.data.tempC != null) return raw.data;
    } catch { /* ignore */ }
    return null;
  });

  useEffect(() => {
    if (!enabled) return;
    // Fresh cached value already in state → don't refetch.
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (raw && Date.now() - raw.at < TTL_MS && raw.data?.tempC != null) return;
    } catch { /* ignore */ }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/.netlify/functions/weather');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data && typeof data.tempC === 'number') {
          setWeather(data);
          try { localStorage.setItem(LS_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
        }
      } catch { /* fail soft — chip stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return weather;
}
