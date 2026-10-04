/**
 * The price sweep, and how its results land on the list.
 *
 * The bug this file was written against: the sweep took a snapshot of
 * EVERY item when the page opened, waited 3–25 s for the shop pages, and
 * then wrote `price` (and history) back from that snapshot onto every
 * item by id. Anything you edited in the meantime — on any item, checked
 * or not — was quietly reverted. It also replaced your own price text
 * with whatever was scraped, and counted a failed check as "checked".
 *
 * The first two blocks reproduce that flow (snapshot → results → merge
 * onto a list the user changed meanwhile), so the fix is measured
 * against the bug rather than against an assertion that it is fixed.
 *
 * All data is invented.
 */
import assert from 'node:assert/strict';
import * as sweep from './sweep.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const AT = '2026-10-04T12:00:00.000Z';
const NOW = Date.parse(AT);
const DAY = 24 * 60 * 60 * 1000;

function snapshot() {
  return [
    { id: 'a', name: 'Desk lamp', price: 'From £50', url: 'https://shop.example/lamp', priority: 'med' },
    { id: 'b', name: 'Trail shoes', price: '£120', url: 'https://shop.example/shoes', priority: 'high' },
    { id: 'c', name: 'Notebook', price: '£8', priority: 'low' },                    // no link
    { id: 'd', name: 'Kettle', price: '£35', url: 'https://shop.example/kettle',
      priceHistory: [{ at: '2026-08-01T00:00:00.000Z', p: 35 }], priceCheckedAt: '2026-08-01T00:00:00.000Z' },
  ];
}
const byId = (list, id) => list.find(i => i.id === id);

// ── Bug 1: an edit made while the sweep runs must survive ──
{
  const snap = snapshot();
  // The user edits while the request is in flight: a checked item, an
  // unchecked one, and an item with no link at all.
  const latest = snap.map(i =>
    i.id === 'a' ? { ...i, price: '£47 in the sale', notes: 'wait for payday' }
    : i.id === 'b' ? { ...i, price: '£110', priority: 'low' }
    : i.id === 'c' ? { ...i, name: 'Dotted notebook' }
    : i);
  const results = [
    { url: 'https://shop.example/lamp', ok: true, price: '£45.00', priceNum: 45 },
  ];
  const { updates } = sweep.planSweepResults(snap, results, AT);
  const merged = sweep.applySweepUpdates(latest, updates);

  eq(byId(merged, 'a').price, '£47 in the sale', 'concurrent price edit on the CHECKED item survives');
  eq(byId(merged, 'a').notes, 'wait for payday', 'concurrent notes edit survives');
  eq(byId(merged, 'b').price, '£110', 'concurrent edit on an UNCHECKED item survives');
  eq(byId(merged, 'b').priority, 'low', 'other fields on the unchecked item survive');
  eq(byId(merged, 'c').name, 'Dotted notebook', 'edit on an item with no link survives');
  ok(byId(merged, 'b') === byId(latest, 'b'), 'unchecked item is the same object');
  ok(byId(merged, 'c') === byId(latest, 'c'), 'unlinked item is the same object');
  ok(byId(merged, 'd') === byId(latest, 'd'), 'item absent from the results is the same object');
}

// ── Bug 1b: a failed check is not "checked" ──
{
  const snap = snapshot();
  const results = [
    { url: 'https://shop.example/kettle', ok: false, price: '', priceNum: null, reason: 'fetch_failed' },
    { url: 'https://shop.example/shoes', ok: true, price: '£99', priceNum: 99 },
  ];
  const { updates } = sweep.planSweepResults(snap, results, AT);
  const merged = sweep.applySweepUpdates(snap, updates);
  ok(byId(merged, 'd') === byId(snap, 'd'), 'failed item untouched');
  eq(byId(merged, 'd').priceCheckedAt, '2026-08-01T00:00:00.000Z', 'failure does not move priceCheckedAt');
  eq(byId(merged, 'b').priceCheckedAt, AT, 'success does');
}

// ── I2: the sweep never writes `price`; it writes livePrice + history ──
{
  const snap = snapshot();
  const results = [{ url: 'https://shop.example/lamp', ok: true, price: '£45.00', priceNum: 45 }];
  const { updates } = sweep.planSweepResults(snap, results, AT);
  ok(updates instanceof Map && updates.has('a') && updates.size === 1, 'updates keyed by id, only checked items');
  const a = byId(sweep.applySweepUpdates(snap, updates), 'a');
  eq(a.price, 'From £50', 'user price text kept verbatim');
  eq(a.livePrice, { p: 45, at: AT }, 'livePrice records the checked price');
  eq(a.priceHistory, [{ at: AT, p: 50 }, { at: AT, p: 45 }], 'history seeded from the user text, then the move');
  eq(a.name, 'Desk lamp', 'other fields untouched');
}

