/**
 * Netlify scheduled function: settle-leagues
 *
 * Monday 00:05 UTC. Closes the week that just ended: scores every
 * group, writes the result down, moves groups between divisions, and
 * records the coin payouts for each group's top three climbers.
 *
 * ── Order matters ────────────────────────────────────────────────────
 * This runs BEFORE the day's snapshot (03:00), so the baselines it
 * measures against are last Monday's rows and the ratings it measures
 * are today's. Move either cron and the week gets scored against the
 * wrong end of itself.
 *
 * ── Idempotency ──────────────────────────────────────────────────────
 * league_weeks has a unique (group_id, week_start), and coin_grants a
 * unique (user_id, week_start). A retry re-inserts nothing and moves
 * nobody: the promotion pass is skipped entirely if the week is already
 * settled. That matters more here than anywhere else in the app —
 * a double-run without it would promote a group twice.
 *
 * ── Reads must all succeed (2026-09-30, item 47) ─────────────────────
 * Memberships, profiles and baselines are each required. A failed read
 * used to degrade to an empty list, and an empty list is not an error
 * here — it is a week settled at zero for everyone, written down for
 * good, with promotions to match. Now any failed read stops the run
 * before anything is written; the scheduler (or `?week=`) retries.
 *
 * Only members who had joined by the start of the week count
 * (lib/leagues.js joinedByWeekStart), so a mid-week recruit cannot
 * bring a week's climb earned elsewhere.
 *
 * ── What it does NOT do ──────────────────────────────────────────────
 * It does not touch user_data.state. Coins are recorded as grants for
 * the client to claim, because the state JSON belongs to the user and
 * the server rewriting it is the failure mode this codebase has already
 * paid for once.
 */

const { requireScheduler } = require('../lib/cronAuth');
const {
  sb, fetchBaselines, memberScore, groupScore, rankGroups, weekStart, COIN_AWARD, DIVISIONS,
} = require('../lib/leagues');
const { pageAll, inChunks } = require('../lib/pgPage');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const DAY_MS = 86_400_000;

