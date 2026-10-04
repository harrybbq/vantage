/**
 * The one coin path for the wishlist: single toggle and bulk select both
 * go through markBought(), so they cannot drift apart again.
 *
 * The bug this file was written against: bulk "Mark bought" set
 * `bought` and `boughtAt` and nothing else — no coins spent, no
 * `paidCoins`. Un-buying that item later (one at a time) refunded its
 * coinCost, so bulk-buy then single-unbuy minted coins. Bulk "Mark
 * unbought" gave no refund at all, and re-marking an already-bought item
 * overwrote the date it was really bought.
 *
 * All data is invented.
 */
import assert from 'node:assert/strict';
import { markBought } from './buy.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = Date.UTC(2026, 9, 4, 12, 0);
const EARLIER = Date.UTC(2026, 6, 1, 9, 30);

function state(extra = {}) {
  return {
    coins: 500,
    coinHistory: [{ type: 'earn', label: 'Tracker goal', amount: 50, ts: EARLIER }],
    shopItems: [
      { id: 'a', name: 'Desk lamp', price: '£40', coinCost: 40, bought: false },
      { id: 'b', name: 'Trail shoes', price: '£120', coinCost: 120, bought: false },
      { id: 'c', name: 'Sticker pack', price: 'Free', coinCost: 0, bought: false },
      { id: 'd', name: 'Old headphones', price: '£80', coinCost: 80, bought: true, boughtAt: EARLIER, paidCoins: 60 },
      { id: 'e', name: 'Legacy buy', price: '£25', coinCost: 25, bought: true, boughtAt: EARLIER }, // pre-paidCoins
      { id: 'f', name: 'Untouched', price: '£10', coinCost: 10, bought: false, notes: 'keep me' },
    ],
    ...extra,
  };
}
const item = (s, id) => s.shopItems.find(i => i.id === id);
const apply = (s, r) => ({ ...s, ...r.slice });

// ── Bulk mark bought spends coins, exactly like the single toggle ──
{
  const s = state();
  const r = markBought(s, ['a', 'b', 'c'], true, NOW);
  const next = apply(s, r);
  eq(next.coins, 500 - 40 - 120, 'bulk buy spends the sum of coin costs');
  eq(item(next, 'a').paidCoins, 40, 'paidCoins pinned at purchase (a)');
  eq(item(next, 'b').paidCoins, 120, 'paidCoins pinned at purchase (b)');
  eq(item(next, 'c').paidCoins, 0, 'a free item records paidCoins 0');
  ok(item(next, 'a').bought && item(next, 'a').boughtAt === NOW, 'bought + boughtAt set');
  const spends = next.coinHistory.filter(h => h.type === 'spend');
  eq(spends.length, 2, 'one spend row per paid item, none for the free one');
  eq(spends.map(h => h.amount).sort((x, y) => x - y), [-120, -40], 'spend rows are negative amounts');
  ok(spends.every(h => h.ts === NOW && typeof h.label === 'string'), 'spend rows carry ts + label');
  eq(next.coinHistory[next.coinHistory.length - 1], s.coinHistory[0], 'existing history rows kept');
  ok(item(next, 'f') === item(s, 'f'), 'unselected item is the same object');
}

// ── Gate: not enough coins → that item is skipped and reported ──
{
  const s = state({ coins: 100 });
  const r = markBought(s, ['a', 'b'], true, NOW);
  const next = apply(s, r);
  eq(next.coins, 60, 'only the affordable item is charged');
  ok(item(next, 'a').bought, 'affordable item bought');
  ok(!item(next, 'b').bought, 'unaffordable item left alone');
  ok(item(next, 'b') === item(s, 'b'), 'skipped item untouched (same object)');
  eq(r.report.skipped.map(x => x.id), ['b'], 'skip reported');
  eq(r.report.skipped[0].need, 120, 'report says what it needed');
  eq(r.report.skipped[0].have, 60, 'report says what was left at that point');
}