// ── Concurrent delete and URL change: results are dropped, not resurrected ──
{
  const snap = snapshot();
  const results = [
    { url: 'https://shop.example/lamp', ok: true, price: '£45', priceNum: 45 },
    { url: 'https://shop.example/shoes', ok: true, price: '£99', priceNum: 99 },
  ];
  const { updates } = sweep.planSweepResults(snap, results, AT);
  const latest = snap
    .filter(i => i.id !== 'a')                                    // deleted meanwhile
    .map(i => i.id === 'b' ? { ...i, url: 'https://other.example/shoes' } : i); // relinked
  const merged = sweep.applySweepUpdates(latest, updates);
  eq(merged.length, latest.length, 'deleted item not re-added');
  ok(!merged.some(i => i.id === 'a'), 'no resurrection');
  ok(byId(merged, 'b') === byId(latest, 'b'), 'a result for the OLD url is not applied to the new one');
}

// ── A concurrent price edit's history point is kept ──
{
  const snap = snapshot();
  const results = [{ url: 'https://shop.example/kettle', ok: true, price: '£30', priceNum: 30 }];
  const { updates } = sweep.planSweepResults(snap, results, AT);
  // Meanwhile the user retypes the price in the edit modal.
  const editedAt = '2026-10-04T11:59:59.000Z';
  const latest = snap.map(i => i.id === 'd' ? sweep.applyPriceEdit(i, { price: '£32' }, editedAt) : i);
  const d = byId(sweep.applySweepUpdates(latest, updates), 'd');
  eq(d.price, '£32', 'edited text kept');
  eq(d.priceHistory.map(h => h.p), [35, 32, 30], 'edit point kept, sweep point appended after it');
  ok(d.priceHistory[1].src === 'edit', 'edit point is marked');
}

// ── History: no point when nothing moved, capped at 12 ──
{
  const item = { id: 'k', name: 'Kettle', price: '£35', url: 'https://shop.example/kettle',
    priceHistory: [{ at: '2026-08-01T00:00:00.000Z', p: 35 }] };
  const same = sweep.applyCheck(item, { url: item.url, ok: true, price: '£35.00', priceNum: 35 }, AT);
  eq(same.priceHistory, item.priceHistory, 'no new point when the price did not move');
  eq(same.livePrice, { p: 35, at: AT }, 'livePrice still refreshed');

  const long = { ...item, priceHistory: Array.from({ length: 12 }, (_, i) => ({ at: `2026-0${1 + (i % 9)}-01T00:00:00.000Z`, p: 40 + i })) };
  const next = sweep.applyCheck(long, { url: item.url, ok: true, price: '£20', priceNum: 20 }, AT);
  eq(next.priceHistory.length, 12, 'history capped at 12');
  eq(next.priceHistory[11].p, 20, 'newest point last');

  // Legacy items whose `addedAt` is ms (new) or absent (old) seed sensibly.
  const added = Date.UTC(2026, 5, 1);
  const seeded = sweep.applyCheck({ id: 'z', price: '£10', url: 'https://shop.example/z', addedAt: added },
    { url: 'https://shop.example/z', ok: true, price: '£9', priceNum: 9 }, AT);
  eq(seeded.priceHistory[0], { at: new Date(added).toISOString(), p: 10 }, 'seed point dated from addedAt');
}

// ── Currencies: a euro read never lands in a pound history ──
{
  const item = { id: 'e', price: '£100', url: 'https://shop.example/eu', priceHistory: [{ at: '2026-08-01T00:00:00.000Z', p: 100 }] };
  const next = sweep.applyCheck(item, { url: item.url, ok: true, price: '1.299,99 €', priceNum: 1.299 }, AT);
  eq(next.livePrice, { p: 1299.99, at: AT, c: 'EUR' }, 'parsed by price.js, currency kept');
  eq(next.priceHistory, item.priceHistory, 'no cross-currency point');
}

