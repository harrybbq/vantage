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

---

## Apple Health live sync via iOS Shortcut (owner, 2026-07)

Live HealthKit needs a native iOS build + paid Apple Developer
entitlement. The zero-cost stand-in that works today: an iOS Shortcut
reads Health samples and POSTs them to `netlify/functions/health-sync`,
which writes them into `user_data.state` (vitalsLog + burnLog).

- Enable in-app: Track → Vitals & Macros → **Enable live sync** →
  **Copy sync URL**. This stores a random `state.healthToken` and gives
  a URL `…/.netlify/functions/health-sync?token=<token>`.
- The function resolves the token → user via a JSONB filter
  (`user_data?state->>healthToken=eq.<token>`) — no schema change.
- Ingest payload (one day, all fields optional; `date` defaults to
  server today): `{ "date":"YYYY-MM-DD", "steps":N, "weight":kg,
  "sleep":hours, "rhr":bpm }`. Steps → burnLog "N steps" via the app's
  steps→kcal formula; weight/sleep/rhr → vitalsLog.

### The Shortcut recipe ("Vantage Health Sync")
1. New Shortcut. Add actions:
   - **Find Health Samples** (Steps, today, sum) → var `Steps`
   - **Find Health Samples** (Weight, latest) → var `Weight`
   - **Find Health Samples** (Sleep, today, total asleep hours) → `Sleep`
   - **Find Health Samples** (Resting Heart Rate, latest) → `RHR`
   - **Text** → a JSON body: `{"steps":[Steps],"weight":[Weight],"sleep":[Sleep],"rhr":[RHR]}`
   - **Get Contents of URL**: Method POST, Request Body = JSON (or the
     Text above), URL = the copied sync URL, Header `Content-Type:
     application/json`.
2. Automations tab → new **Personal Automation** → Time of Day (e.g.
   07:00 daily) → Run the Shortcut → turn OFF "Ask Before Running".

Keep the sync URL secret — the token is a bearer credential. Tapping
Enable live sync again mints a new token (revokes the old URL).
