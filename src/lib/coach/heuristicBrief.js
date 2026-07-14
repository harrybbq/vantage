/**
 * Heuristic daily brief — a rules-based Focus / Watch / 5-min action
 * derived locally from state, with NO API call. Used as the fallback
 * for useDailyBrief when the LLM (ai-coach-daily) isn't configured or
 * is unreachable, so "Today's Brief" is always useful. When the
 * ANTHROPIC_API_KEY is set the richer model output replaces this.
 *
 * Pure: given S, returns { focus, watch, micro, source:'heuristic' }.
 */

const DAY = 86_400_000;
const todayStr = () => new Date().toISOString().slice(0, 10);

function firstName(S) {
  return (S.profile?.name || '').split(' ')[0] || 'there';
}

// Longest currently-running habit + days.
function topHabit(S) {
  const now = Date.now();
  let best = null;
  for (const h of (S.habits || [])) {
    if (!h.startTime) continue;
    const days = Math.floor((now - h.startTime) / DAY);
    if (!best || days > best.days) best = { name: h.name, days, h };
  }
  return best;
}

// Nearest un-hit milestone for a habit, in days.
function nextMilestone(days) {
  const marks = [1, 3, 7, 14, 30, 60, 100, 180, 365];
  return marks.find(m => m > days) ?? null;
}

// A habit whose current run is short relative to its history (relapse
// risk) — used for the "watch out" line, non-shaming.
function riskyHabit(S) {
  const now = Date.now();
  for (const h of (S.habits || [])) {
    if (!h.startTime) continue;
    const days = Math.floor((now - h.startTime) / DAY);
    const relapses = h.relapseCount || 0;
    if (relapses > 0 && days <= 2) return { name: h.name, days };
  }
  return null;
}

function loggedToday(S) {
  const t = todayStr();
  const day = (S.logs || {})[t];
  return !!(day && Object.values(day).some(v => v !== false && v !== 0 && v != null && v !== ''));
}
function macrosLoggedToday(S) {
  return !!(S.macroHistory || {})[todayStr()];
}
function vitalsLoggedToday(S) {
  return !!(S.vitalsLog || {})[todayStr()];
}

// Closest-to-done savings goal (not yet complete).
function closestSaving(S) {
  let best = null;
  for (const g of (S.savings || [])) {
    if (!(g.target > 0) || (g.current || 0) >= g.target) continue;
    const pct = (g.current || 0) / g.target;
    if (!best || pct > best.pct) best = { name: g.name, pct, remaining: g.target - (g.current || 0) };
  }
  return best;
}

export function heuristicBrief(S) {
  const name = firstName(S);
  const hab = topHabit(S);
  const risk = riskyHabit(S);
  const saving = closestSaving(S);

  // ── Focus: the most encouraging, forward-looking line. ──
  let focus;
  if (hab && hab.days >= 1) {
    const next = nextMilestone(hab.days);
    focus = next
      ? `You're ${hab.days} day${hab.days === 1 ? '' : 's'} into ${hab.name} — ${next - hab.days} more to reach ${next}. Protect today and it's yours.`
      : `${hab.days} days clean on ${hab.name}. That's a streak worth guarding — keep the chain unbroken today.`;
  } else if (saving && saving.pct >= 0.5) {
    focus = `${name}, ${saving.name} is ${Math.round(saving.pct * 100)}% funded. You're on the home stretch — every contribution now compounds the finish.`;
  } else if (!loggedToday(S)) {
    focus = `A clean slate today, ${name}. One log — a tracker, a habit check-in — sets the tone for the whole day.`;
  } else {
    focus = `You've already logged today, ${name}. Momentum's the whole game — stack one more small win before tonight.`;
  }

  // ── Watch: the risk to keep an eye on. ──
  let watch;
  if (risk) {
    watch = `${risk.name} restarted recently — the first few days are the wobbliest. Line up your usual triggers and have a plan ready.`;
  } else if (!macrosLoggedToday(S) && (S.macroHistory && Object.keys(S.macroHistory).length > 0)) {
    watch = `No macros logged yet today. It's easiest to fall off the tracking wagon on a quiet day — a 10-second entry keeps the streak alive.`;
  } else if (hab && hab.days >= 7) {
    watch = `Long streaks breed complacency. Don't let a good run on ${hab.name} make you skip the small daily maintenance.`;
  } else {
    watch = `Watch the gap between intention and action — the tasks you keep "meaning to do" are the ones a plan fixes.`;
  }

  // ── Micro: a concrete 5-minute action. ──
  let micro;
  if (!vitalsLoggedToday(S)) {
    micro = `Log one vital — weight or sleep — from the hub. 20 seconds, and your trends stay honest.`;
  } else if (!macrosLoggedToday(S)) {
    micro = `Add your next meal to Daily Macros the moment you eat it — logging live beats reconstructing later.`;
  } else if (saving) {
    micro = `Open ${saving.name} and set a realistic date to hit target — a deadline turns a wish into a plan.`;
  } else {
    micro = `Pick the one task you've been avoiding and give it just five minutes. Starting is the hard part.`;
  }

  return { focus, watch, micro, verbs: [], weekly_review: '', source: 'heuristic' };
}
