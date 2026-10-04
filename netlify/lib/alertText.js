/**
 * One plain-English line per ticket kind — the server's copy.
 *
 * The Security console explains every ticket with
 * src/lib/security/explain.js (headline, why, steps, source). Two server
 * paths need the headline too and cannot import that ES module: the
 * phone ping (lib/alertNotify.js) and the triage agents' queue
 * (functions/security-agent.js). This is the mirror, and
 * src/lib/security/explain.test.mjs (npm run check:alerts) asserts the
 * two produce the SAME headline for every auto-raised kind, so they
 * cannot drift apart.
 *
 * Rules: one line, uses the detail's numbers, and NEVER carries user
 * data — no user id, handle, email or anything a person typed. For a
 * user ticket the server line is generic ("A user reported a bug");
 * only the owner's console shows the person's own words.
 *
 * Pure: no fetch, no env.
 */

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const n = v => (v == null || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Milliseconds → "640 ms" / "2.4 s" (same as src/lib/security/format.js fmtMs). */
function fmtMs(v) {
  const x = n(v);
  if (x == null || x < 0) return '—';
  if (x < 1000) return `${Math.round(x)} ms`;
  return `${(Math.round(x / 100) / 10).toFixed(1).replace(/\.0$/, '')} s`;
}

/** A wait, for a person: "5 h", "30 h", "3 days". */
function fmtWait(ms) {
  const x = n(ms);
  if (x == null || x < 0) return null;
  const h = Math.floor(x / 3600_000);
  if (h < 48) return `${Math.max(1, h)} h`;
  return `${Math.floor(h / 24)} days`;
}

const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const humanName = s => String(s || '').replace(/[_-]+/g, ' ').trim();

/**
 * @param {string} kind     ticket kind (sweepRules.js, 'user:<category>', 'manual')
 * @param {object} detail   the ticket's detail jsonb
 * @param {object} [o]      { title, now } — title is the fallback line
 * @returns {string}
 */
function headlineFor(kind, detail, { title = '', now = Date.now() } = {}) {
  const d = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const k = String(kind || '');
  switch (k) {
    case 'db_unreachable':
      return 'The database isn’t answering — the app can’t load or save';
    case 'db_slow':
      return `The database took ${fmtMs(d.ms)} to answer — normal is under 300 ms`;
    case 'db_disk':
      return `The database disk is ${n(d.usedPct) != null ? Math.round(n(d.usedPct)) : '—'}% full — writes stop when it fills`;
    case 'db_connections':
      return `${n(d.used) ?? '—'} of ${n(d.max) ?? '—'} database connections are in use — new requests will queue`;
    case 'advisor_error':
      return `Supabase’s security advisor flags an error: ${humanName(d.name) || 'a finding'}`;
    case 'client_errors_spike': {
      const last = n(d.lastHour) ?? 0;
      const avg = n(d.trailingHourlyAvg);
      if (!avg) return `${plural(last, 'app error')} in the last hour — usually there are none`;
      return `${plural(last, 'app error')} in the last hour — about ${Math.max(1, Math.round(last / avg))}× the usual ${avg}/h`;
    }
    case 'reports_stale': {
      const c = n(d.count) ?? 0;
      const oldest = Date.parse(d.oldestAt);
      const wait = Number.isFinite(oldest) ? fmtWait(now - oldest) : null;
      return `${plural(c, 'user report')} waiting over a day${wait ? ` — the oldest for ${wait}` : ''}`;
    }
    case 'deploy_failed':
      return 'The latest production deploy failed — the site is still serving the previous build';
    case 'vitals_lcp_poor':
      return `1 in 4 page loads takes ${fmtMs(d.lcpP75Ms)} or longer to show its main content — good is under 2.5 s`;
    case 'ai_cap_repeat':
      return `One account hit the daily ${humanName(d.bucket) || 'AI'} cap on ${n(d.days) ?? '—'} of the last 3 days`;
    default:
      if (k.startsWith('user:')) {
        const cat = humanName(k.slice(5)) || 'other';
        return cat === 'other' ? 'A user sent a problem report' : `A user reported a ${cat} problem`;
      }
      return String(title || 'New ticket').slice(0, 200);
  }
}

module.exports = { headlineFor, fmtMs, fmtWait, isNum };
