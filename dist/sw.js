// Vantage Service Worker
//
// Strategy:
//   - Hashed Vite assets (JS / CSS) → cache-first (safe: hashed filenames
//     never change content, so an old cached file is identical to itself)
//   - HTML navigation requests → network-first, NEVER cache index.html
//     (this was the bug that pinned old builds to old clients in
//     2026-05-03 — old cached index.html referenced old JS hashes which
//     were also cached, so users were stuck on stale code forever)
//   - Truly static immutable assets (icons, manifest, background) →
//     precache so the app installs as a real PWA
//   - Supabase / API calls → network-first
//
// Cache rotation discipline:
//   Bump CACHE_VERSION on EVERY deploy that includes structural changes
//   to the SW itself or to anything in PRECACHE. Hashed Vite assets
//   don't need a bump — they're versioned by filename hash.
//
//   When in doubt: bump it. Cost is one extra fetch per asset on first
//   load post-deploy. Cost of NOT bumping (forever-stale clients
//   running broken code) is real data loss — see git log f6a7a50 for
//   the wipe incident this SW caused.

const CACHE_VERSION = 'vb-v5-2026-07-16';
const CACHE = CACHE_VERSION;

// Notice: NO '/index.html' and NO '/'. Those are network-first only.
// Precaching them was the root cause of the stale-build bug.
const PRECACHE = [
  '/manifest.json',
  '/background.jpg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

// ── Install: precache shell ───────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // Tolerate any single missing precache entry — first deploy of a
      // new icon shouldn't brick install.
      Promise.all(PRECACHE.map(url =>
        cache.add(url).catch(err => console.warn('SW precache miss:', url, err.message))
      ))
    )
  );
  self.skipWaiting();
});

// ── Activate: purge old caches, take control, notify clients ──────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Tell open tabs we just upgraded — App.jsx listens and decides
    // whether to soft-reload (no in-flight save) or just notify.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
    }
  })());
});

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Supabase / external API → network-first (never cache auth / data)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/')
  ) {
    event.respondWith(networkFirst(request, /* cacheOnSuccess */ false));
    return;
  }

  // HTML navigation → network-first, NO cache fallback to a stale shell.
  // If the network is genuinely down we serve a tiny inline offline
  // page rather than risking serving an old index.html that points to
  // dead JS hashes.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => new Response(
        '<!doctype html><meta charset=utf-8><title>Offline</title>' +
        '<body style="font-family:sans-serif;padding:2em;text-align:center">' +
        '<h1>Offline</h1><p>Reconnect and refresh.</p></body>',
        { status: 503, headers: { 'Content-Type': 'text/html' } }
      ))
    );
    return;
  }

  // Hashed Vite bundles + other static assets → cache-first
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request, cacheOnSuccess = true) {
  try {
    const response = await fetch(request);
    if (response.ok && cacheOnSuccess) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
