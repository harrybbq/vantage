/**
 * friends-trending — "what your friends are saving for".
 *
 * Aggregates the wishlist items across the caller's accepted friends and
 * returns the most-wanted ones. Reads each friend's shopItems directly
 * from their state via a JSON-path projection (state->shopItems) so the
 * payload stays small — no full state blobs transferred.
 *
 * Privacy: returns aggregate items + a friend count only — never which
 * friend wants what. Bought items are excluded. (A per-user opt-in
 * should gate this before any non-friends surface uses it.)
 *
 * POST, Bearer Supabase JWT. Returns { items: [{ name, price, url,
 * imageUrl, coins, count }] }.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function sb(path, env) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const callerId = (await userRes.json())?.id;
  if (!callerId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  try {
    const fRes = await sb(`friendships?status=eq.accepted&or=(requester_id.eq.${callerId},addressee_id.eq.${callerId})&select=requester_id,addressee_id`, env);
    const edges = fRes.ok ? await fRes.json() : [];
    const friendIds = edges.map(e => (e.requester_id === callerId ? e.addressee_id : e.requester_id));
    if (!friendIds.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [] }) };

    // JSON-path projection keeps this to just each friend's shopItems.
    const uRes = await sb(`user_data?id=in.(${friendIds.join(',')})&select=id,items:state->shopItems`, env);
    const rows = uRes.ok ? await uRes.json() : [];

    const map = new Map(); // normalized name → aggregate
    for (const row of rows) {
      const items = Array.isArray(row.items) ? row.items : [];
      const seen = new Set(); // one vote per friend per item
      for (const it of items) {
        if (!it || it.bought || !it.name) continue;
        const key = String(it.name).toLowerCase().replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const e = map.get(key) || { name: String(it.name).slice(0, 80), price: '', url: '', imageUrl: '', coins: 0, count: 0 };
        e.count++;
        if (!e.price && it.price) e.price = String(it.price).slice(0, 20);
        if (!e.url && typeof it.url === 'string' && it.url.startsWith('http')) e.url = it.url;
        if (!e.imageUrl && typeof it.imageUrl === 'string' && it.imageUrl.startsWith('http')) e.imageUrl = it.imageUrl;
        if (!e.coins && it.coinCost) e.coins = it.coinCost;
        map.set(key, e);
      }
    }

    const items = [...map.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 14);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message || 'failed' }) };
  }
};
