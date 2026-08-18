/**
 * Netlify function: groups
 *
 * Everything the group league needs, behind one POST with an `action`.
 * One function rather than six because they share the same lookups —
 * who is the caller, what group are they in — and because a cold start
 * per action on a Micro instance is a worse tax than a switch.
 *
 * ── Why the server assembles the board ───────────────────────────────
 * Reading a group's name and membership is open to any signed-in user
 * (that is how a division table gets drawn), but reading everyone's
 * RATINGS is not. The board joins profiles with the service key here
 * and returns only what the table shows: a name, a crest, a member
 * count, a score. The same trust boundary as get-leaderboard.js — the
 * client is never asked for a number that ranks it.
 *
 * ── Fail-soft ────────────────────────────────────────────────────────
 * If groups_schema.sql has not been run yet, every table read 404s.
 * That is reported as `{ ok: true, setup: false }` rather than an error,
 * so the tab can say "not set up yet" instead of showing a red box on a
 * feature the owner has simply not switched on.
 */

const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const {
  MAX_SEATS, DIVISIONS, sb, fetchBaselines, memberScore, groupScore, groupSplit, rankGroups,
  divisionName, weekStartDate, COIN_AWARD,
} = require('../lib/leagues');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const fail = (statusCode, error) => json(statusCode, { error });

/* Invite codes are shown, read aloud and typed, so the alphabet drops
   the characters people confuse: no O/0, no I/1/L. Randomness comes
   from crypto, not Math.random — a guessable invite is an open group. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  const bytes = require('crypto').randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 32);
const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

// ── Reads ────────────────────────────────────────────────────────────

/** The caller's membership row + group, or null. `setup:false` when the
 *  tables do not exist yet. */