exports.handler = async (event) => {
  const denied = requireScheduler(event, CORS, 'CRON_SECRET');
  if (denied) return denied;

  const env = {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (!env.supabaseUrl || !env.serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
  }

  /* The week being settled is the one that ENDED at this Monday, so its
     start is seven days back. `?week=YYYY-MM-DD` re-settles a specific
     week by hand if a run is missed. */
  const thisMonday = weekStart(new Date());
  const override = event?.queryStringParameters?.week;
  const from = override ? new Date(`${override}T00:00:00.000Z`) : new Date(thisMonday.getTime() - 7 * DAY_MS);
  const weekKey = from.toISOString().slice(0, 10);

  // Already settled? Then this is a retry, and the promotions have run.
  const doneRes = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/league_weeks?week_start=eq.${weekKey}&select=group_id&limit=1`);
  if (doneRes.status === 404 || doneRes.status === 400) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, setup: false }) };
  }
  if (doneRes.ok && (await doneRes.json()).length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, weekStart: weekKey, alreadySettled: true }) };
  }

  /* Every multi-row read below is paged (lib/pgPage.js, 2026-09-30).
     PostgREST returns at most 1000 rows and says nothing about the
     rest, and here "the rest" would have been groups that were never
     scored and members who were never counted — settled for good. A
     page that fails fails the whole read, which stops the run before
     anything is written, exactly like a failed single read did. */
  let groups;
  try {
    groups = await pageAll((offset, limit) => sb(env.supabaseUrl, env.serviceKey,
      `/rest/v1/groups?select=id,name,division,created_at&order=id&limit=${limit}&offset=${offset}`),
    { what: 'settle groups' });
  } catch (e) {
    console.error('settle-leagues: groups read failed', e?.status);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'read failed — not settled' }) };
  }
  if (!groups.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, weekStart: weekKey, groups: 0 }) };
  }

  const readFailed = what => {
    console.error(`settle-leagues: ${what} read failed — nothing settled`);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'read failed — not settled' }) };
  };

  let memberships;
  try {
    // Ordered on the full row key so no membership repeats or slips
    // between pages.
    memberships = await pageAll((offset, limit) => sb(env.supabaseUrl, env.serviceKey,
      `/rest/v1/group_members?select=group_id,user_id,joined_at&order=group_id,user_id&limit=${limit}&offset=${offset}`),
    { what: 'settle memberships' });
  } catch {
    return readFailed('memberships');
  }
  const ids = Array.from(new Set(memberships.map(m => m.user_id)));

  let byId = new Map(), baselines = new Map();
  if (ids.length) {
    let profiles;
    try {
      profiles = await inChunks(ids, (csv, offset, limit) => sb(env.supabaseUrl, env.serviceKey,
        `/rest/v1/profiles?id=in.(${csv})&select=id,ratings_ovr&order=id&limit=${limit}&offset=${offset}`),
      { what: 'settle profiles' });
    } catch {
      return readFailed('profiles');
    }
    byId = new Map(profiles.map(p => [p.id, p]));
    try {
      baselines = await fetchBaselines(ids, env, from, { strict: true });
    } catch {
      return readFailed('baselines');
    }
  }

  // Score every group, keeping each group's own member list for payouts.
  const membersByGroup = new Map();
  const scored = groups.map(g => {
    const mine = memberships.filter(m => m.group_id === g.id).map(m => {
      const { climb, counted } = memberScore(byId.get(m.user_id), baselines.get(m.user_id), m.joined_at, from);
      return { userId: m.user_id, climb, counted };
    });
    membersByGroup.set(g.id, mine);
    return { id: g.id, name: g.name, division: g.division, createdAt: g.created_at, score: groupScore(mine) };
  });

  // Rank within each division separately — that is what a division is.
  const rows = [], moves = [], grants = [];
  for (const d of DIVISIONS) {
    const inDivision = scored.filter(g => g.division === d.num);
    if (!inDivision.length) continue;
    for (const g of rankGroups(inDivision)) {
      rows.push({
        group_id: g.id, week_start: weekKey, division: g.division,
        score: g.score, position: g.position, outcome: g.zone,
      });
      if (g.zone === 'promoted') moves.push({ id: g.id, division: g.division - 1 });
      if (g.zone === 'relegated') moves.push({ id: g.id, division: g.division + 1 });

      // Top three climbers in the group are paid — but only members who
      // actually climbed. An idle week pays nothing however high the
      // member's rating already is.
      const podium = (membersByGroup.get(g.id) || [])
        .filter(m => m.counted > 0)
        .sort((a, b) => b.counted - a.counted)
        .slice(0, COIN_AWARD.length);
      podium.forEach((m, i) => {
        grants.push({
          user_id: m.userId, amount: COIN_AWARD[i], week_start: weekKey,
          reason: `${['1st', '2nd', '3rd'][i]} contributor · ${g.name}`,
        });
      });
    }
  }

  const wRes = await sb(env.supabaseUrl, env.serviceKey, '/rest/v1/league_weeks', {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows),
  });
  if (!wRes.ok) {
    const detail = await wRes.text().catch(() => '');
    console.error('settle-leagues: week write failed', wRes.status, detail.slice(0, 300));
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'week write failed' }) };
  }

  /* Promotions after the week is written, never before: if this half
     fails, the week is on record and a re-run is a no-op rather than a
     second round of movement. */
  for (const m of moves) {
    await sb(env.supabaseUrl, env.serviceKey, `/rest/v1/groups?id=eq.${m.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ division: m.division }),
    });
  }

  let paid = 0;
  if (grants.length) {
    // merge-duplicates: the unique (user_id, week_start) index turns a
    // retry into an update of the same row rather than a second payout.
    const cRes = await sb(env.supabaseUrl, env.serviceKey, '/rest/v1/coin_grants', {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(grants),
    });
    if (cRes.ok) paid = grants.length;
  }

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({
      ok: true, weekStart: weekKey,
      groups: groups.length, settled: rows.length,
      promoted: moves.filter(m => m.division < 10).length,
      moved: moves.length, paid,
    }),
  };
};
