/**
 * Alerts that explain themselves. Every ticket kind the Security console
 * can hold → what is wrong, in one plain line; what people feel; what to
 * do; and where the problem lives.
 *
 *   explain(ticket, { links, now }) → {
 *     headline   one line, with the detail's numbers
 *                ("The database took 2.4 s to answer — normal is under 300 ms")
 *     useHeadline  true when the headline says more than the stored title
 *     why        one sentence: what users feel (null when not meaningful)
 *     steps      2–4 short concrete actions
 *     source     { label, tab?, focus?, href?, hrefLabel?, inline? } | null
 *                tab + focus: a Security sub-tab and the element to
 *                highlight there (SecurityTab's go(tab, focus));
 *                href: an https page outside the app (opened in a new tab);
 *                inline: 'errors' — the source is shown in the ticket itself
 *     facts      [{ label, value, title?, wide? }] — the detail, formatted
 *   }
 *
 * `ticket` is normaliseTicket()'s shape plus the raw row as `raw` (for
 * the reporter the server resolved). `links` is the tickets panel's
 * `links` ({ netlifySite, netlify:{deploys,…}, supabase:{reports,…} }):
 * the server derives the site name and project ref, so nothing here is
 * hard-coded.
 *
 * The SERVER keeps a copy of the headlines (netlify/lib/alertText.js —
 * used for the phone ping and the agents' queue, which cannot import
 * this module). explain.test.mjs asserts both say the same thing.
 *
 * Pure: explain.test.mjs pins it (npm run check:alerts).
 */
import { num, fmtInt, fmtMs, fmtPct, ago, stamp, toMs } from './format.js';
import { safeHref } from './status.js';

const humanName = s => String(s || '').replace(/[_-]+/g, ' ').trim();
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const when = t => (toMs(t) == null ? null : { value: ago(t), title: stamp(t) });

/** A wait, for a person: "5 h", "30 h", "3 days" (same as the server's). */
export function fmtWait(ms) {
  const x = num(ms);
  if (x == null || x < 0) return null;
  const h = Math.floor(x / 3600_000);
  if (h < 48) return `${Math.max(1, h)} h`;
  return `${Math.floor(h / 24)} days`;
}

// ── Generic, readable facts for any detail ───────────────────────