async function myGroup(userId, env) {
  const res = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/group_members?user_id=eq.${userId}&select=role,joined_at,group_id,` +
    `groups(id,name,crest_color,invite_code,owner_id,division,created_at)`
  );
  if (res.status === 404 || res.status === 400) return { setup: false };
  if (!res.ok) throw new Error('membership read failed');
  const rows = await res.json();
  return { setup: true, membership: rows[0] || null };
}

/** Members of one group, scored against Monday. Sorted by climb. */
async function membersOf(groupId, env) {
  const mRes = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/group_members?group_id=eq.${groupId}&select=user_id,role,joined_at`);
  if (!mRes.ok) throw new Error('members read failed');
  const rows = await mRes.json();
  const ids = rows.map(r => r.user_id);
  if (!ids.length) return [];

  const pRes = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,handle,display_name,avatar_url,ratings,ratings_ovr,prestige`);
  const profiles = pRes.ok ? await pRes.json() : [];
  const byId = new Map(profiles.map(p => [p.id, p]));
  const baselines = await fetchBaselines(ids, env);

  return rows.map(r => {
    const p = byId.get(r.user_id) || {};
    const { climb, counted, split } = memberScore(p, baselines.get(r.user_id));
    return {
      userId: r.user_id,
      role: r.role,
      joinedAt: r.joined_at,
      name: p.display_name || (p.handle ? '@' + p.handle : 'Someone'),
      avatarUrl: p.avatar_url || null,
      ovr: p.ratings_ovr || 1,
      categories: {
        brain: p.ratings?.brain || 1, finance: p.ratings?.finance || 1,
        fitness: p.ratings?.fitness || 1, social: p.ratings?.social || 1,
      },
      climb, counted, split,
    };
  }).sort((a, b) => (b.counted - a.counted) || a.name.localeCompare(b.name));
}

/**
 * Every group in a division, scored. One profiles query and one
 * snapshots query for the whole division rather than per group — at 15
 * groups × 20 seats that is 2 round-trips instead of 30, which is the
 * difference that matters on Micro.
 */
async function divisionStandings(division, env) {
  const gRes = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/groups?division=eq.${division}&select=id,name,crest_color,division,created_at,owner_id`);
  if (!gRes.ok) throw new Error('division read failed');
  const groups = await gRes.json();
  if (!groups.length) return [];

  const mRes = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/group_members?group_id=in.(${groups.map(g => g.id).join(',')})&select=group_id,user_id`);
  const memberships = mRes.ok ? await mRes.json() : [];
  const ids = Array.from(new Set(memberships.map(m => m.user_id)));

  let byId = new Map(), baselines = new Map();
  if (ids.length) {
    const pRes = await sb(env.supabaseUrl, env.serviceKey,
      `/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,handle,display_name,ratings_ovr`);
    byId = new Map((pRes.ok ? await pRes.json() : []).map(p => [p.id, p]));
    baselines = await fetchBaselines(ids, env);
  }

  const scored = groups.map(g => {
    const mine = memberships.filter(m => m.group_id === g.id).map(m => {
      const p = byId.get(m.user_id) || {};
      const { climb, counted } = memberScore(p, baselines.get(m.user_id));
      return { userId: m.user_id, name: p.display_name || (p.handle ? '@' + p.handle : 'Someone'), climb, counted };
    });
    const top = mine.slice().sort((a, b) => b.counted - a.counted)[0];
    return {
      id: g.id, name: g.name, crestColor: g.crest_color || null,
      division: g.division, createdAt: g.created_at,
      members: mine.length, score: groupScore(mine),
      topClimber: top && top.counted > 0 ? { name: top.name, climb: top.climb } : null,
    };
  });
  return rankGroups(scored);
}

// ── Writes ───────────────────────────────────────────────────────────

async function createGroup(userId, body, env) {
  const name = cleanName(body.name);
  if (name.length < 2) return fail(400, 'Give the group a name of at least 2 characters.');
  const crest = isHex(body.crestColor) ? body.crestColor : null;

  const mine = await myGroup(userId, env);
  if (!mine.setup) return json(200, { ok: true, setup: false });
  if (mine.membership) return fail(409, 'You are already in a group. Leave it first.');

  // Retry on the (vanishingly unlikely) code collision rather than
  // trusting one draw — the column is unique, so a clash is a 409.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await sb(env.supabaseUrl, env.serviceKey, '/rest/v1/groups', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name, crest_color: crest, invite_code: makeCode(), owner_id: userId }),
    });
    if (res.status === 409) continue;
    if (!res.ok) return fail(500, 'Could not create the group.');
    const group = (await res.json())[0];
    const jRes = await sb(env.supabaseUrl, env.serviceKey, '/rest/v1/group_members', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ group_id: group.id, user_id: userId, role: 'owner' }),
    });
    if (!jRes.ok) {
      // Leave no group with nobody in it — it would sit in the division
      // table forever scoring zero.
      await sb(env.supabaseUrl, env.serviceKey, `/rest/v1/groups?id=eq.${group.id}`, { method: 'DELETE' });
      return fail(500, 'Could not add you to the group.');
    }
    return json(200, { ok: true, groupId: group.id });
  }
  return fail(500, 'Could not allocate an invite code.');
}

async function joinGroup(userId, body, env) {
  const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
  if (code.length < 4) return fail(400, 'That invite code does not look right.');

  const mine = await myGroup(userId, env);
  if (!mine.setup) return json(200, { ok: true, setup: false });
  if (mine.membership) return fail(409, 'You are already in a group. Leave it first.');

  const gRes = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/groups?invite_code=eq.${encodeURIComponent(code)}&select=id,name`);
  const group = gRes.ok ? (await gRes.json())[0] : null;
  if (!group) return fail(404, 'No group has that code.');

  const res = await sb(env.supabaseUrl, env.serviceKey, '/rest/v1/group_members', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ group_id: group.id, user_id: userId, role: 'member' }),
  });
  // The seat trigger raises check_violation when the group is full.
  if (res.status === 409 || res.status === 400) {
    const detail = await res.text().catch(() => '');
    if (/group is full/i.test(detail)) return fail(409, `${group.name} is full — 20 seats.`);
    return fail(409, 'You are already in a group.');
  }
  if (!res.ok) return fail(500, 'Could not join that group.');
  return json(200, { ok: true, groupId: group.id, name: group.name });
}

