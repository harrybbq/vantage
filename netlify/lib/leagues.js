/**
 * Group leagues — the scoring, in one place.
 *
 * Both the board (`netlify/functions/groups.js`) and the Monday settle
 * (`netlify/functions/settle-leagues.js`) run these, because a league
 * where the live table and the final result are computed by different
 * code is a league that will one day promote the wrong group.
 *
 * ── The score ────────────────────────────────────────────────────────
 * A group's weekly score is the sum of how much each member's OVR GREW
 * since Monday. Not the sum of their OVRs — that would make recruiting
 * one highly-rated person worth more than a week of everyone's work,
 * and would punish a group whose member is having a quiet month twice
 * over. Growth is the only thing here that costs effort this week.
 *
 * A member with no growth contributes zero. Never a negative: OVR can
 * fall (tracker density is a 30-day window, so a fortnight off shows),
 * and a group turning on someone for that is the opposite of the point.
 *
 * ── The baseline ─────────────────────────────────────────────────────
 * "Their OVR on Monday" is the earliest rating_snapshots row on or after
 * Monday 00:00 UTC. The snapshot cron writes one row per user per day at
 * 03:00, so that is Monday's row. A member with no such row — joined
 * mid-week, or never rated — has no baseline and contributes nothing
 * rather than contributing their whole rating.
 *
 * UTC, not local: snapshots are stamped in UTC and a league that
 * resets at a different instant than it measures from is a bug waiting
 * for the clocks to change. In UK summer the reset lands at 01:00 BST.
 */

const DIVISIONS = [
  { num: 1,  name: 'Obsidian' },
  { num: 2,  name: 'Ruby' },
  { num: 3,  name: 'Diamond' },
  { num: 4,  name: 'Sapphire' },
  { num: 5,  name: 'Emerald' },
  { num: 6,  name: 'Jade' },
  { num: 7,  name: 'Gold' },
  { num: 8,  name: 'Silver' },
  { num: 9,  name: 'Bronze' },
  { num: 10, name: 'Iron' },
];

const MAX_SEATS = 20;
/** Paid to the top three climbers in each group every Monday. */
const COIN_AWARD = [300, 200, 100];

/* ── How many go up and down ──────────────────────────────────────────
   Scaled to the size of the division rather than fixed at three, which
   only made sense once a division was full.

     1–2 groups   nobody moves. With two, "one up one down" is the whole
                  division changing places every week for ever.
     3–7          1 up, 1 down — the smallest arrangement where a middle
                  exists to hold. At three that is exactly one of each.
     8–12         2 up, 2 down
     13+          3 up, 3 down, and no further: a league where a fifth of
                  the table moves each week has no standings, it has
                  weather.

   Compounding one more each five groups keeps the proportion roughly
   constant — about a fifth of a division moves in each direction —
   while the floor and the cap keep both ends sane. */
const MIN_GROUPS_TO_SETTLE = 3;
const GROUPS_PER_EXTRA_MOVE = 5;
const MAX_MOVED = 3;

function movementFor(groupCount) {
  if (!Number.isFinite(groupCount) || groupCount < MIN_GROUPS_TO_SETTLE) return 0;
  const banded = Math.floor((groupCount - MIN_GROUPS_TO_SETTLE) / GROUPS_PER_EXTRA_MOVE) + 1;
  /* Someone must always hold. Without this a future tweak to the bands
     could promote and relegate the entire division in one week, which
     is a shuffle rather than a result. */
  const room = Math.floor((groupCount - 1) / 2);
  return Math.max(0, Math.min(banded, MAX_MOVED, room));
}

/** Monday 00:00 UTC of the week containing `now`, as a Date. */
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0 = Sunday. Monday is the start, so Sunday belongs to the
  // week that began six days earlier.
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

/** The `week_start` date column value — the calendar date, no time. */
const weekStartDate = (now = new Date()) => weekStart(now).toISOString().slice(0, 10);

