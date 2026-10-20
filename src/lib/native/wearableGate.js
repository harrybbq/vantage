import { isNativeApp } from './platform';
import { hasWearableData } from '../wearables/strip';

/**
 * D7 (owner decision, 2026-10-20): the first store build ships with
 * WHOOP and Oura connect HIDDEN. Neither provider has approved Vantage
 * yet, each caps an unapproved app at 10 accounts, and a store reviewer
 * must never meet a feature that refuses them (docs/WEARABLE_APPROVALS.md
 * §5.1, items 115/119).
 *
 * To ship them in a native build later, flip this ONE constant to true.
 */
export const WEARABLES_IN_NATIVE = false;

/*
 * Build-time half: Vite folds the literal, so with the constant false the
 * connect branch is decided at build time in a `cap:*` build. Must read
 * the full `import.meta.env.VITE_…` expression (see ownerSurfaces.js).
 */
const CONNECT_IN_BUILD = WEARABLES_IN_NATIVE || import.meta.env.VITE_NATIVE_BUILD !== 'true';

/**
 * May this build START a WHOOP / Oura connect? False in native builds
 * (build flag or the Capacitor shell at runtime) unless
 * WEARABLES_IN_NATIVE. Accounts already connected keep their panel —
 * sync, Disconnect and the "Delete data synced from WHOOP/Oura" action —
 * and all synced data still displays everywhere.
 */
export function wearableConnectAvailable() {
  if (!CONNECT_IN_BUILD) return false;
  return WEARABLES_IN_NATIVE || !isNativeApp();
}

/**
 * Should Settings show the Health & sync group's wearable part at all?
 * Always on the web. In a native build with connect hidden: only for an
 * account that is linked or holds synced data (so it can Disconnect or
 * delete it) — a reviewer with a fresh account meets nothing.
 */
export function wearableSettingsVisible(S) {
  if (wearableConnectAvailable()) return true;
  return !!(S && (S.whoopConnected || S.ouraConnected)) || hasWearableData(S);
}
