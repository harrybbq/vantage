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
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
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

  const gRes = await sb(env.supabaseUrl, env.serviceKey,
    '/rest/v1/groups?select=id,name,division,created_at');
  if (!gRes.ok) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'groups read failed' }) };
  }
  const groups = await gRes.json();
  if (!groups.length) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, weekStart: weekKey, groups: 0 }) };
  }

  const mRes = await sb(env.supabaseUrl, env.serviceKey, '/rest/v1/group_members?select=group_id,user_id');
  const memberships = mRes.ok ? await mRes.json() : [];
  const ids = Array.from(new Set(memberships.map(m => m.user_id)));

  let byId = new Map(), baselines = new Map();
  if (ids.length) {
    const pRes = await sb(env.supabaseUrl, env.serviceKey,
      `/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,ratings_ovr`);
    byId = new Map((pRes.ok ? await pRes.json() : []).map(p => [p.id, p]));
    baselines = await fetchBaselines(ids, env, from);
  }

  // Score every group, keeping each group's own member list for payouts.
  const membersByGroup = new Map();
  const scored = groups.map(g => {
    const mine = memberships.filter(m => m.group_id === g.id).map(m => {
      const { climb, counted } = memberScore(byId.get(m.user_id), baselines.get(m.user_id));
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
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'week write failed', detail }) };
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