function sb(supabaseUrl, serviceKey, path, init = {}) {
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

/**
 * Monday's OVR for each of `userIds`.
 *
 * PostgREST cannot express DISTINCT ON, so this asks for every snapshot
 * in the window oldest-first and keeps the first per user — which is
 * the earliest, which is Monday's.
 */
async function fetchBaselines(userIds, { supabaseUrl, serviceKey }, from = weekStart()) {
  const out = new Map();
  if (!userIds.length) return out;
  const res = await sb(supabaseUrl, serviceKey,
    `/rest/v1/rating_snapshots?user_id=in.(${userIds.join(',')})` +
    `&snapshotted_at=gte.${from.toISOString()}` +
    `&select=user_id,ovr,brain,finance,fitness,social,snapshotted_at&order=snapshotted_at.asc`
  );
  if (!res.ok) return out;
  for (const r of await res.json()) {
    if (!out.has(r.user_id)) out.set(r.user_id, r);
  }
  return out;
}

const CATEGORIES = ['brain', 'finance', 'fitness', 'social'];

/**
 * One member's contribution. `climb` is null when there is no baseline
 * to measure from — displayed as "—", counted as zero.
 *
 * `split` is the same subtraction per category, which is what lets the
 * group card say where its week came from. Those four do NOT sum to the
 * OVR climb — OVR is the mean of four ratings, so a group climbing 4 in
 * fitness alone moves 1 overall. The card labels them as category
 * points for that reason.
 */
function memberScore(profile, baseline) {
  const current = profile?.ratings_ovr;
  const baseOvr = baseline?.ovr;
  if (current == null || baseOvr == null) {
    return { climb: null, counted: 0, split: { brain: 0, finance: 0, fitness: 0, social: 0 } };
  }
  const climb = Math.max(0, current - baseOvr);
  const split = {};
  for (const c of CATEGORIES) {
    const now = profile?.ratings?.[c];
    const then = baseline?.[c];
    split[c] = (now == null || then == null) ? 0 : Math.max(0, now - then);
  }
  return { climb, counted: climb, split };
}

/** Category totals across a group's members. */
function groupSplit(members) {
  const out = { brain: 0, finance: 0, fitness: 0, social: 0 };
  for (const m of members) {
    for (const c of CATEGORIES) out[c] += m.split?.[c] || 0;
  }
  return out;
}

/** Sum of every member's counted climb. */
function groupScore(members) {
  return members.reduce((sum, m) => sum + (m.counted || 0), 0);
}

/**
 * Standings for one division: every group in it, scored and ranked, with
 * the promotion / relegation zones marked.
 *
 * Ties break on the group that has been in the division longest — an
 * arbitrary rule, but a deterministic one, which matters more than
 * which arbitrary rule it is when a promotion hangs on it.
 */
function rankGroups(groups) {
  const sorted = groups.slice().sort((a, b) =>
    (b.score - a.score) || (new Date(a.createdAt) - new Date(b.createdAt)) || a.id.localeCompare(b.id));
  const moved = movementFor(sorted.length);
  return sorted.map((g, i) => {
    const position = i + 1;
    const promoted = moved > 0 && position <= moved && g.division > 1;
    const relegated = moved > 0 && position > sorted.length - moved && g.division < 10;
    return { ...g, position, moved, zone: promoted ? 'promoted' : relegated ? 'relegated' : 'held' };
  });
}

const divisionName = num => (DIVISIONS.find(d => d.num === num) || DIVISIONS[9]).name;

module.exports = {
  DIVISIONS, MAX_SEATS, COIN_AWARD, MIN_GROUPS_TO_SETTLE, MAX_MOVED, GROUPS_PER_EXTRA_MOVE,
  movementFor, CATEGORIES,
  weekStart, weekStartDate, sb, fetchBaselines, memberScore, groupScore, groupSplit,
  rankGroups, divisionName,
};
