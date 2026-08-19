/**
 * Vision XP, as the server sees it.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 * `src/lib/visions/definitions.js` is the one true list, but each entry
 * carries a `check(S)` closure and lives in the app's ESM module graph;
 * the Netlify functions are CommonJS and bundle separately. The server
 * used to work around that by pricing EVERY vision at a flat 8 xp —
 * which was not a rounding error but an order of magnitude. 22 visions
 * worth 5,100 xp were scored as 176, so the leaderboard showed an OVR
 * of 9 for a user the app was showing 20. The board looked frozen for
 * weeks because at those point totals the sqrt curve barely moves.
 *
 * So: the numbers, and only the numbers, mirrored here. No predicates,
 * nothing to execute. `npm run check:visions` fails the build if this
 * table and the definitions ever disagree — which is the only thing
 * that makes a mirror safe to keep.
 *
 * Adding a vision? Add it there, then run `npm run check:visions`,
 * which prints the line to paste here.
 */

const VISION_XP = {
  "streak-7": { xp: 50, category: 'fitness' },
  "streak-30": { xp: 200, category: 'fitness' },
  "streak-100": { xp: 500, category: 'fitness' },
  "log-7": { xp: 50 },
  "log-30": { xp: 200 },
  "tracker-perfect-week": { xp: 100 },
  "ach-3": { xp: 75 },
  "ach-10": { xp: 300 },
  "ach-25": { xp: 600 },
  "log-100": { xp: 500 },
  "streak-365": { xp: 1000, category: 'fitness' },
  "habits-3": { xp: 50, category: 'fitness' },
  "savings-first": { xp: 150, category: 'finance' },
  "savings-goals-3": { xp: 75, category: 'finance' },
  "savings-1k": { xp: 100, category: 'finance' },
  "savings-10k": { xp: 400, category: 'finance' },
  "coins-1k": { xp: 100 },
  "coins-5k": { xp: 300 },
  "vitals-7": { xp: 75, category: 'fitness' },
  "macros-7": { xp: 75, category: 'fitness' },
  "holiday-planned": { xp: 50 },
  "holiday-done": { xp: 150 },
  "check-brain": { xp: 75, category: 'brain' },
  "brain-30": { xp: 200, category: 'brain' },
  "brain-100": { xp: 500, category: 'brain' },
  "check-finance": { xp: 75, category: 'finance' },
  "finance-30": { xp: 200, category: 'finance' },
  "finance-100": { xp: 500, category: 'finance' },
  "check-fitness": { xp: 75, category: 'fitness' },
  "fitness-30": { xp: 200, category: 'fitness' },
  "fitness-100": { xp: 500, category: 'fitness' },
  "check-social": { xp: 75, category: 'social' },
  "social-30": { xp: 200, category: 'social' },
  "social-100": { xp: 500, category: 'social' },
};

module.exports = { VISION_XP };
