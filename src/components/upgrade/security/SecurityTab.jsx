/**
 * Upgrade → Security (formerly "Review"). Owner-only: where the owner
 * runs Vantage's health, traffic, moderation and incident tickets.
 *
 * ── The gate is on the server ────────────────────────────────────────
 * Upgrade is owner-gated by useIsOwner — a UI gate and nothing more.
 * Every number here comes from /.netlify/functions/security-console,
 * which verifies the JWT's email against OWNER_EMAIL and answers anyone
 * else exactly as it answers a bad token. Secrets (Supabase PAT,
 * Netlify token) never leave that function.
 *
 * ── Design research (Oct 2026) → what this page does ──────────────────
 *  1. Status strip first. Statuspage-style and Cloudflare's Security
 *     Overview open on "is anything wrong": three systems, each a state
 *     pill (ok / degraded / down / not configured) before any number.
 *     https://developers.cloudflare.com/security-center/
 *  2. Severity as a stripe + a word. Cloudflare Security Insights rank
 *     Critical / Moderate / Low; Supabase advisors ERROR / WARN / INFO.
 *     Tickets carry a left severity stripe and the word; advisors a level
 *     chip. Colour is never the only channel (dataviz status rule).
 *     https://developers.cloudflare.com/security/security-insights/
 *     https://supabase.com/docs/guides/database/database-advisors
 *  3. Value beside a sparkline, coloured by threshold not by background
 *     (Grafana stat panel: graph mode "area", colour mode "value").
 *     https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/
 *  4. Resource vs limit. Supabase Reports chart CPU, memory, disk and
 *     connections against their ceilings, so meters here are 0–100 %
 *     to scale with the warning lines drawn on the track.
 *     https://supabase.com/docs/guides/telemetry/reports
 *  5. p75 against Google's bands, stated. LCP 2.5 / 4 s, INP 200 / 500
 *     ms, CLS 0.1 / 0.25 (FCP 1.8 / 3 s, TTFB 0.8 / 1.8 s), good ≤ the
 *     first; a banded track shows where the value sits, and pages are a
 *     worst-first table (Vercel Speed Insights' per-route view).
 *     https://web.dev/articles/vitals · https://vercel.com/docs/speed-insights/metrics
 *  6. Deploys as Netlify words them — Published / Failed / Building /
 *     Cancelled — newest first, with branch@sha, age and build time.
 *     https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/
 *  7. Issues, not events. Sentry groups repeats into one issue with a
 *     count and first/last seen, triaged as unresolved / resolved; our
 *     sweep fingerprints conditions the same way (×N, last seen) and the
 *     list filters open / ack / resolved / all.
 *     https://docs.sentry.io/product/issues/
 *  8. Decisions carry a reason and can be undone. Cloudflare's archive
 *     asks for rationale and lets items return; every ticket action and
 *     moderation decision here takes an optional note, and Reopen / Lift
 *     reverse them. Destructive ones (suspend, ban) confirm inline.
 *  9. "Updated Xs ago" + Refresh on every panel; Overview polls 60 s
 *     only while visible. A stale screen must say it is stale.
 * 10. Empty reads healthy. "Nothing open. That is the normal state."
 *     A missing key is a calm setup card naming the env var, not an error.
 *
 * Theme: the Upgrade section's own furniture — solid --upg-solid cards,
 * "//" mono eyebrows, Playfair headings, the .settings-tabs row — in
 * cream-pro and dark-os. Status colours are fixed (not the accent), so
 * a Pro accent scheme can never turn "ok" red. Styles: security.css.
 */
import { useCallback, useState } from 'react';
import WidgetBoundary from '../../WidgetBoundary';
import OverviewPanel from './OverviewPanel';
import DatabasePanel from './DatabasePanel';
import NetlifyPanel from './NetlifyPanel';
import ModerationPanel from './ModerationPanel';
import TicketsPanel from './TicketsPanel';
import './security.css';

export const SUBTABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'database', label: 'Database' },
  { id: 'netlify', label: 'Netlify' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'tickets', label: 'Tickets' },
];
const KEY = 'vantage.upgrade.security.tab';
const valid = id => SUBTABS.some(t => t.id === id);

function readTab() {
  try {
    const v = window.localStorage.getItem(KEY);
    return valid(v) ? v : 'overview';
  } catch { return 'overview'; }
}

/**
 * ── Go to source ─────────────────────────────────────────────────────
 * Every panel gets `go(tab, focus?)`: switch sub-tab and, when `focus`
 * names an element (data-sec-focus — "disk", "deploy:<id>",
 * "advisor:<name>", "stale", "ticket:<uuid>"…), scroll to it and pulse
 * it (useFocusTarget). An alert's explanation (lib/security/explain.js)
 * says which tab and which element its problem lives in.
 * `initialTab` / `initialFocus` come from a deep link
 * (/?upgrade=security&ticket=<id> — what a phone alert opens).
 */
export default function SecurityTab({ initialTab, initialFocus }) {
  const [tab, setTabState] = useState(() => (valid(initialTab) ? initialTab : readTab()));
  const [focus, setFocus] = useState(() => (initialFocus ? { key: initialFocus, n: 1 } : null));
  const setTab = useCallback(id => {
    if (!valid(id)) return;
    setTabState(id);
    try { window.localStorage.setItem(KEY, id); } catch { /* private mode */ }
  }, []);
  const go = useCallback((id, key) => {
    if (!valid(id)) return;
    setTab(id);
    setFocus(key ? { key: String(key), n: Date.now() } : null);
  }, [setTab]);
  const pick = id => { setTab(id); setFocus(null); };

  return (
    <div className="upg-pane sec">
      <div className="settings-tabs career-tabs sec-tabs" role="tablist" aria-label="Security sections">
        {SUBTABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                  className={'settings-tab' + (tab === t.id ? ' settings-tab-active' : '')}
                  onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <WidgetBoundary key={tab} name={`security:${tab}`} variant="section">
        {tab === 'overview' && <OverviewPanel go={go} />}
        {tab === 'database' && <DatabasePanel go={go} focus={focus} />}
        {tab === 'netlify' && <NetlifyPanel go={go} focus={focus} />}
        {tab === 'moderation' && <ModerationPanel go={go} focus={focus} />}
        {tab === 'tickets' && <TicketsPanel go={go} focus={focus} />}
      </WidgetBoundary>
    </div>
  );
}
