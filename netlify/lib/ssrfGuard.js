/**
 * Is it safe for a function to fetch this URL on a user's behalf?
 *
 * shop-autofill and shop-price-check fetch any product link a user
 * pastes, from inside Netlify's network. The old guard was a list of
 * hostname prefixes, and it missed most of the ways to name an internal
 * address: 0.0.0.0, CGNAT (100.64/10), IPv6 ULA and link-local,
 * IPv4-mapped IPv6 (::ffff:127.0.0.1), and — the big one — any ordinary
 * DNS name that simply RESOLVES to a private address. It also followed
 * redirects without looking, so a public page could 302 us inward.
 *
 * Now: only http/https on the default ports; the hostname is resolved
 * and EVERY address it resolves to must be public; and productPage.js
 * follows redirects by hand, re-running this check on each hop.
 *
 * Known residual: fetch() resolves the name again after we have, so a
 * DNS answer that changes between the two (rebinding) is not closed by
 * this. Closing it needs a pinned-address dispatcher (undici Agent with
 * a custom lookup) — not a dependency this repo carries today.
 *
 * The address classifier is pure and tested by
 * netlify/lib/ssrfGuard.test.mjs (npm run check:ssrf).
 */
const net = require('node:net');
const dns = require('node:dns').promises;

// ── Pure classification ────────────────────────────────────────────────

function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(n => n <= 255) ? o : null;
}

function isBlockedIPv4(o) {
  const [a, b, c] = o;
  if (a === 0) return true;                              // 0.0.0.0/8 "this network"
  if (a === 10) return true;                             // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64/10
  if (a === 127) return true;                            // loopback
  if (a === 169 && b === 254) return true;               // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;      // RFC1918
  if (a === 192 && b === 0 && c === 0) return true;      // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true;      // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;    // 6to4 relay anycast
  if (a === 192 && b === 168) return true;               // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true;   // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;    // TEST-NET-3
  if (a >= 224) return true;                             // multicast, reserved, broadcast
  return false;
}

/** 'x:y::z' (optionally with a trailing dotted IPv4) → eight 16-bit ints, or null. */
function parseIPv6(s) {
  let str = s.toLowerCase();
  const zone = str.indexOf('%');
  if (zone !== -1) str = str.slice(0, zone);
  // Trailing embedded IPv4 → two hextets.
  const v4m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(str);
  if (v4m) {
    const o = parseIPv4(v4m[2]);
    if (!o) return null;
    str = v4m[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const side = h => (h === '' ? [] : h.split(':'));
  const head = side(halves[0]);
  const tail = halves.length === 2 ? side(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const parts = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (parts.length !== 8) return null;
  const out = [];
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out;
}

function isBlockedIPv6(h) {
  const v4At = (hi, lo) => [h[hi] >> 8, h[hi] & 255, h[lo] >> 8, h[lo] & 255];
  const zeros = n => h.slice(0, n).every(x => x === 0);
  if (zeros(8)) return true;                                  // :: unspecified
  if (zeros(7) && h[7] === 1) return true;                    // ::1 loopback
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d — a public
  // site has no reason to publish either, so both are refused outright.
  if (zeros(5) && h[5] === 0xffff) return true;
  if (zeros(6)) return true;
  if (h[0] === 0x64 && h[1] === 0xff9b) return isBlockedIPv4(v4At(6, 7)); // NAT64
  if (h[0] === 0x2002) return isBlockedIPv4(v4At(1, 2));      // 6to4 carries an IPv4
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true;        // documentation
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true; // discard 100::/64
  if ((h[0] & 0xfe00) === 0xfc00) return true;                // ULA fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true;                // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true;                // old site-local fec0::/10
  if ((h[0] & 0xff00) === 0xff00) return true;                // multicast
  return false;
}

/** Any textual IP address → blocked? Non-IP input is treated as blocked. */
function isBlockedAddress(ip) {
  const s = String(ip || '').replace(/^\[|\]$/g, '');
  const kind = net.isIP(s.split('%')[0]);
  if (kind === 4) return isBlockedIPv4(parseIPv4(s));
  if (kind === 6) {
    const h = parseIPv6(s);
    return !h || isBlockedIPv6(h);
  }
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|intranet|lan)$/i;

// ── URL check (does DNS) ───────────────────────────────────────────────

/**
 * Throws Error('blocked') unless `raw` is an http(s) URL on port 80/443
 * whose host resolves only to public addresses. → the parsed URL.
 */
async function assertPublicUrl(raw, lookup = dns.lookup) {
  let u;
  try { u = raw instanceof URL ? raw : new URL(String(raw)); } catch { throw new Error('blocked'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('blocked');
  if (u.username || u.password) throw new Error('blocked');
  // URL drops the scheme's default port, so '' is 80 for http, 443 for https.
  if (u.port !== '' && u.port !== '80' && u.port !== '443') throw new Error('blocked');

  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || BLOCKED_NAMES.test(host)) throw new Error('blocked');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('blocked');
    return u;
  }
  let addrs;
  try { addrs = await lookup(host, { all: true, verbatim: true }); } catch { throw new Error('blocked'); }
  if (!Array.isArray(addrs) || !addrs.length) throw new Error('blocked');
  if (addrs.some(a => isBlockedAddress(a.address))) throw new Error('blocked');
  return u;
}

module.exports = { isBlockedAddress, isBlockedIPv4, isBlockedIPv6, parseIPv4, parseIPv6, assertPublicUrl };
