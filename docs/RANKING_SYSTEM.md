# Vantage — Ranking / Ratings System (context for Claude)

This file explains how the **OVR + category ratings** work end-to-end so an
agent can reason about or modify them safely. Hand this to Claude alongside a
task. Keep it in sync if you change the logic.

> **Golden rule:** the rating algorithm lives in **TWO places that must stay
> bit-for-bit identical** — the client `src/lib/ratings/derive.js` and the
> server `netlify/lib/recompute.js`. They run in separate module
> graphs (Vite bundle vs Netlify function) so the code is duplicated, not
> imported. **Any change to one MUST be mirrored in the other**, or friends see
> different numbers than the user (a silent rating bug).

---

## 1. What the system produces

Four **category ratings** + one **OVR composite**, each an integer **1–99**:

- `brain`, `finance`, `fitness`, `social` (1–99 each) — where your points
  came from: what you are best at, what to work on
- `ovr` (1–99) — from your points across ALL four, weighted: best category
  in full, then ×0.5, ×0.35, ×0.25 (`BREADTH_WEIGHTS`). Not the mean
  (until 2026-10-21 it was, and anyone who skipped a category was held
  under 20 for life). Progress in any category raises it.

Stored in two places:

| Where | Field | Purpose |
|---|---|---|
| Client state | `S.ratings = { brain, finance, fitness, social, ovr, computedAt }` | What the **user** sees. Recomputed locally (debounced) by `useRatings`. |
| Supabase `profiles` | `ratings` (jsonb) + `ratings_ovr` (int) | What **friends** see. Written only by the server recompute function. |

**Trust boundary:** `S.ratings` is local and tamperable — editing it only
changes the user's own view. Friends read `profiles.ratings_ovr`, which is
derived server-side from raw `user_data.state`. So gaming must be prevented in
the *derivation*, not by trusting the client.

---

## 2. Data flow

```
user edits state ──► useRatings (1.5s debounce)
                       ├─► deriveRatings(S)         → writes S.ratings (instant local view)
                       └─► POST /.netlify/functions/recompute-ratings (JWT)
                              └─► reads raw user_data.state via service role
                              └─► deriveRatings(state)  (same algorithm)
                              └─► PATCH profiles.{ratings, ratings_ovr, ratings_computed_at}
```

`recompute-ratings.js` also reads the user's **accepted friend count** from the
`friendships` table for the social rating (the client passes `friendCount` via
`ctx`).

---

## 3. The maths

### 3a. Points → rating curve (`toRating`) — since 2026-10-21

```js
toRating(points, full) = clamp(round(1 + 98 × min(1, points / full)^0.75), 1, 99)
points <= 0 → 1

category: full = PILLAR_FULL   (= OVR_FULL / Σ BREADTH_WEIGHTS ≈ 81)
ovr:      full = OVR_FULL = 170, points = Σ sorted-desc category points × [1, 0.5, 0.35, 0.25]
```

Category points are net of the prestige baseline (§4b) before either curve.
Tuned so a committed all-rounder prestiges about every 90 days, one category
done well about every 6 months, two categories three days a week inside a
year — `src/lib/ratings/ladder.test.mjs` simulates those people through the
real code and prints the numbers. The weights are monotone: more points
anywhere never lowers OVR.

### 3b. Per-category composition (raw points before `toRating`)

```
brainPts   = selfCheck + days×1 + trackers30d       + ach×2.5 + visions
financePts = selfCheck + days×1 + trackers30d + savings + ach×2.5 + visions
fitnessPts = selfCheck + days×1 + trackers30d       + ach×2.5 + visions
socialPts  = selfCheck + days×1 + socialPoints(friends + active days) + ach×2.5 + visions
```

**Days you showed up** (`pillarDays`, DAY_POINTS = 1): lifetime count of
days with something logged in the category, once per category per day. For
Fitness a day counts if a fitness tracker was ticked, OR vitals were logged
(weight/sleep/RHR), OR activity was logged (any kcal > 0) — the union, not a
sum. On-target macro days (`ctx.macroDays`, a count without dates — nutrition
lives in its own tables; client caches it, server counts it with
`fetchMacroDays`) set a floor on that count. Until 2026-10-21 vitals, burn
and macros paid Fitness extra on top of its days (≈1.4/day more), so a
fitness-only user climbed ~3× faster than a brain-only one doing the same
work.

