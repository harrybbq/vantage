/**
 * Netlify scheduled function: snapshot-ratings
 *
 * Daily (cron in netlify.toml) — writes one row per user with current
 * ratings into rating_snapshots. The "weekly climb" leaderboard metric
 * is `current_ovr − snapshot_ovr_from_~7d_ago`.
 *
 * Idempotency: skip users who already got a snapshot in the last 6
 * hours (prevents double-writes on cron retry / manual nudge).
 *
 * One-off backfill: call with `?backfill=true` to write a baseline
 * snapshot for every rated user right now. Run this once after the
 * schema migration so the weekly board has any data before day 8.
 *
 * TODO: prune snapshots older than 90 days when the table grows past a
 * few hundred MB.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const PAGE_SIZE = 1000;
const INSERT_CHUNK = 500;
const RECENT_SKIP_MS = 6 * 60 * 60 * 1000; // 6h

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

exports.handler = async (event) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }
  const backfill = (event?.queryStringParameters?.backfill === 'true');

  // Page through every rated profile.
  let written = 0, skipped = 0, considered = 0, offset = 0;
  while (true) {
    const res = await sb(supabaseUrl, serviceKey,
      `/rest/v1/profiles?ratings_ovr=not.is.null&select=id,ratings,ratings_ovr&order=id&limit=${PAGE_SIZE}&offset=${offset}`
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'profiles read failed', detail }) };
    }
    const page = await res.json();
    if (!page.length) break;
    considered += page.length;

    // Idempotency filter (skipped on backfill) — drop users who already
    // got a snapshot within the last 6 hours.
    let candidates = page;
    if (!backfill && page.length) {
      const cutoffIso = new Date(Date.now() - RECENT_SKIP_MS).toISOString();
      const ids = page.map(p => p.id).join(',');
      const recentRes = await sb(supabaseUrl, serviceKey,
        `/rest/v1/rating_snapshots?user_id=in.(${ids})&snapshotted_at=gte.${cutoffIso}&select=user_id`
      );
      const recent = recentRes.ok ? await recentRes.json() : [];
      const recentSet = new Set(recent.map(r => r.user_id));
      const before = candidates.length;
      candidates = candidates.filter(p => !recentSet.has(p.id));
      skipped += before - candidates.length;
    }

    // Insert in chunks.
    for (let i = 0; i < candidates.length; i += INSERT_CHUNK) {
      const chunk = candidates.slice(i, i + INSERT_CHUNK).map(p => {
        const r = p.ratings || {};
        return {
          user_id: p.id,
          ovr: p.ratings_ovr || 1,
          brain:   r.brain   || 1,
          finance: r.finance || 1,
          fitness: r.fitness || 1,
          social:  r.social  || 1,
        };
      });
      if (!chunk.length) continue;
      const insRes = await sb(supabaseUrl, serviceKey, `/rest/v1/rating_snapshots`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(chunk),
      });
      if (!insRes.ok) {
        const detail = await insRes.text().catch(() => '');
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'snapshot insert failed', detail }) };
      }
      written += chunk.length;
    }

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({ ok: true, considered, written, skipped, backfill }),
  };
};
