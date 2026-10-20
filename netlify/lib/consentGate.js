/**
 * Consent, enforced on the server (STARTUP_REQUIREMENTS item 98, DPIA G1).
 *
 * The app already stops passive wearable pulls when health consent is
 * declined and asks before every AI call. Those are client checks; this
 * makes the servers that act on a user's data honour the same answer.
 *
 * ── The rule — the client's, exactly ────────────────────────────────
 * S.consent (src/lib/consent/consent.js):
 *   kind → ISO string  granted
 *   kind → null/false  declined, or granted then withdrawn
 *   kind absent        never asked (accounts from before the consent
 *                      sheet, until they answer it)
 *
 *   health sync (whoop/oura sync + cron, health-sync): runs unless the
 *     status is DECLINED. "Never asked" keeps syncing — that is what the
 *     client does (whoopClient/ouraClient: `!== 'declined'`), and these
 *     users connected a wearable themselves before consent existed.
 *     Silently stopping their sync would be the wrong failure.
 *   AI (ai-coach-daily, ai-food-detect, recipe-from-video): runs only
 *     when GRANTED. The client never makes an AI call without it
 *     (requestConsent / useDailyBrief), so the server matches.
 *
 * ── consent_events (item 99) ────────────────────────────────────────
 * The latest event for a kind, when there is one, is fresher than the
 * state blob (state saves are debounced; the event is written the moment
 * the person answers). So:
 *   · latest event = withdrawn  → declined, whatever the state says
 *   · latest event = granted    → granted — unless the state says
 *     declined and the event is older than STALE_GRANT_MS, i.e. the state
 *     has had ample time to catch up and says no (a withdrawal whose
 *     event never landed, e.g. offline). Withdrawal wins ties.
 *   · no event                  → the state decides.
 * Until supabase/privacy_lockdown_2026_10b.sql runs there is no table;
 * events are then simply absent and the state decides alone.
 *
 * ── Load (Micro-level) ──────────────────────────────────────────────
 * One JSON-path projection (`consent:state->consent`, a few hundred
 * bytes) plus one indexed read of consent_events — batched with
 * `in.(…)` where a cron loops over many accounts.
 */
const sbKeys = require('./sbKeys');

const KINDS = ['health', 'ai'];
const STALE_GRANT_MS = 10 * 60_000;
const CHUNK = 100;
const EVENTS_MISSING_RETRY_MS = 10 * 60_000;
let eventsMissingUntil = 0;

/** 'granted' | 'declined' | 'unasked' — mirrors consentStatus in src/lib/consent/consent.js. */
function stateStatus(consent, kind) {
  const v = consent && typeof consent === 'object' ? consent[kind] : undefined;
  if (typeof v === 'string' && v) return 'granted';
  if (v === null || v === false) return 'declined';
  return 'unasked';
}

/**
 * Combine the state's answer with the latest consent_events row.
 *   event: { granted: boolean, created_at: ISO } | null
 */
function effectiveStatus(consent, event, kind, now = Date.now()) {
  const s = stateStatus(consent, kind);
  if (!event || typeof event.granted !== 'boolean') return s;
  if (!event.granted) return 'declined';
  const at = Date.parse(event.created_at);
  if (s === 'declined' && (!Number.isFinite(at) || now - at > STALE_GRANT_MS)) return 'declined';
  return 'granted';
}

const healthSyncAllowed = status => status !== 'declined';
const aiAllowed = status => status === 'granted';

function headers(env) { return sbKeys.serviceHeaders(env); }

/** Latest event per user for `kind` → Map. Never throws; missing table → empty. */
async function latestEvents(ids, kind, env, fetchImpl) {
  const out = new Map();
  if (!ids.length || Date.now() < eventsMissingUntil) return out;
  try {
    const res = await fetchImpl(
      `${env.SUPABASE_URL}/rest/v1/consent_events?select=user_id,granted,created_at&kind=eq.${kind}` +
      `&user_id=in.(${ids.join(',')})&order=created_at.desc&limit=${ids.length * 20}`,
      { headers: headers(env) });
    if (res.status === 404 || res.status === 400) { eventsMissingUntil = Date.now() + EVENTS_MISSING_RETRY_MS; return out; }
    if (!res.ok) return out;
    for (const r of (await res.json()) || []) if (!out.has(r.user_id)) out.set(r.user_id, r);
  } catch { /* events are a refinement; the state still decides */ }
  return out;
}