/** "trailingHourlyAvg" / "oldest_at" → "Trailing hourly avg" / "Oldest at". */
export function humanKey(k) {
  const s = String(k)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function flat(v, depth = 0) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? fmtInt(v) : fmtInt(v, 2).replace(/\.?0+$/, '');
  if (typeof v === 'string') return v;
  if (depth > 2) return '…';
  if (Array.isArray(v)) return v.length ? v.slice(0, 10).map(x => flat(x, depth + 1)).join(', ') : '—';
  if (typeof v === 'object') {
    const parts = Object.entries(v).slice(0, 10).map(([k, x]) => `${humanKey(k).toLowerCase()}: ${flat(x, depth + 1)}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return String(v);
}

/** One detail field → a fact, formatted by what its name says it is. */
export function factOf(key, v) {
  const label = humanKey(key);
  const k = String(key);
  if (typeof v === 'string' && /(At|_at|Seen|_seen|time)$/i.test(k) && toMs(v) != null) {
    return { label, value: `${ago(v)} · ${stamp(v)}`, title: v };
  }
  if (num(v) != null && typeof v !== 'string' && /ms$/i.test(k)) return { label, value: fmtMs(v) };
  if (num(v) != null && typeof v !== 'string' && /(pct|percent)$/i.test(k)) return { label, value: fmtPct(v) };
  const value = flat(v);
  return { label, value, wide: value.length > 48 };
}

/** Every detail field, readably — never raw JSON as the only content. */
export function genericFacts(detail, skip = []) {
  if (detail == null) return [];
  if (typeof detail === 'string') return detail ? [{ label: 'Detail', value: detail, wide: true }] : [];
  if (typeof detail !== 'object') return [{ label: 'Detail', value: String(detail) }];
  if (Array.isArray(detail)) return detail.slice(0, 20).map((v, i) => ({ label: `Item ${i + 1}`, value: flat(v) }));
  return Object.entries(detail)
    .filter(([k]) => !skip.includes(k))
    .slice(0, 30)
    .map(([k, v]) => factOf(k, v));
}

const fact = (label, value, extra = {}) => (value == null || value === '' ? null : { label, value, ...extra });

// ── Per-kind explanations ────────────────────────────────────────

const USER_CATEGORY = { bug: 'Bug', account: 'Account', privacy: 'Privacy', abuse: 'Abuse', other: 'Other' };

function supa(links, key) {
  return safeHref(links && links.supabase && links.supabase[key]);
}

function deployLog(links, id) {
  const base = safeHref(links && links.netlify && links.netlify.deploys);
  if (!base || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return `${base}/${id}`;
}

/**
 * @param {object} t   normaliseTicket() output (+ raw)
 * @param {object} [ctx] { links, now }
 */
export function explain(t, { links = null, now = Date.now() } = {}) {
  const d = t && t.detail && typeof t.detail === 'object' && !Array.isArray(t.detail) ? t.detail : {};
  const kind = String((t && t.kind) || '');
  const title = (t && t.title) || 'Ticket';
  const out = ({ facts, ...o }) => ({
    useHeadline: true,
    why: null,
    steps: [],
    source: null,
    ...o,
    facts: (facts || []).filter(Boolean),
  });

  switch (kind) {
    case 'db_unreachable':
      return out({
        headline: 'The database isn’t answering — the app can’t load or save',
        why: 'Everyone sees spinners or errors, and nothing they enter is saved until it answers.',
        steps: [
          'Open the Supabase dashboard — a paused or restarting project shows a banner there.',
          'Check status.supabase.com for an incident in your region.',
          'If disk or compute is maxed, free space or raise compute; the app recovers by itself once it answers.',
        ],
        source: { label: 'Database health', tab: 'database', focus: 'health', href: supa(links, 'project'), hrefLabel: 'Supabase dashboard' },
        facts: [fact('What failed', d.message || null, { wide: true }), ...genericFacts(d, ['message'])],
      });

    case 'db_slow':
      return out({
        headline: `The database took ${fmtMs(d.ms)} to answer — normal is under 300 ms`,
        why: 'Every screen that loads or saves data feels sluggish.',
        steps: [
          'Check CPU and connections on the Database tab — a spike usually explains it.',
          'Look for a slow query in Supabase → Reports → Database.',
          'If it lasts for hours, consider the next compute size up from Micro.',
        ],
        source: { label: 'Database health', tab: 'database', focus: 'health', href: supa(links, 'reports'), hrefLabel: 'Supabase reports' },
        facts: [fact('Health ping', fmtMs(d.ms)), fact('Ticket opens over', num(d.thresholdMs) != null ? fmtMs(d.thresholdMs) : null),
          ...genericFacts(d, ['ms', 'thresholdMs'])],
      });

    case 'db_disk': {
      const pct = num(d.usedPct);
      return out({
        headline: `The database disk is ${pct != null ? Math.round(pct) : '—'}% full — writes stop when it fills`,
        why: 'When the disk fills, Postgres goes read-only and every save fails.',
        steps: [
          'See which tables are largest under Database → Tables.',
          'Trim old rows — client_errors and web_vitals carry retention notes in their SQL.',
          'Or raise the disk size in Supabase → Settings → Compute and Disk.',
        ],
        source: { label: 'Disk meter', tab: 'database', focus: 'disk', href: supa(links, 'reports'), hrefLabel: 'Supabase reports' },
        facts: [fact('Disk used', fmtPct(pct)), fact('Ticket opens over', num(d.thresholdPct) != null ? fmtPct(d.thresholdPct, 0) : null),
          ...genericFacts(d, ['usedPct', 'thresholdPct'])],
      });
    }

    case 'db_connections': {
      const used = num(d.used), max = num(d.max);
      return out({
        headline: `${used ?? '—'} of ${max ?? '—'} database connections are in use — new requests will queue`,
        why: 'Past the limit, requests wait or fail — pages hang while loading.',
        steps: [
          'See how many are active versus idle on the Database tab.',
          'An idle pile-up usually means a function not releasing clients — check the latest deploy.',
          'Restarting the project from Supabase clears them in an emergency.',
        ],
        source: { label: 'Connections meter', tab: 'database', focus: 'connections', href: supa(links, 'reports'), hrefLabel: 'Supabase reports' },
        facts: [fact('In use', used != null && max ? `${fmtInt(used)} / ${fmtInt(max)} (${fmtPct((used / max) * 100, 0)})` : null),
          fact('Ticket opens over', num(d.thresholdPct) != null ? fmtPct(d.thresholdPct, 0) : null),
          ...genericFacts(d, ['used', 'max', 'thresholdPct'])],
      });
    }

    case 'advisor_error': {
      const fix = safeHref(d.remediation);
      return out({
        headline: `Supabase’s security advisor flags an error: ${humanName(d.name) || 'a finding'}`,
        why: 'An advisor ERROR usually means data could be read or changed by someone who shouldn’t be able to.',
        steps: [
          'Read the finding under Database → Advisors.',
          'Write the fix to supabase/*.sql and run it in the SQL editor — the fix guide has the SQL.',
          'If it is deliberate, Accept it there with a note so it stops counting.',
        ],
        source: {
          label: 'Advisor finding', tab: 'database', focus: d.name ? `advisor:${d.name}` : 'advisors',
          href: fix || supa(links, 'advisors'), hrefLabel: fix ? 'Fix guide' : 'Supabase advisors',
        },
        facts: [fact('Lint', d.name || null), fact('What it found', d.detail || null, { wide: true }),
          ...genericFacts(d, ['name', 'detail', 'remediation'])],
      });
    }

    case 'client_errors_spike': {
      const last = num(d.lastHour) ?? 0;
      const avg = num(d.trailingHourlyAvg);
      return out({
        headline: avg
          ? `${plural(last, 'app error')} in the last hour — about ${Math.max(1, Math.round(last / avg))}× the usual ${avg}/h`
          : `${plural(last, 'app error')} in the last hour — usually there are none`,
        why: 'People are hitting crashes or broken screens right now.',
        steps: [
          'Read the top error group below — one group usually dominates.',
          'Compare its build with the latest deploy: a new build is the usual cause.',
          'Fix forward, or roll back the deploy in Netlify if the app is broken.',
        ],
        source: { label: 'Top errors', inline: 'errors', tab: 'netlify', focus: 'errors' },
        facts: [fact('Last hour', plural(last, 'error')), fact('Usual', avg != null ? `${avg} an hour` : null),
          ...genericFacts(d, ['lastHour', 'trailingHourlyAvg'])],
      });
    }

    case 'reports_stale': {
      const c = num(d.count) ?? 0;
      const oldest = toMs(d.oldestAt);
      const wait = oldest != null ? fmtWait(now - oldest) : null;
      const w = when(d.oldestAt);
      return out({
        headline: `${plural(c, 'user report')} waiting over a day${wait ? ` — the oldest for ${wait}` : ''}`,
        why: 'The people who reported are waiting, and the reported accounts are still visible.',
        steps: [
          'Open Moderation — the longest-waiting reports are listed first.',
          'Dismiss, suspend or ban each; a short note helps if a decision is challenged.',
          'Aim to decide within 24 hours — store review expects timely responses.',
        ],
        source: { label: 'Stale reports', tab: 'moderation', focus: 'stale' },
        facts: [fact('Waiting over 24 h', fmtInt(c)), w && fact('Oldest', `${w.value} · ${w.title}`, { title: d.oldestAt }),
          ...genericFacts(d, ['count', 'oldestAt'])],
      });
    }

    case 'deploy_failed': {
      const w = when(d.createdAt);
      return out({
        headline: 'The latest production deploy failed — the site is still serving the previous build',
        why: 'Nothing is broken for users yet, but the change you pushed isn’t live.',
        steps: [
          'Open the deploy log and read the first error, not the last.',
          'Run npm run build locally on that commit to reproduce it.',
          'Push the fix — the live site keeps the last good build meanwhile.',
        ],
        source: {
          label: 'Failed deploy', tab: 'netlify', focus: d.deployId ? `deploy:${d.deployId}` : 'deploys',
          href: deployLog(links, d.deployId), hrefLabel: 'Deploy log',
        },
        facts: [fact('Branch', d.branch || null), fact('Deploy', d.deployId ? String(d.deployId).slice(0, 12) : null),
          w && fact('Started', `${w.value} · ${w.title}`, { title: d.createdAt }),
          fact('Error', d.error || null, { wide: true }),
          ...genericFacts(d, ['deployId', 'branch', 'error', 'createdAt'])],
      });
    }

    case 'vitals_lcp_poor':
      return out({
        headline: `1 in 4 page loads takes ${fmtMs(d.lcpP75Ms)} or longer to show its main content — good is under 2.5 s`,
        why: 'Pages feel slow to appear, especially on phones and mobile data.',
        steps: [
          'See which pages are slowest under Netlify → Web vitals.',
          'Check the largest image or font on those pages, and the boot bundle size.',
          'Re-check after a day of traffic — the ticket stops repeating once p75 drops.',
        ],
        source: { label: 'Web vitals', tab: 'netlify', focus: 'vitals' },
        facts: [fact('LCP p75', fmtMs(d.lcpP75Ms)), fact('Page loads sampled', num(d.samples) != null ? fmtInt(d.samples) : null),
          fact('Poor over', num(d.thresholdMs) != null ? fmtMs(d.thresholdMs) : null),
          ...genericFacts(d, ['lcpP75Ms', 'samples', 'thresholdMs'])],
      });

    case 'ai_cap_repeat':
      return out({
        headline: `One account hit the daily ${humanName(d.bucket) || 'AI'} cap on ${num(d.days) ?? '—'} of the last 3 days`,
        why: 'The cost is capped, but this account keeps running into the limit.',
        steps: [
          'Decide whether it looks genuine (steady daily use) or scripted (bursts).',
          'Genuine: the cap may be too low for normal use of that feature.',
          'Scripted: suspend it from Moderation — the cap is already limiting the cost.',
        ],
        source: { label: null, href: supa(links, 'tableEditor'), hrefLabel: 'ai_usage in Supabase' },
        facts: [fact('Feature', humanName(d.bucket) || null), fact('Days at the cap', num(d.days) != null ? `${d.days} of 3` : null),
          fact('Daily cap', num(d.cap) != null ? fmtInt(d.cap) : null),
          fact('Account', typeof d.userId === 'string' ? `…${d.userId.slice(-6)}` : null, { title: d.userId }),
          ...genericFacts(d, ['bucket', 'days', 'cap', 'userId'])],
      });

    case 'manual':
      return out({
        headline: title,
        useHeadline: false,
        steps: ['Your own ticket — resolve it with a note when it’s done.'],
        facts: [fact('Your note', typeof d.text === 'string' ? d.text : null, { wide: true }), ...genericFacts(d, ['text'])],
      });

    default:
      break;
  }

  if (kind.startsWith('user:')) {
    const cat = kind.slice(5) || d.category || 'other';
    const rep = t && t.raw && t.raw.reporter && typeof t.raw.reporter === 'object' ? t.raw.reporter : null;
    const who = rep ? (rep.handle ? `@${rep.handle}${rep.name ? ` (${rep.name})` : ''}` : rep.name || 'Account without a handle') : null;
    return out({
      headline: title,
      useHeadline: false,
      why: 'A person took the time to write in — a reply or a fix within a day or two keeps them.',
      steps: [
        'Read their words below.',
        d.page ? `Try it on ${d.page}${d.release ? ` with build ${d.release}` : ''}.` : 'Try to reproduce it on the latest build.',
        'Resolve with a note once it’s handled.',
      ],
      facts: [
        fact('Their words', typeof d.text === 'string' && d.text ? d.text : null, { wide: true }),
        fact('Reported by', who || 'Unknown (account deleted)'),
        fact('Category', USER_CATEGORY[cat] || humanName(cat)),
        fact('Page', d.page || null),
        fact('App build', d.release || null),
        ...genericFacts(d, ['text', 'category', 'page', 'release']),
      ],
    });
  }

  // Unknown kind: the title, and every detail field written out.
  return out({
    headline: title,
    useHeadline: false,
    steps: ['Read the details below.', 'Acknowledge it so it stops reading as new; resolve it once handled.'],
    facts: genericFacts(t && t.detail),
  });
}

/** What a ticket row shows as its bold line. */
export function ticketHeadline(t, ctx) {
  const e = explain(t, ctx);
  return e.useHeadline ? e.headline : t.title;
}
