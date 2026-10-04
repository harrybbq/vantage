/**
 * Marking wishlist items bought or not bought — the ONE coin path.
 *
 * The single bought toggle and bulk "Mark bought / unbought" both call
 * markBought(). They used to be separate, and they drifted: bulk set
 * `bought`/`boughtAt` and nothing else, so bulk-buy spent no coins and a
 * later single un-buy refunded coins that were never paid (minting
 * them); bulk un-buy refunded nothing; re-marking an already-bought item
 * overwrote the date it was really bought.
 *
 * Rules (the single toggle's, unchanged):
 *  - Buying spends `coinCost`. With the gate on (`shopRequireCoins`
 *    absent or true) an item you can't afford is skipped and reported;
 *    with it off the coins are still spent (a purchase that costs
 *    nothing and refunds in full later would mint coins).
 *  - `paidCoins` pins what was charged, so editing coinCost afterwards
 *    can't change the refund. Items bought before `paidCoins` existed
 *    refund their coinCost, which is what they were charged.
 *  - Un-buying refunds `paidCoins` and clears boughtAt/paidCoins, which
 *    returns the item to the active list.
 *  - Already in the requested state → untouched, original date kept.
 *  - Every spend/refund writes a coinHistory row, newest first.
 *
 * Items are processed in the order of `ids`, so a bulk buy that runs
 * out of coins part-way behaves exactly like tapping them one by one.
 *
 * Pure: returns the next slice of state and a report. Toasts and
 * confetti belong to the caller, OUTSIDE the state updater — React may
 * run an updater twice, and a side effect in there fires twice.
 */

const cost = item => {
  const n = Number(item?.coinCost);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param state  { shopItems, coins, coinHistory, shopRequireCoins }
 * @param ids    item ids, in the order to process them
 * @param value  true = mark bought, false = mark not bought
 * @param now    ms timestamp for boughtAt and history rows
 * @returns {{ slice: { shopItems, coins, coinHistory }, changed: boolean,
 *             report: { bought: object[], unbought: object[], skipped: object[], spent: number, refunded: number } }}
 */
export function markBought(state, ids, value, now = Date.now()) {
  const items = Array.isArray(state?.shopItems) ? state.shopItems : [];
  const requireCoins = state?.shopRequireCoins !== false;
  let coins = Number(state?.coins) || 0;
  const added = [];                       // new history rows, oldest first
  const patched = new Map();              // id → next item
  const report = { bought: [], unbought: [], skipped: [], spent: 0, refunded: 0 };
  const index = new Map(items.map((it, i) => [it?.id, i]));

  for (const id of ids || []) {
    if (!index.has(id) || patched.has(id)) continue;
    const item = items[index.get(id)];
    if (!item) continue;

    if (value) {
      if (item.bought) continue;          // keep the original boughtAt
      const c = cost(item);
      if (c > 0 && requireCoins && coins < c) {
        report.skipped.push({ id, name: item.name, need: c, have: coins });
        continue;
      }
      if (c > 0) {
        coins -= c;
        report.spent += c;
        added.push({ type: 'spend', label: item.name, amount: -c, ts: now });
      }
      patched.set(id, { ...item, bought: true, boughtAt: now, paidCoins: c });
      report.bought.push({ id, name: item.name, paid: c });
    } else {
      if (!item.bought) continue;
      const paid = item.paidCoins != null ? (Number(item.paidCoins) || 0) : cost(item);
      if (paid > 0) {
        coins += paid;
        report.refunded += paid;
        added.push({ type: 'refund', label: item.name, amount: paid, ts: now });
      }
      // boughtAt/paidCoins set to undefined (not deleted) — the same
      // shape the single toggle has always written; JSON drops them.
      patched.set(id, { ...item, bought: false, boughtAt: undefined, paidCoins: undefined });
      report.unbought.push({ id, name: item.name, refunded: paid });
    }
  }

  if (!patched.size) {
    return {
      slice: { shopItems: state?.shopItems, coins: state?.coins, coinHistory: state?.coinHistory },
      changed: false,
      report,
    };
  }

  const history = Array.isArray(state?.coinHistory) ? state.coinHistory : [];
  return {
    slice: {
      shopItems: items.map(it => (it && patched.has(it.id) ? patched.get(it.id) : it)),
      coins,
      // Prepend, newest first — the order every other writer uses.
      coinHistory: added.length ? [...added.reverse(), ...history] : history,
    },
    changed: true,
    report,
  };
}