/**
 * Consent status for many users at once.
 * → Map(userId → 'granted' | 'declined' | 'unasked'), or null when the
 *   state could not be read (callers fail CLOSED for that run: a cron
 *   skips — the next run catches up, its window is days — and an HTTP
 *   function answers 503).
 */
async function consentStatuses(userIds, kind, env = process.env, fetchImpl = fetch) {
  if (!KINDS.includes(kind)) throw new Error(`unknown consent kind: ${kind}`);
  const ids = [...new Set((userIds || []).filter(id => /^[A-Za-z0-9-]{1,64}$/.test(String(id))))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let rows;
    try {
      const res = await fetchImpl(
        `${env.SUPABASE_URL}/rest/v1/user_data?select=id,consent:state->consent&id=in.(${chunk.join(',')})`,
        { headers: headers(env) });
      if (!res.ok) { console.error('consentGate: state read failed', res.status); return null; }
      rows = await res.json();
    } catch (e) {
      console.error('consentGate: state read unreachable', e?.message);
      return null;
    }
    const events = await latestEvents(chunk, kind, env, fetchImpl);
    const byId = new Map((rows || []).map(r => [r.id, r.consent]));
    const now = Date.now();
    for (const id of chunk) out.set(id, effectiveStatus(byId.get(id), events.get(id) || null, kind, now));
  }
  return out;
}

/** One user. → status string, or null when it could not be read. */
async function consentStatus(userId, kind, env = process.env, fetchImpl = fetch) {
  const m = await consentStatuses([userId], kind, env, fetchImpl);
  return m ? (m.get(userId) || 'unasked') : null;
}

/**
 * For a caller that already holds the user's state (health-sync reads
 * it anyway): only the consent_events read is added.
 */
async function statusFromState(consent, userId, kind, env = process.env, fetchImpl = fetch) {
  const events = await latestEvents([userId], kind, env, fetchImpl);
  return effectiveStatus(consent, events.get(userId) || null, kind);
}

/** Ready-made refusals for HTTP functions. */
const AI_CONSENT_MESSAGE = 'AI features are off for your account. Turn on AI consent in Settings → Privacy → Consent to use this.';
const HEALTH_CONSENT_MESSAGE = 'Health data consent is off, so wearable sync is paused. Turn it back on in Settings → Privacy → Consent.';

function consentRefusal(kind, CORS) {
  return {
    statusCode: 403,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: kind === 'ai' ? AI_CONSENT_MESSAGE : HEALTH_CONSENT_MESSAGE, consent: kind }),
  };
}

function consentUnavailable(CORS) {
  return {
    statusCode: 503,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: 'Could not check your settings — try again in a moment.' }),
  };
}

/**
 * For HTTP handlers: the response to return when `kind` doesn't allow
 * this call, else null.   const c = await consentGate(userId, 'ai', CORS); if (c) return c;
 */
async function consentGate(userId, kind, CORS, env = process.env, fetchImpl = fetch) {
  const status = await consentStatus(userId, kind, env, fetchImpl);
  if (status === null) return consentUnavailable(CORS);
  const allowed = kind === 'ai' ? aiAllowed(status) : healthSyncAllowed(status);
  return allowed ? null : consentRefusal(kind, CORS);
}

/** Tests only. */
function _resetConsentGate() { eventsMissingUntil = 0; }

module.exports = {
  KINDS, STALE_GRANT_MS, stateStatus, effectiveStatus, healthSyncAllowed, aiAllowed,
  consentStatuses, consentStatus, statusFromState, consentGate, consentRefusal,
  AI_CONSENT_MESSAGE, HEALTH_CONSENT_MESSAGE, _resetConsentGate,
};