// ── Gate off (Settings → Goals): no block, coins still spent ──
{
  const s = state({ coins: 10, shopRequireCoins: false });
  const next = apply(s, markBought(s, ['b'], true, NOW));
  ok(item(next, 'b').bought, 'bought despite low balance');
  eq(next.coins, 10 - 120, 'still charged — otherwise a later refund would mint coins');
  eq(item(next, 'b').paidCoins, 120, 'paidCoins recorded with the gate off');
}

// ── Unbuy refunds what was PAID; legacy items fall back to coinCost ──
{
  const s = state();
  const r = markBought(s, ['d', 'e'], false, NOW);
  const next = apply(s, r);
  eq(next.coins, 500 + 60 + 25, 'refund = paidCoins (d) + coinCost fallback (e)');
  ok(!item(next, 'd').bought && item(next, 'd').boughtAt === undefined, 'unbought clears boughtAt');
  eq(item(next, 'd').paidCoins, undefined, 'unbought clears paidCoins');
  const refunds = next.coinHistory.filter(h => h.type === 'refund');
  eq(refunds.map(h => h.amount).sort((x, y) => x - y), [25, 60], 'refund rows');
  eq(r.report.refunded, 85, 'report totals the refund');
}

// ── Re-marking an already-bought item keeps the ORIGINAL date, no charge ──
{
  const s = state();
  const r = markBought(s, ['d', 'a'], true, NOW);
  const next = apply(s, r);
  eq(item(next, 'd').boughtAt, EARLIER, 'original boughtAt kept');
  eq(item(next, 'd').paidCoins, 60, 'original paidCoins kept');
  ok(item(next, 'd') === item(s, 'd'), 'already-bought item untouched');
  eq(next.coins, 500 - 40, 'charged only for the newly bought item');
}

// ── Unbuying something not bought is a no-op ──
{
  const s = state();
  const r = markBought(s, ['a', 'f'], false, NOW);
  ok(!r.changed, 'nothing to unbuy → unchanged');
  ok(r.slice.shopItems === s.shopItems, 'same array back, so the caller can skip the write');
}

// ── Bulk = the sum of singles, in the same order ──
{
  const ids = ['a', 'c', 'b', 'd', 'f'];
  for (const value of [true, false]) {
    for (const coins of [500, 100, 0]) {
      const s0 = state({ coins });
      const bulk = apply(s0, markBought(s0, ids, value, NOW));
      let one = s0;
      for (const id of ids) one = apply(one, markBought(one, [id], value, NOW));
      eq(bulk.coins, one.coins, `coins match (value=${value}, coins=${coins})`);
      eq(bulk.shopItems, one.shopItems, `items match (value=${value}, coins=${coins})`);
      eq(bulk.coinHistory, one.coinHistory, `history rows match, same order (value=${value}, coins=${coins})`);
    }
  }
}

// ── The original exploit: bulk buy, then single unbuy, must be coin-neutral ──
{
  const s0 = state();
  const s1 = apply(s0, markBought(s0, ['a', 'b'], true, NOW));
  const s2 = apply(s1, markBought(s1, ['a'], false, NOW));
  const s3 = apply(s2, markBought(s2, ['b'], false, NOW));
  eq(s3.coins, s0.coins, 'buy-then-unbuy round trip mints nothing');
}

// ── Editing the cost after buying cannot change the refund ──
{
  const s0 = state();
  const s1 = apply(s0, markBought(s0, ['a'], true, NOW));
  const edited = { ...s1, shopItems: s1.shopItems.map(i => i.id === 'a' ? { ...i, coinCost: 5000 } : i) };
  const s2 = apply(edited, markBought(edited, ['a'], false, NOW));
  eq(s2.coins, s0.coins, 'refund is paidCoins, not the edited coinCost');
}

// ── Unknown ids, missing arrays and string coin costs don't throw ──
{
  const r = markBought({ coins: 5 }, ['zzz'], true, NOW);
  ok(!r.changed, 'no items → unchanged');
  const s = { coins: 50, shopItems: [{ id: 'x', name: 'Typed cost', coinCost: '30', bought: false }] };
  const next = apply(s, markBought(s, ['x'], true, NOW));
  eq(next.coins, 20, 'string coin cost read as a number');
  eq(next.coinHistory.length, 1, 'history created when absent');
}

console.log(`buy: ${n} checks passed`);
