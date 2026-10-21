/**
 * The category profile under OVR: what you are best at, what to work on,
 * and the one thing that would move it next.
 *
 * Since 2026-10-21 OVR is earned from points in ANY category (derive.js),
 * so the four category ratings stopped being four things you are graded
 * on and became a picture of where your points come from. This turns
 * that picture into a sentence.
 *
 * Pure. Reads the displayed ratings (S.ratings) rather than re-deriving,
 * so the words can never disagree with the numbers beside them.
 */
import { trackerDone } from '../trackers/done.js';

export const CATEGORY_LABELS = { brain: 'Brain', finance: 'Finance', fitness: 'Fitness', social: 'Social' };
const ORDER = ['brain', 'finance', 'fitness', 'social'];
const SELF_CHECK_KEY = { brain: 'brainScore', finance: 'financeScore', fitness: 'fitnessScore', social: 'socialScore' };

/**
 * The single most useful next step in `category`, in plain words.
 * → { kind, text } — kind is one of
 *   'add-tracker' · 'tick' · 'self-check' · 'savings' · 'friends' · 'keep'
 *
 * Order is by what pays for longest: a day you show up counts for life,
 * so having a tracker and ticking it come first; the self-check and the
 * one-offs after. `today` is the local 'YYYY-MM-DD' the logs are keyed by.
 */
export function nextStep(S, category, { today = '', friendCount = null } = {}) {
  const label = CATEGORY_LABELS[category] || category;
  const lower = label.toLowerCase();
  const trackers = (S?.trackers || []).filter(t => t && t.category === category);
  if (!trackers.length) {
    return { kind: 'add-tracker', text: `Add a ${lower} tracker. Every day you tick it counts, for good.` };
  }
  const day = (S?.logs || {})[today] || {};
  const open = trackers.find(t => !trackerDone(t, day[t.id]));
  if (today && open && !trackers.some(t => trackerDone(t, day[t.id]))) {
    return { kind: 'tick', text: open.name ? `Tick ‘${open.name}’ today.` : `Tick a ${lower} tracker today.` };
  }
  if (!S?.[SELF_CHECK_KEY[category]]?.result) {
    return { kind: 'self-check', text: `Take the ${label} self-check.` };
  }
  if (category === 'finance' && !(S?.savings || []).some(g => (g?.target || 0) >= 10)) {
    return { kind: 'savings', text: 'Set a savings goal and pay into it.' };
  }
  if (category === 'social' && friendCount != null && friendCount < 3) {
    return { kind: 'friends', text: 'Add a friend.' };
  }
  return { kind: 'keep', text: `Done for today. Come back tomorrow: every day in ${label} counts.` };
}

/**
 * → { best, workOn } from the displayed ratings.
 *   best    { id, label, rating } — the highest category above the floor,
 *           or null while nothing has scored yet
 *   workOn  { id, label, rating, step } — the lowest category that is not
 *           the best, with its next step; null while nothing has scored
 *
 * Ties go to the earlier category in Brain/Finance/Fitness/Social order,
 * so the line does not flicker between two equal ones.
 */
export function categoryProfile(S, opts = {}) {
  const r = S?.ratings || {};
  const rated = ORDER.map(id => ({ id, label: CATEGORY_LABELS[id], rating: Number(r[id]) || 1 }));
  const top = rated.reduce((a, b) => (b.rating > a.rating ? b : a));
  if (top.rating <= 1) return { best: null, workOn: null };
  const low = rated.filter(c => c.id !== top.id).reduce((a, b) => (b.rating < a.rating ? b : a));
  return {
    best: top,
    workOn: { ...low, step: nextStep(S, low.id, opts) },
  };
}
