/**
 * Shared product-page scraper.
 *
 * Extracted from shop-autofill so the price checker can reuse exactly
 * the same fetch hardening and parsing rather than growing a second,
 * subtly-different copy. Both callers get the SSRF host block, the
 * timeout, the 1 MB response cap, and the JSON-LD -> OpenGraph ->
 * Twitter -> <title> fallback chain.
 *
 * No env vars, no external APIs — it fetches the page and parses it
 * in-process.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_000_000; // pages above this are truncated

// ── Fetch with timeout + size cap ──────────────────────────────────────────

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Pose as a regular browser — many e-commerce sites 403 on the
      // default node fetch UA. Don't include cookies / credentials.
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VisionBoardBot/1.0; +https://visionboard.app/bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('xml')) {
      throw new Error('Not an HTML response');
    }

    // Stream up to MAX_HTML_BYTES so a giant page doesn't OOM the lambda
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.length;
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function isBlockedHost(host) {
  if (!host) return true;
  const lower = host.toLowerCase();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.local')) return true;
  if (lower.endsWith('.internal')) return true;
  // RFC1918 + loopback + link-local IPv4
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  // Loopback IPv6
  if (lower === '::1' || lower === '[::1]') return true;
  return false;
}

// ── HTML extraction ────────────────────────────────────────────────────────

function extractProductInfo(html, urlObj) {
  // Strip <script> and <style> blobs early so meta tag regexes don't
  // accidentally match content inside them.
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // ── Strategy 1: JSON-LD schema.org Product ──
  // Re-include script tags here only for type=application/ld+json.
  const ldjson = extractAllJsonLd(html);
  for (const block of ldjson) {
    const product = findProduct(block);
    if (product) {
      return {
        name:     stringify(product.name),
        price:    formatPrice(extractPrice(product), urlObj),
        imageUrl: pickImage(product.image, urlObj),
        notes:    truncate(stringify(product.description), 220),
        source:   'json-ld',
      };
    }
  }

  // ── Strategy 2: OpenGraph tags ──
  const og = {
    title: meta(cleaned, 'property="og:title"') || meta(cleaned, "property='og:title'"),
    image: meta(cleaned, 'property="og:image"') || meta(cleaned, "property='og:image'"),
    description: meta(cleaned, 'property="og:description"') || meta(cleaned, "property='og:description'"),
    price_amount:   meta(cleaned, 'property="product:price:amount"') || meta(cleaned, 'property="og:price:amount"'),
    price_currency: meta(cleaned, 'property="product:price:currency"') || meta(cleaned, 'property="og:price:currency"'),
  };

  if (og.title || og.image) {
    return {
      name:     og.title || '',
      price:    formatPriceParts(og.price_amount, og.price_currency, urlObj),
      imageUrl: og.image ? toAbsoluteUrl(og.image, urlObj) : '',
      notes:    truncate(og.description || '', 220),
      source:   'open-graph',
    };
  }

  // ── Strategy 3: Twitter Card ──
  const tw = {
    title: meta(cleaned, 'name="twitter:title"'),
    image: meta(cleaned, 'name="twitter:image"'),
    description: meta(cleaned, 'name="twitter:description"'),
  };
  if (tw.title || tw.image) {
    return {
      name:     tw.title || '',
      price:    '',
      imageUrl: tw.image ? toAbsoluteUrl(tw.image, urlObj) : '',
      notes:    truncate(tw.description || '', 220),
      source:   'twitter',
    };
  }

  // ── Strategy 4: <title> tag fallback ──
  const titleMatch = cleaned.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    name:     titleMatch ? truncate(titleMatch[1].trim(), 100) : '',
    price:    '',
    imageUrl: '',
    notes:    '',
    source:   'title-tag',
  };
}

function extractAllJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { blocks.push(JSON.parse(m[1].trim())); }
    catch { /* malformed JSON-LD, skip */ }
  }
  return blocks;
}

// JSON-LD can be a single object, an array, or a @graph wrapper.
// Recursively find the first node with @type "Product".
function findProduct(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return node;
  if (node['@graph']) return findProduct(node['@graph']);
  return null;
}

function extractPrice(product) {
  const o = product.offers;
  if (!o) return null;
  if (Array.isArray(o)) {
    return { price: o[0]?.price, currency: o[0]?.priceCurrency };
  }
  if (typeof o === 'object') {
    return { price: o.price, currency: o.priceCurrency };
  }
  return null;
}

function formatPrice(p, urlObj) {
  if (!p || p.price == null) return '';
  return formatPriceParts(p.price, p.currency, urlObj);
}

function formatPriceParts(amount, currency, urlObj) {
  if (!amount) return '';
  const num = String(amount).trim();
  // Common currency symbols
  const sym = {
    GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$',
    JPY: '¥', INR: '₹',
  };
  let cur = (currency || '').toUpperCase().trim();
  // Default to GBP for .uk hosts when not specified — matches user
  // expectation in the existing app copy.
  if (!cur && /\.uk$/.test(urlObj.hostname)) cur = 'GBP';
  if (sym[cur]) return sym[cur] + num;
  if (cur)      return cur + ' ' + num;
  return num;
}

function pickImage(field, urlObj) {
  if (!field) return '';
  if (typeof field === 'string') return toAbsoluteUrl(field, urlObj);
  if (Array.isArray(field)) {
    const first = field.find(Boolean);
    if (typeof first === 'string') return toAbsoluteUrl(first, urlObj);
    if (first && typeof first === 'object' && first.url) return toAbsoluteUrl(first.url, urlObj);
    return '';
  }
  if (typeof field === 'object' && field.url) return toAbsoluteUrl(field.url, urlObj);
  return '';
}

function toAbsoluteUrl(maybeRelative, urlObj) {
  try { return new URL(maybeRelative, urlObj.origin).toString(); }
  catch { return ''; }
}

function meta(html, attrFragment) {
  // Single-quoted variant matched separately by the caller. Look for
  // <meta ... attrFragment ... content="..."> in either attribute order.
  const a = new RegExp(`<meta[^>]*${escapeForRegex(attrFragment)}[^>]*\\bcontent\\s*=\\s*"([^"]*)"`, 'i');
  const b = new RegExp(`<meta[^>]*\\bcontent\\s*=\\s*"([^"]*)"[^>]*${escapeForRegex(attrFragment)}`, 'i');
  return (html.match(a)?.[1] || html.match(b)?.[1] || '').trim();
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.find(x => typeof x === 'string')?.trim() || '';
  return '';
}

function truncate(s, n) {
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Numeric amount from a formatted price string ("£1,299.00" -> 1299). */
function priceToNumber(str) {
  if (str == null) return null;
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;
  const m = String(str).replace(/[,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Currency symbol/code prefix of a formatted price, for re-rendering. */
function pricePrefix(str) {
  if (!str) return '';
  const m = String(str).match(/^[^\d-]*/);
  return m ? m[0].trim() : '';
}

module.exports = {
  FETCH_TIMEOUT_MS,
  MAX_HTML_BYTES,
  fetchWithTimeout,
  isBlockedHost,
  extractProductInfo,
  priceToNumber,
  pricePrefix,
};
