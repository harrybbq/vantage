/**
 * Mute — the user control short of blocking (STARTUP_REQUIREMENTS item
 * 113; ABUSE_HANDLING "G-1. Mute"; OSA draft ICU J1 "Block and mute",
 * H4 "A mute option for DMs, short of blocking").
 *
 * ── What it is ───────────────────────────────────────────────────────
 * A private list in the muter's own state:
 *
 *   S.mutedUsers = { [userId]: { at: ISO date, name, handle } }
 *
 * `name`/`handle` are a snapshot taken when muting, so Settings can list
 * who is muted without a profile read. Nothing is written anywhere the
 * muted person can see — no table, no RLS, no server function reads it —
 * so they are never told and see no difference ("The muted person is
 * never told", G-1).
 *
 * What it does, for the muter only: that person's messages still arrive
 * and are kept (so they can still be reported), but they don't count
 * towards any unread badge, the conversation sorts below the others
 * under "Muted", and their activity (streak, heatmap, wins) is folded
 * away on the friend card behind a "Show" button. Unmute puts every one
 * of those back; nothing is ever deleted.
 *
 * ── Name clash ───────────────────────────────────────────────────────
 * dmView.js already calls a greyed, read-only inbox row (ex-friend,
 * blocked, suspended) `muted`. The flag this module adds to a row is
 * `silenced`, so the two never mix (G-1 "Name clash to avoid"). Users
 * only ever see the word "Mute".
 *
 * ── Saving and merging ───────────────────────────────────────────────
 * A new key, absent from every existing state, so every reader treats a
 * missing key as "no one muted" and nothing writes it on load. Mute adds
 * one entry, unmute deletes one entry, and both return the SAME object
 * when there is nothing to change (update() then skips the save). Under
 * lib/state/merge.js that means: mutes made on two devices both survive;
 * an unmute survives unless the other device changed that same entry
 * meanwhile, in which case the person stays muted (a merge never deletes
 * what the other side changed). mutes.test.mjs pins each case.
 *
 * Pure. No React, no network.
 */

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A user id fit to sit in a PostgREST `in` list: uuid characters only. */
const SAFE_ID = /^[0-9a-fA-F-]{8,64}$/;

/**
 * The mute map, cleaned. Readers take the MAP (`S.mutedUsers`, possibly
 * undefined), never the whole state; the updaters below take the state.
 * Never null.
 */
export function readMutes(m) {
  if (!isObj(m)) return {};
  // A state can hold anything a past client wrote; read only well-formed
  // entries (an object, or a bare ISO string as the G-1 spec sketched).
  const out = {};
  for (const [id, v] of Object.entries(m)) {
    if (!id) continue;
    if (isObj(v)) out[id] = v;
    else if (typeof v === 'string' && v) out[id] = { at: v };
  }
  return out;
}

export const isMuted = (map, id) => !!id && Object.prototype.hasOwnProperty.call(readMutes(map), id);

/** Muted ids, safe to put in a query filter. */
export function mutedIds(map) {
  return Object.keys(readMutes(map)).filter(id => SAFE_ID.test(id)).sort();
}

/**
 * Muted people for a list, most recently muted first.
 * → [{ id, at, name, handle }]
 */
export function mutedList(map) {
  return Object.entries(readMutes(map))
    .map(([id, v]) => ({ id, at: typeof v.at === 'string' ? v.at : null, name: v.name || null, handle: v.handle || null }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

/**
 * State updater body: mute `person` ({ id, name?, handle? }). Returns
 * `prev` itself when they are already muted or the input is unusable,
 * so update() queues no save. Touches `mutedUsers` and nothing else.
 */
export function muteUser(prev, person, now = new Date()) {
  const id = person && person.id;
  if (!isObj(prev) || !id || typeof id !== 'string') return prev;
  const cur = isObj(prev.mutedUsers) ? prev.mutedUsers : {};
  if (Object.prototype.hasOwnProperty.call(cur, id)) return prev;
  const entry = { at: now.toISOString() };
  const name = typeof person.name === 'string' ? person.name.slice(0, 80) : '';
  const handle = typeof person.handle === 'string' ? person.handle.slice(0, 40) : '';
  if (name) entry.name = name;
  if (handle) entry.handle = handle;
  return { ...prev, mutedUsers: { ...cur, [id]: entry } };
}

/** State updater body: unmute `id`. `prev` itself when not muted. */
export function unmuteUser(prev, id) {
  if (!isObj(prev) || !id || !isObj(prev.mutedUsers)) return prev;
  if (!Object.prototype.hasOwnProperty.call(prev.mutedUsers, id)) return prev;
  const next = { ...prev.mutedUsers };
  delete next[id];
  return { ...prev, mutedUsers: next };
}

// ── Inbox and lists ───────────────────────────────────────────────────

/**
 * Mark the conversations with muted people and move them below the
 * rest, keeping each group's own order (buildInbox's newest first).
 * Rows already greyed for another reason (blocked, suspended, former
 * friend) are left as they are: "Blocked" says more than "Muted", and
 * those rows count no unread anyway.
 */
export function silenceInbox(rows, map) {
  return partition(rows, map, r => !r.muted);
}

function partition(rows, map, eligible) {
  const m = readMutes(map);
  const list = rows || [];
  if (!Object.keys(m).length) return list;
  const loud = [];
  const quiet = [];
  for (const r of list) {
    if (r && eligible(r) && Object.prototype.hasOwnProperty.call(m, r.id)) quiet.push({ ...r, silenced: true });
    else loud.push(r);
  }
  return quiet.length ? [...loud, ...quiet] : list;
}

/** What a row contributes to a badge: nothing for a muted person. */
export const badgeUnread = row => (row && !row.silenced ? Math.max(0, Number(row.unread) || 0) : 0);

/** The unread total a badge should show. */
export const audibleUnread = rows => (rows || []).reduce((n, r) => n + badgeUnread(r), 0);

/**
 * Friend-list rows: flag muted friends `silenced`, and move them to the
 * end keeping the caller's order otherwise. Same object back when no
 * one on the list is muted.
 */
export function silenceFriends(rows, map) {
  return partition(rows, map, () => true);
}