// ── itemsDueCheck: linked, unbought, stale, not recently failed, capped ──
{
  const old = new Date(NOW - 2 * DAY).toISOString();
  const fresh = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  const items = [
    { id: '1', url: 'https://shop.example/1' },
    { id: '2', url: 'https://shop.example/2', priceCheckedAt: fresh },
    { id: '3', url: 'https://shop.example/3', bought: true },
    { id: '4', url: 'ftp://shop.example/4' },
    { id: '5' },
    { id: '6', url: 'https://shop.example/6', priceCheckedAt: old },
    { id: '7', url: 'https://shop.example/dead' },
  ];
  const failed = { 'https://shop.example/dead': NOW - 60 * 60 * 1000 };
  eq(sweep.itemsDueCheck(items, NOW, failed).map(i => i.id), ['1', '6'], 'due list');
  eq(sweep.itemsDueCheck(items, NOW, { 'https://shop.example/dead': NOW - 2 * DAY }).map(i => i.id), ['1', '7', '6'],
    'an old failure no longer blocks');
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, url: 'https://shop.example/m' + i }));
  eq(sweep.itemsDueCheck(many, NOW).length, sweep.MAX_PER_SWEEP, 'capped per sweep');
}

// ── Failures are reported so the caller can back off ──
{
  const snap = snapshot();
  const { failedUrls } = sweep.planSweepResults(snap, [
    { url: 'https://shop.example/kettle', ok: false, priceNum: null },
    { url: 'https://shop.example/shoes', ok: true, price: 'TBC', priceNum: null },
  ], AT);
  eq(failedUrls.sort(), ['https://shop.example/kettle', 'https://shop.example/shoes'], 'failed + unreadable both reported');
}

// ── applyPriceEdit: a new typed price starts a fresh baseline ──
{
  const base = { id: 'p', price: '£50', priceHistory: [{ at: '2026-08-01T00:00:00.000Z', p: 50 }, { at: '2026-09-01T00:00:00.000Z', p: 40 }] };
  const e1 = sweep.applyPriceEdit(base, { price: '£42', notes: 'x' }, AT);
  eq(e1.priceHistory.length, 3, 'old points kept');
  eq(e1.priceHistory[2], { at: AT, p: 42, src: 'edit' }, 'fresh point from the typed value');
  eq(e1.price, '£42', 'patch applied');
  eq(e1.notes, 'x', 'other patch fields applied');
  ok(sweep.priceMovement(e1) === null, 'movement restarts from the edit — no stale badge');
  const e2 = sweep.applyPriceEdit(base, { notes: 'only notes' }, AT);
  eq(e2.priceHistory, base.priceHistory, 'no price change → history untouched');
  const e3 = sweep.applyPriceEdit({ id: 'q', price: '£5' }, { price: '£6' }, AT);
  ok(!('priceHistory' in e3), 'no history yet → none invented');
  const e4 = sweep.applyPriceEdit(base, { price: 'TBC' }, AT);
  eq(e4.priceHistory, base.priceHistory, 'unreadable typed price adds no point');
  const full = { ...base, priceHistory: Array.from({ length: 12 }, (_, i) => ({ at: AT, p: 10 + i })) };
  eq(sweep.applyPriceEdit(full, { price: '£99' }, AT).priceHistory.length, 12, 'still capped at 12');
}

// ── priceMovement: bad-read guard and the edit baseline ──
{
  const h = (...ps) => ps.map((p, i) => ({ at: `2026-0${i + 1}-01T00:00:00.000Z`, p }));
  eq(sweep.priceMovement({ priceHistory: h(100, 80) }).pct, -20, 'plain drop');
  eq(sweep.priceMovement({ priceHistory: h(100, 120) }).direction, 'up', 'plain rise');
  ok(sweep.priceMovement({ priceHistory: h(100, 5) }) === null, 'a >90% drop is a bad read');
  ok(sweep.priceMovement({ priceHistory: h(100, 553) }) === null, 'a >300% rise (the "▲ 453%") is a bad read');
  eq(sweep.priceMovement({ priceHistory: h(100, 80, 3) }).to, 80, 'a bad latest read falls back to the last good one');
  eq(sweep.priceMovement({ priceHistory: h(100, 900, 90) }).peak, 100, 'bad reads excluded from the peak');
  const withEdit = [...h(100, 80), { at: '2026-03-01T00:00:00.000Z', p: 70, src: 'edit' }, { at: '2026-04-01T00:00:00.000Z', p: 63 }];
  const m = sweep.priceMovement({ priceHistory: withEdit });
  eq([m.from, m.to, Math.round(m.pct)], [70, 63, -10], 'movement measured from the latest edit');
  ok(sweep.priceMovement({ priceHistory: [] }) === null && sweep.priceMovement(null) === null, 'empty is null');
}

console.log(`sweep: ${n} checks passed`);
