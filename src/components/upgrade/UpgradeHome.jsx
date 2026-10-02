/**
 * Upgrade's home menu — what the section opens on. A large title with
 * today's line under it, then one card per section (Career, Diet,
 * Rotation, Security), each carrying a single live line from the data that
 * section already reads. Tapping a card opens that section.
 *
 * Every line is derived from state the tabs already use: the rotation
 * from S, Diet's protein target from the plan plus today's shared day
 * summary (one cached request, the same one the hub uses), Career from
 * the owner store the Career tab loads anyway (module-cached, so opening
 * Career after this costs nothing), and Security from the console's cheap
 * `?panel=overview` (falling back to the crest queue until that function
 * is deployed). Nothing here writes anything.
 *
 * Motion: cards float in, bob for a few seconds, then settle; hover
 * lifts. All of it is off under prefers-reduced-motion.
 */
import { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { resolveDay } from '../../lib/rotation/pattern';
import { planProteinG } from '../../lib/diet/plan';
import { useDaySummary } from '../../lib/diet/daySummary';
import { useOwnerContent } from '../../lib/owner/ownerContent';
import { KEYS } from '../../lib/career/schema';
import { briefFor } from '../../lib/career/brief';
import { usePacing, useLatestVs, todayIso } from './career/careerData';
import { crestQueue } from '../../lib/groups/api';
import { fetchPanel } from '../../lib/security/api';
import { overviewLine } from '../../lib/security/status';

export const SECTIONS = [
  { id: 'career', name: 'Career', icon: 'briefcase', tone: 'gold' },
  { id: 'diet', name: 'Diet', icon: 'utensils', tone: 'em' },
  { id: 'rotation', name: 'Rotation', icon: 'refresh-cw', tone: 'ink' },
  { id: 'security', name: 'Security', icon: 'shield', tone: 'em' },
];

/** Tab ids that used to exist, mapped forward (history entries, deep links). */
export const SECTION_ALIASES = { review: 'security' };
export const resolveSection = id => SECTION_ALIASES[id] || id;

function latestKg(S) {
  const log = (S && S.vitalsLog) || {};
  const days = Object.keys(log).sort();
  for (let i = days.length - 1; i >= 0; i--) if (log[days[i]] && log[days[i]].weight != null) return log[days[i]].weight;
  return null;
}

/** "Night 2 · Pull", "Off · Rest", "Annual leave · Rest" */
export function rotationLine(S, iso = todayIso()) {
  const [y, m, d] = iso.split('-').map(Number);
  const r = resolveDay(y, m - 1, d, (S.rotation && S.rotation.overrides) || {});
  if (!r.inPattern) return 'Before the rotation starts';
  const shift = r.shift === 'night' ? `Night ${r.shiftNum}` : r.shift === 'day' ? `Day ${r.shiftNum}` : r.shift === 'leave' ? 'Leave' : 'Off';
  return `${shift} · ${r.session || 'Rest'}`;
}

function useCareerLine(S) {
  const oc = useOwnerContent('career.');
  const d = oc.data;
  const certs = useMemo(() => d[KEYS.certs] || [], [d]);
  const pacing = usePacing(S, certs);
  const vs = useLatestVs(S, oc);
  if (oc.state === 'loading') return { line: null };
  if (oc.state !== 'ready') return { line: 'Plan, money, certs and the pipeline' };
  const today = todayIso();
  const { actions } = briefFor({
    apps: d[KEYS.applications] || [], companies: d[KEYS.companies] || [], plan: d[KEYS.plan] || null,
    statusMap: d[KEYS.status] || {}, vs, certs, today,
    pacing: pacing.cert ? { cert: pacing.cert, plan: pacing.plan, examIso: pacing.examIso } : null,
  }, d[KEYS.brief] || null);
  const first = actions.find(a => !a.done) || null;
  const exam = pacing.cert && pacing.examIso
    ? `${pacing.cert.name.split(' ·')[0]} in ${Math.max(0, Math.round((Date.parse(pacing.examIso + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000))} d`
    : null;
  const parts = [first ? `Brief · ${first.title}` : 'Nothing pressing this week', exam].filter(Boolean);
  return { line: parts.join(' · ') };
}

/**
 * → { line (for the card), sub (for the title line, or null) }
 * "2 tickets open · all systems ok". Until the security-console function
 * answers, the crest queue's line stands in — it is still real news.
 */
function useSecurityLine() {
  const [out, setOut] = useState({ line: null, sub: null });
  useEffect(() => {
    let live = true;
    (async () => {
      const ov = await fetchPanel('overview');
      if (!live) return;
      if (ov.state === 'ok') { const o = overviewLine(ov.data); setOut({ line: o.line, sub: o.sub }); return; }
      try {
        const body = await crestQueue();
        if (!live) return;
        if (body.setup === false) { setOut({ line: 'Console not deployed yet', sub: null }); return; }
        const n = (body.queue || []).length;
        setOut(n
          ? { line: `${n} picture${n === 1 ? '' : 's'} waiting`, sub: `${n} to review` }
          : { line: 'Nothing to review', sub: null });
      } catch {
        if (live) setOut({ line: 'Couldn’t reach the console', sub: null });
      }
    })();
    return () => { live = false; };
  }, []);
  return out;
}

export default function UpgradeHome({ S, userId, onOpen }) {
  const kg = latestKg(S);
  const target = planProteinG(S, kg);
  const day = useDaySummary(userId);
  const had = day.summary ? Math.round(Number(day.summary.protein_g) || 0) : null;
  const dietLine = `${target} g protein today${had != null ? (had >= target ? ' · target hit' : ` · ${target - had} g to go`) : ''}`;
  const career = useCareerLine(S);
  const security = useSecurityLine();
  const rota = rotationLine(S);
  const lines = { career: career.line, diet: dietLine, rotation: rota, security: security.line };

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const sub = [today, rota, security.sub].filter(Boolean).join(' · ');

  return (
    <div className="uh">
      <header className="uh-hero">
        <span className="uh-eyebrow">Owner · Vantage</span>
        <h2 className="uh-title">Upgrade</h2>
        <span className="uh-sub">{sub}</span>
      </header>
      <div className="uh-grid" role="list">
        {SECTIONS.map((s, i) => (
          <div key={s.id} role="listitem" className={`uh-slot is-${i}`} style={{ '--i': i }}>
            <i className="uh-floor" aria-hidden="true" />
            <div className="uh-bob">
              <button type="button" className={`uh-card tone-${s.tone}`}
                      aria-label={`Open ${s.name}${lines[s.id] ? `. ${lines[s.id]}` : ''}`}
                      onClick={e => onOpen(s.id, e.currentTarget.getBoundingClientRect())}>
                <span className="uh-icon"><Icon name={s.icon} size={24} strokeWidth={1.8} /></span>
                <span className="uh-card-foot">
                  <span className="uh-name">{s.name}</span>
                  <span className="uh-line">
                    <i aria-hidden="true" />
                    {lines[s.id] || <span className="uh-line-wait">Loading…</span>}
                  </span>
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
