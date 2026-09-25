/**
 * Food search calls, shared by the phone sheet (FoodSearch) and the
 * desktop panel (LogFoodPanel). Both go through the food-search Netlify
 * function, which talks to the UK databases and the user-additions
 * table; nothing here calls a food database directly.
 */
import { authFetch } from '../authFetch';

export async function searchByBarcode(barcode) {
  const res = await authFetch(`/.netlify/functions/food-search?mode=barcode&q=${encodeURIComponent(barcode)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Lookup failed');
  return json.products || [];
}

export async function searchByName(query, community) {
  const res = await authFetch(
    `/.netlify/functions/food-search?mode=name&q=${encodeURIComponent(query)}${community ? '&community=1' : ''}`
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Search failed');
  return json.products || [];
}

/* Whether to include foods other users added.
 *
 * Off until asked for: these are strangers' words in a list you are
 * scanning quickly, and nobody should be handed them without turning
 * them on. Remembered per device in localStorage rather than in the
 * state blob — it is a preference about how a list looks on the screen
 * in front of you, which is exactly what localStorage is for, and it
 * costs nothing if the read fails. */
const COMMUNITY_KEY = 'vb4_food_community';
export function readCommunityPref() {
  try { return localStorage.getItem(COMMUNITY_KEY) === '1'; } catch { return false; }
}
export function writeCommunityPref(on) {
  try { localStorage.setItem(COMMUNITY_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}
