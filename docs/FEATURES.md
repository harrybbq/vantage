# Vantage — Feature Memory

Running notes on planned features: agreed implementation steps, ideas
awaiting design, and the constraints that gate them. Companion to
docs/RANKING_SYSTEM.md (which covers the live ranking/prestige logic).
Update this file whenever a feature plan is agreed in a session.

---

## Calories Burned widget — agreed implementation plan (2026-07-05)

The mobile widget picker stubs "Calories Burned" pending a data
source. Staged plan, agreed with owner:

### Phase 1 — estimate + manual log (no permissions, ship anytime)
1. **BMR baseline** via Mifflin-St Jeor. Weight already lives in
   `S.vitalsLog` (Vitals widget); add height / age / sex to profile
   settings (three fields, one-time).
2. **Activity on top**: tap-to-add rows with standard MET values
   ("＋ Gym 45min"), and/or auto-add an estimate when the Gym Session
   tracker is ticked.
3. Widget headline = **activity burn (exercise + steps) vs calories
   eaten** from nutrition. DECIDED 2026-07-05: resting/BMR burn is
   shown as an info line but NEVER subtracted in net maths — counting
   it made the calorie donut read negative all day. Net = eaten −
   activity only. Steps are a quick-add preset (~0.0005 kcal/step/kg).
4. Store per-day (same shape as `vitalsLog`) so later phases can
   overwrite estimates with sensor truth. Chartable on Track like
   the Vitals history card.

### Phase 2 — Health Connect (Android, needs the native APK build)
1. Capacitor plugin: `capacitor-health-connect` (community).
2. Manifest: `android.permission.health.READ_ACTIVE_CALORIES_BURNED`
   (+ total energy) + Health Connect privacy-policy intent filter.
3. Runtime permission prompt; read daily ActiveCaloriesBurned
   aggregates; sensor data overrides Phase-1 estimates in the store.
4. Play Store distribution later requires Google's health-data
   declaration form + privacy policy URL.
5. **Only works in the installed APK** — browsers/PWA have no health
   data access.

### Phase 3 — HealthKit (iOS; BLOCKED on $99 Apple Developer account)
Mac + Xcode, `npx cap add ios`, HealthKit entitlement (paid account),
`@perfood/capacitor-healthkit`, `NSHealthShareUsageDescription`,
read `activeEnergyBurned`, merge into the shared store.

### Optional parallel — wearable OAuth (works in plain web app)
Strava / Fitbit / Garmin OAuth via Netlify functions, tokens in
Supabase, poll daily summaries. Per-provider effort; only helps users
on that platform.

---

## Idea backlog

### Macros widget — % rings + burn-aware calorie display (owner idea, 2026-07-05)
A hub widget that shows at a glance the **% of each macro consumed
today as circles/rings** (protein / carbs / fat — reuse the ring
language from the tracker rows and nutrition donut). Calories Burned
ties in through the calorie ring: display **total calories consumed,
with the portion offset by burned calories in a separate colour** —
e.g. the consumed arc in the theme accent, with the burned portion
rendered in a second colour so net intake reads visually. Depends on:
nutrition summary (live today) + calories-burned store (Phase 1
above). Design note: one ring per macro + a larger calorie ring;
mobile widget first, desktop hub widget after.