async function leaveGroup(userId, env) {
  const mine = await myGroup(userId, env);
  if (!mine.setup) return json(200, { ok: true, setup: false });
  if (!mine.membership) return fail(404, 'You are not in a group.');

  const group = mine.membership.groups;
  const isOwner = group.owner_id === userId;

  if (isOwner) {
    /* The owner leaving hands the group to whoever has been in it
       longest rather than deleting it under everyone. A group is other
       people's week; one person quitting should not end it. */
    const others = await sb(env.supabaseUrl, env.serviceKey,
      `/rest/v1/group_members?group_id=eq.${group.id}&user_id=neq.${userId}&select=user_id&order=joined_at.asc&limit=1`);
    const heir = others.ok ? (await others.json())[0] : null;
    if (heir) {
      await sb(env.supabaseUrl, env.serviceKey, `/rest/v1/groups?id=eq.${group.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ owner_id: heir.user_id }),
      });
      await sb(env.supabaseUrl, env.serviceKey,
        `/rest/v1/group_members?group_id=eq.${group.id}&user_id=eq.${heir.user_id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ role: 'owner' }),
        });
    }
  }

  const res = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/group_members?group_id=eq.${group.id}&user_id=eq.${userId}`, { method: 'DELETE' });
  if (!res.ok) return fail(500, 'Could not leave the group.');

  // Last one out: the empty group goes, along with its settled weeks.
  const left = await sb(env.supabaseUrl, env.serviceKey,
    `/rest/v1/group_members?group_id=eq.${group.id}&select=user_id&limit=1`);
  const remaining = left.ok ? (await left.json()).length : 1;
  if (!remaining) {
    await sb(env.supabaseUrl, env.serviceKey, `/rest/v1/groups?id=eq.${group.id}`, { method: 'DELETE' });
  }
  return json(200, { ok: true });
}

/** Owner-only edits: rename, recolour, rotate the code, remove someone. */
async function ownerAction(userId, action, body, env) {
  const mine = await myGroup(userId, env);
  if (!mine.setup) return json(200, { ok: true, setup: false });
  const group = mine.membership?.groups;
  if (!group) return fail(404, 'You are not in a group.');
  if (group.owner_id !== userId) return fail(403, 'Only the group owner can do that.');

  if (action === 'rename') {
    const name = cleanName(body.name);
    if (name.length < 2) return fail(400, 'Give the group a name of at least 2 characters.');
    const patch = { name };
    if (body.crestColor !== undefined) patch.crest_color = isHex(body.crestColor) ? body.crestColor : null;
    const res = await sb(env.supabaseUrl, env.serviceKey, `/rest/v1/groups?id=eq.${group.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
    return res.ok ? json(200, { ok: true }) : fail(500, 'Could not rename the group.');
  }

  if (action === 'rotateCode') {
    const res = await sb(env.supabaseUrl, env.serviceKey, `/rest/v1/groups?id=eq.${group.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ invite_code: makeCode() }),
    });
    if (!res.ok) return fail(500, 'Could not change the code.');
    return json(200, { ok: true, code: (await res.json())[0]?.invite_code });
  }

  if (action === 'kick') {
    const target = String(body.userId || '');
    if (!/^[0-9a-f-]{36}$/i.test(target)) return fail(400, 'No such member.');
    if (target === userId) return fail(400, 'Use Leave to remove yourself.');
    const res = await sb(env.supabaseUrl, env.serviceKey,
      `/rest/v1/group_members?group_id=eq.${group.id}&user_id=eq.${target}`, { method: 'DELETE' });
    return res.ok ? json(200, { ok: true }) : fail(500, 'Could not remove that member.');
  }

  return fail(400, 'unknown action');
}

// ── Handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return fail(405, 'method not allowed');

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const { userId } = auth;
  if (!underLimit('groups', userId, 40)) return tooMany(CORS);

  const env = {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (!env.supabaseUrl || !env.serviceKey) return fail(500, 'supabase env missing');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const action = String(body.action || 'board');

  try {
    if (action === 'create') return await createGroup(userId, body, env);
    if (action === 'join')   return await joinGroup(userId, body, env);
    if (action === 'leave')  return await leaveGroup(userId, env);
    if (action === 'rename' || action === 'rotateCode' || action === 'kick') {
      return await ownerAction(userId, action, body, env);
    }

    // ── board ──
    const mine = await myGroup(userId, env);
    if (!mine.setup) return json(200, { ok: true, setup: false });

    const wantedDivision = Number(body.division);
    const membership = mine.membership;
    const group = membership?.groups || null;
    const division = Number.isInteger(wantedDivision) && wantedDivision >= 1 && wantedDivision <= 10
      ? wantedDivision
      : (group?.division || 10);

    /* My group's position always comes from MY division, even while the
       division picker is showing someone else's. Reading it out of
       whatever table happens to be on screen would report a group as
       "1st of 15" the moment you browsed a division it is not in. */
    const [members, standings, awayStandings] = await Promise.all([
      group ? membersOf(group.id, env) : Promise.resolve([]),
      divisionStandings(division, env),
      group && group.division !== division
        ? divisionStandings(group.division, env)
        : Promise.resolve(null),
    ]);

    const homeStandings = awayStandings || standings;
    const myRow = group ? homeStandings.find(g => g.id === group.id) : null;

    return json(200, {
      ok: true, setup: true,
      selfId: userId,
      weekStart: weekStartDate(),
      coinAward: COIN_AWARD,
      seats: MAX_SEATS,
      divisions: DIVISIONS,
      division: { num: division, name: divisionName(division) },
      group: group ? {
        id: group.id,
        name: group.name,
        crestColor: group.crest_color || null,
        division: group.division,
        divisionName: divisionName(group.division),
        // The code is only ever handed to someone already inside.
        inviteCode: group.invite_code,
        isOwner: group.owner_id === userId,
        createdAt: group.created_at,
        score: myRow?.score ?? groupScore(members),
        position: myRow?.position ?? null,
        zone: myRow?.zone ?? 'held',
        of: homeStandings.length,
        split: groupSplit(members),
      } : null,
      members,
      standings,
    });
  } catch (e) {
    return fail(500, e.message || 'groups failed');
  }
};
