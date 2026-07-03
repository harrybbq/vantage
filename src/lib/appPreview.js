/**
 * Cached app preview fetcher.
 *
 * Repurposes the existing /.netlify/functions/shop-autofill endpoint
 * (which scrapes JSON-LD / og:* / twitter:* tags from any URL) to
 * power the "live-data" Our Apps presets — see src/data/appPresets.js.
 *
 * 24h localStorage cache keyed by URL so we don't hammer the function
 * (or the target site) on every widget mount. Returns whatever the
 * scraper found: { name, imageUrl, notes, price } — any of which may
 * be undefined. Callers should render whatever's there and fall back
 * gracefully when nothing came back.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'vb4_appPreview:';
// In-flight de-dupe — multiple widgets pointing at the same URL only
// fire one network round-trip per page load.
const inflight = new Map();

function cacheKey(url) { return STORAGE_PREFIX + url; }

function readCache(url) {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return parsed.data || null;
  } catch { return null; }
}

function writeCache(url, data) {
  try {
    localStorage.setItem(cacheKey(url), JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota — non-fatal */ }
}

/**
 * Fetch (or read cached) preview for a URL. Resolves to an object —
 * never throws. Empty `{}` means we tried and got nothing useful.
 */
export async function fetchAppPreview(url) {
  if (!url) return {};
  const cached = readCache(url);
  if (cached) return cached;
  if (inflight.has(url)) return inflight.get(url);

  const p = (async () => {
    try {
      const res = await fetch('/.netlify/functions/shop-autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return {};
      const body = await res.json().catch(() => ({}));
      if (!body || !body.ok) return {};
      const data = {
        name: body.name || '',
        imageUrl: body.imageUrl || '',
        notes: body.notes || '',
      };
      writeCache(url, data);
      return data;
    } catch {
      return {};
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}
