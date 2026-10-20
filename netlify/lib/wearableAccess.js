/**
 * May this account START a WHOOP / Oura connect right now? (item 127)
 *
 * While WHOOP and Oura review Vantage, each lets an unapproved app link
 * only 10 accounts. supabase/wearable_access_2026_10.sql adds an owner-
 * kept list and a switch (config 'wearable_access': 'open' | 'allowlist');
 * whoop-connect and oura-connect ask this before issuing an authorize URL,
 * so a refused account hears it from Vantage instead of bouncing off the
 * provider's error page into "connect failed (denied)".
 *
 * This has to be server-side: useIsOwner and anything else in the client
 * is a UI gate, not access control (CLAUDE.md).
 *
 * Allowed when ANY of:
 *   · the mode is not 'allowlist' (incl. the SQL not run yet);
 *   · the caller is the owner (verified email, lib/owner.js);
 *   · the caller is on wearable_access_allowlist;
 *   · the caller already holds a token row for THIS provider — so
 *     "Reconnect WHOOP" keeps working for every account connected
 *     before the switch was flipped. Those accounts already count
 *     against the provider's cap, so letting them reconnect costs no slot.
 *
 * FAIL SOFT = OPEN. Before the SQL is run the config row and the table do
 * not exist; treating that as "nobody may connect" would lock out the
 * owner and every reconnect. Open is exactly today's behaviour, and the
 * worst case of being open (an 11th account) is the provider's own
 * refusal — which is where things stand without this file. A read error
 * while the switch IS on is also treated as open, logged, for the same
 * reason: a transient Supabase blip must not block a listed user.
 *
 * DB load: one tiny config read per connect press; in allowlist mode up
 * to two more indexed single-row reads. Connect is rate-limited to 10 a
 * minute per account already.
 */
const { serviceKeyHeaders, serviceKey: getServiceKey } = require('./sbKeys');
const { isOwnerEmail } = require('./owner');

const TABLES = { whoop: 'whoop_tokens', oura: 'oura_tokens' };
const NAMES = { whoop: 'WHOOP', oura: 'Oura' };

function limitedMessage(provider, listed = false) {
  const name = NAMES[provider] || 'Wearable';
  return listed
    ? `${name} connections are limited while ${name} reviews Vantage. You're on the list.`
    : `${name} connections are limited while ${name} reviews Vantage. You're not on the list yet — everything else works as normal, and you can log sleep, heart rate and workouts by hand on Track.`;
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

/**
 * → { allowed, limited, listed, reason }
 *   limited: the switch is on ('allowlist')
 *   reason:  'open' | 'unconfigured' | 'error' | 'owner' | 'listed' | 'connected' | 'not-listed'
 * Never throws.
 */
async function checkWearableAccess({ userId, email, provider }, env = process.env, fetchImpl = fetch) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = getServiceKey(env);
  if (!url || !key || !userId || !TABLES[provider]) return { allowed: true, limited: false, listed: false, reason: 'unconfigured' };
  const headers = serviceKeyHeaders(key);

  let mode = 'open';
  try {
    const res = await fetchImpl(`${url}/rest/v1/config?key=eq.wearable_access&select=value`, { headers });
    if (!res.ok) return { allowed: true, limited: false, listed: false, reason: 'unconfigured' };
    const rows = await readJson(res);
    const v = Array.isArray(rows) && rows[0] ? String(rows[0].value || '').trim().toLowerCase() : '';
    mode = v === 'allowlist' ? 'allowlist' : 'open';
  } catch {
    console.warn('wearable-access: mode read failed — treating as open');
    return { allowed: true, limited: false, listed: false, reason: 'error' };
  }
  if (mode !== 'allowlist') return { allowed: true, limited: false, listed: false, reason: 'open' };

  // Owner first: no request needed.
  if (isOwnerEmail(email)) return { allowed: true, limited: true, listed: true, reason: 'owner' };

  try {
    const [listRes, tokRes] = await Promise.all([
      fetchImpl(`${url}/rest/v1/wearable_access_allowlist?user_id=eq.${encodeURIComponent(userId)}&select=id`, { headers }),
      fetchImpl(`${url}/rest/v1/${TABLES[provider]}?user_id=eq.${encodeURIComponent(userId)}&select=user_id`, { headers }),
    ]);
    if (!listRes.ok) {
      // Table missing (mode set by hand before the SQL ran) or an error.
      console.warn('wearable-access: list read failed', listRes.status, '— treating as open');
      return { allowed: true, limited: true, listed: false, reason: 'error' };
    }
    const listed = (await readJson(listRes) || []).length > 0;
    if (listed) return { allowed: true, limited: true, listed: true, reason: 'listed' };
    const connected = tokRes.ok && (await readJson(tokRes) || []).length > 0;
    if (connected) return { allowed: true, limited: true, listed: false, reason: 'connected' };
    return { allowed: false, limited: true, listed: false, reason: 'not-listed' };
  } catch {
    console.warn('wearable-access: list read failed — treating as open');
    return { allowed: true, limited: true, listed: false, reason: 'error' };
  }
}

/**
 * The connect functions' gate. Returns a ready 403 response for a refused
 * account, or null to carry on.
 */
async function accessGate({ userId, email, provider }, CORS, env = process.env, fetchImpl = fetch) {
  const a = await checkWearableAccess({ userId, email, provider }, env, fetchImpl);
  if (a.allowed) return null;
  return {
    statusCode: 403,
    headers: CORS,
    body: JSON.stringify({ error: limitedMessage(provider, false), limited: true, listed: false }),
  };
}

/** Body of a { check: true } status call: what the panel may say before Connect. */
function accessStatus(a, provider) {
  return {
    ok: true,
    access: {
      allowed: !!a.allowed,
      limited: !!a.limited,
      listed: !!a.listed,
      // Listed / owner: "You're on the list." Not listed: why Connect will
      // refuse. Already connected (reconnect allowed) or open: nothing.
      message: !a.limited ? null : !a.allowed ? limitedMessage(provider, false) : a.listed ? limitedMessage(provider, true) : null,
    },
  };
}

module.exports = { checkWearableAccess, accessGate, accessStatus, limitedMessage };
