/**
 * Savings accounts are owner-only (decided 2026-10-29).
 *
 * For everyone else Savings is pots, contributions and cash flow, with
 * no accounts anywhere — not in the UI, and not in the numbers either.
 * A non-owner who entered accounts before the gate keeps every byte of
 * `S.savingsAccounts` in state; this module only decides what the VIEW
 * is given, and nothing it returns is ever written back.
 *
 * `show` is the gate's answer (hooks/useShowAccounts: the owner, and
 * never in a native build). It is taken as a plain boolean so this file
 * stays pure and runs under node — it must not import ownerSurfaces.js,
 * whose `import.meta.env` read throws outside Vite.
 *
 * ── Why the flow rows are rewritten too ──────────────────────────────
 * A row routed into an account carries `accountId`, and the derivations
 * treat that as routed (income into an account never reaches the cash
 * line). With accounts hidden, a row aimed at one has nowhere visible to
 * go, so the view drops the `accountId` and the row counts as the plain
 * income or expense it is. A row that also names a pot keeps its
 * `goalId` and still routes into the pot. The stored row keeps its
 * `accountId`: callers that WRITE rows must write from the real
 * `S.projection.items`, never from these copies.
 */

const EMPTY = Object.freeze([]);

/** The accounts the view may see: the owner's own list, else none. */
export function visibleAccounts(S, show) {
  if (!show) return EMPTY;
  return (S && Array.isArray(S.savingsAccounts)) ? S.savingsAccounts : EMPTY;
}

/** Flow rows as the view should read them (see the header). */
export function visibleItems(items, show) {
  const list = Array.isArray(items) ? items : EMPTY;
  if (show) return list;
  if (!list.some(it => it && it.accountId)) return list;
  return list.map(it => {
    if (!it || !it.accountId) return it;
    const { accountId: _hidden, ...rest } = it;
    return rest;
  });
}

/**
 * The whole state as a savings view should read it: `S` itself for the
 * owner; for anyone else a shallow copy with no accounts and with flow
 * rows that no longer point at one. Read-only — pass it to derivations
 * and renderers, never to `update`, and never spread it into state.
 */
export function savingsView(S, show) {
  if (show || !S) return S;
  const items = S.projection && S.projection.items;
  const viewItems = visibleItems(items, false);
  const hasAccounts = Array.isArray(S.savingsAccounts) && S.savingsAccounts.length > 0;
  if (!hasAccounts && viewItems === items) return S;
  return {
    ...S,
    savingsAccounts: EMPTY,
    ...(viewItems !== items ? { projection: { ...S.projection, items: viewItems } } : null),
  };
}

/* ── Prime blocks ─────────────────────────────────────────────────────
   Blocks that are only about accounts, per prime. A placed card keeps
   them in `S.hubWidgets`/`mobileWidgets`; they are simply not drawn,
   not offered, and not dropped when the card is edited. */
export const OWNER_BLOCKS = Object.freeze({ savings: Object.freeze(['accounts']) });

const ownerOnly = (prime, id) => !!(OWNER_BLOCKS[prime] && OWNER_BLOCKS[prime].includes(id));

/** The block ids a card may draw or offer. */
export function visibleBlockIds(prime, ids, show) {
  const list = Array.isArray(ids) ? ids : EMPTY;
  if (show) return list;
  return list.filter(id => !ownerOnly(prime, id));
}

/** Presets with the owner-only blocks taken out; a preset left empty is dropped. */
export function visiblePresets(prime, presets, show) {
  const list = Array.isArray(presets) ? presets : EMPTY;
  if (show) return list;
  return list
    .map(([name, ids]) => [name, visibleBlockIds(prime, ids, false)])
    .filter(([, ids]) => ids.length > 0);
}

/**
 * The block list to STORE after someone who cannot see the owner-only
 * blocks edits a card: their new visible order, with every hidden block
 * that was there put back at the index it had (clamped to the end).
 * For the owner it is `next` untouched.
 */
export function keepHiddenBlocks(prime, prevIds, nextIds, show) {
  const next = Array.isArray(nextIds) ? nextIds.slice() : [];
  if (show) return next;
  const prev = Array.isArray(prevIds) ? prevIds : EMPTY;
  prev.forEach((id, i) => {
    if (!ownerOnly(prime, id) || next.includes(id)) return;
    next.splice(Math.min(i, next.length), 0, id);
  });
  return next;
}