`onTargetMacroDays` = lifetime count of nutrition_daily_summary rows with
calories within [50%, 130%] of the CURRENT Calories goal (accepted
approximation).

### 3c. The point sources

| Source | Function | Max / shape |
|---|---|---|
| **Self-check** (per category) | `selfCheckPoints(score)` | 16-question quiz result `70–130` → linearly `2–6` pts (was 6–18 until 2026-10-21). Stored at `S.brainScore` / `financeScore` / `fitnessScore` / `socialScore` = `{ result, ts, testVersion }`. Re-takeable every 30 days. |
| **Trackers** | `trackerPoints(S, cat)` | Per tracker: `(days logged in last 30 / 30) * 10`, capped at 4 trackers' worth per category. No logs = 0 (creating trackers is worthless without history). Same weight in every category since 2026-10-21. |
| **Achievements** | `achievementPoints(S, cat)` | See anti-gaming below. Multiplied by **2.5** in the composition. |
| **Savings** (finance only) | `savingsPoints(S)` | Goals with target ≥ £10; counted target capped at £25k total; per-goal `min(current,target)/target`. Full £25k completion = 30 pts. |
| **Social** | `socialPoints(S, friendCount)` | `friends/20 * 12` (caps at 20 friends) + `activeDays/30 * 16` (distinct days with any log in last 30). |
| **Visions** | `visionPoints(S, cat)` | System milestones (`src/lib/visions/definitions.js`), user can't create/edit them — clean anti-gaming anchors. Each unlocked vision = `xp/40` pts to its category (was xp/4 until 2026-10-21 — the 8,200 xp catalogue was worth seven prestiges by itself); uncategorised visions split `0.25` across all four. |

Key constants (both files): `DAY_MS`, `TIME_SPACING_MS = 7 days`,
`SAVINGS_MIN_TARGET = 10`, `SAVINGS_TOTAL_CAP = 25000`,
`TRACKER_HISTORY_DAYS = 30`, `FULL_CREDIT_N = 8`.

---

## 4. Anti-gaming rules (important)

The whole point: ratings should reflect sustained real activity, not bursts.

1. **Trackers need history, not creation** — `trackerPoints` scales with logged
   days over a 30-day window. A freshly-created tracker is worth 0.

2. **Achievements: 7-day time-spacing** — a completed achievement only counts if
   `completedAt - createdAt >= 7 days`. Legacy/seed achievements without
   `createdAt` are treated as legitimately old. (`createdAt` is stamped at
   creation in `handleAddAchievement`.)

3. **Achievements: diminishing returns** (`FULL_CREDIT_N = 8`) — per category,
   the first 8 qualifying completions count fully; beyond that the count is
   `8 + sqrt((count - 8) * 8)`. So 50 completions ≈ 25, 100 ≈ 35, 1000 ≈ 97.
   Stops "create 1000, complete them all" inflation even with spacing.

4. **Achievements: daily creation cap** (UI, `handleAddAchievement` in
   `Modals.jsx`) — max new achievements per rolling 24h: **15 free / 40 Pro**.
   Client-side only (a determined attacker bypassing the UI is still neutered by
   rule 3 server-side).

5. **Savings caps + min target** — goals < £10 ignored; total counted target
   capped at £25k; overshooting a goal doesn't multiply.

6. **Self-checks** map a bounded `70–130` score to `2–6` pts, so one quiz can't
   dominate; re-takeable only every 30 days (`isCooldownActive` in
   `SelfCheck.jsx`).

7. **Visions** are system-defined and unforgeable — the anti-gaming anchor.

If you add a new point source, ask: *can a user inflate it cheaply and
instantly?* If yes, gate it (history window, time-spacing, diminishing returns,
or a hard cap) **in `deriveRatings`** so the server enforces it.

---

## 4b. Prestige (competitive reset, lifetime standing)

OVR stays 0–99. At **canonical OVR 99** the user may **prestige** (explicit,
user-confirmed, server-validated): `profiles.prestige += 1` (cap 99) and the
competitive climb restarts — **no user data is wiped**.

- Mechanism: `prestige-up.js` snapshots the user's current **raw per-category
  points** (`derivePoints` in `netlify/lib/recompute.js`) into
  `profiles.prestige_baseline`; `recomputeUser` then derives ratings from
  `max(0, rawPts − baseline)`. Each prestige overwrites (not adds to) the
  baseline, so every climb starts from zero.
- Cooldowns / self-check results / achievements / logs are untouched —
  competitive reset only.
- The client subtracts the same baseline: `recompute-ratings` and
  `prestige-up` return it, `useRatings` caches it as `S.prestigeBaseline`
  (additive key; server-cache, ignored by the wipe guard) and passes it to
  `deriveRatings(S, { baseline })`. Before 2026-10-21 the client was
  un-baselined — harmless while nobody could prestige, wrong once a
  committed user does it every three months.
- **Weekly numbers across a prestige** (`netlify/lib/ratingsEpoch.js`
  `climbSince`): a prestige between two snapshots counts as the climb to 99
  plus the climb since, for the weekly board and the group leagues. The
  7-day prestige cooldown keeps it to one per week. The same file holds
  `FORMULA_EPOCH_ISO`: snapshots from before the last formula change are
  not compared — bump it to the DEPLOY day whenever the maths changes.
- Lifetime sort key: `profiles.lifetime_rating` (generated column,
  `prestige*100 + ratings_ovr`). All-time leaderboards sort by it.
- Display: "Prestige 4" in words, "P4" on badges, coloured by band (until
  2026-10-21 badges read "GREEN IV", a numeral that restarted per colour) —
  `src/lib/ratings/prestige.js` (bands config) + `PrestigeBadge.jsx` +
  `.prestige-*` CSS. Bands: P1-9 forest green, 10-19 yellow, 20-29 indigo,
  30-39 red, 40-49 burgundy, 50-59 purple, 60-69 ocean, 70-79 cyan,
  80-89 gold, 90-99 crimson. P0 = no badge.
- `S.prestige` is a display-only local cache (fed by the recompute response);
  the server enforces everything.

## 5. Prestige tiers (display only — NOT part of the maths)

`src/lib/ratings/tiers.js` → `ovrTier(ovr)` maps the OVR to a glow band. Purely
cosmetic (colour + label), does not affect any score:

| OVR | Tier |
|---|---|
| 0–19 | Bronze |
| 20–39 | Silver |
| 40–59 | Gold |
| 60–79 | Emerald |
| 80–89 | Diamond |
| 90–99 | Ruby |

(Distinct from the 3-tier **Starting / Mid / Elite** scale `RatingsPanel.jsx`
uses to label individual category bars.)

---

## 6. Key files

| File | Role |
|---|---|
| `src/lib/ratings/derive.js` | **Client** algorithm. Source of truth #1. |
| `netlify/functions/recompute-ratings.js` | **Server** algorithm — must mirror derive.js exactly. Source of truth #2. |
| `src/hooks/useRatings.js` | Debounced recompute + server sync trigger. |
| `src/lib/ratings/tiers.js` | Prestige tier bands (cosmetic). |
| `src/components/RatingsPanel.jsx` | The "Ledger" UI: OVR hero + 4 category rows + tap-to-explain breakdown. `categoryBreakdown(S, cat)` (in derive.js) drives the modal. |
| `src/components/SelfCheck.jsx` + `BrainCheck/FinanceCheck/FitnessCheck/SocialCheck.jsx` | The 16-question self-checks feeding `*Score` points. |
| `src/lib/visions/definitions.js` | The unforgeable vision milestones. |
| `supabase/ratings_schema.sql` | `profiles.ratings` + `ratings_ovr` columns + index. |

---

## 7. Gotchas / invariants for an agent

- **Mirror derive.js ↔ netlify/lib/recompute.js on every change.** Different
  module graphs; no shared import. Drift = friends see wrong numbers.
  `npm run check:parity` (part of the build) runs both, fresh and after a
  prestige, and fails past one point.
- The server reads vision xp from the mirrored table in
  `netlify/lib/visionXp.js`. If you change vision weighting, reconcile both.
- Change the curve or any weight → re-run `npm run check:ladder` (it prints
  days per prestige) and bump `FORMULA_EPOCH_ISO` in
  `netlify/lib/ratingsEpoch.js` to the deploy day.
- Never trust `S.ratings` for anything authoritative; the server value on
  `profiles` is canonical for friend-facing display.
- `friendCount` is only available server-side (from `friendships`); the client
  passes it through `ctx.friendCount` where known.
