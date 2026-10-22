# Shrinking the per-user state: design and migration plan

STARTUP_REQUIREMENTS items **25** (base64 images out of `state`) and **26**
(per-day logs into tables). Also touches items 27 (PITR), 44 (ranking
forgery), 49/50 (server writers), 54 (anti-wipe guard), 59 (photo), 82
(restore drill) and 88 (compute size).

**Status: PLAN ONLY, drafted 2026-10-20.** Nothing here is built, no SQL
has been run, nothing is deployed. The draft SQL is in
`supabase/state_size_DRAFT_not_run.sql` and must not be run until the
phase it belongs to is approved.

---

## Contents

- [Summary](#summary)
- [0. Rules this plan obeys](#0-rules-this-plan-obeys)
- [1. Where the bytes are today](#1-where-the-bytes-are-today)
- [2. How state moves today](#2-how-state-moves-today)
- [3. Target design](#3-target-design)
- [4. Migration phases](#4-migration-phases)
- [5. Expected result](#5-expected-result)
- [6. Draft SQL](#6-draft-sql)
- [7. Test plan](#7-test-plan)
- [8. Effort and order](#8-effort-and-order)
- [9. Risks and open questions for the owner](#9-risks-and-open-questions-for-the-owner)
- [Appendix A. Every reader and writer of the keys that move](#appendix-a-every-reader-and-writer-of-the-keys-that-move)

---

## Summary

- **Images (item 25).** Every base64 picture in `state` moves to a private
  Supabase Storage bucket, `media`. In `state` the field keeps its place and
  its type, a string, but holds a short reference (`vbm:media/<uid>/bg/<sha256>.jpg`)
  instead of a ~100–400 kB data URI. The client turns references into
  pictures through batched signed URLs and an IndexedDB cache, so a
  returning device downloads each picture once. The swap is done **on the
  server, one image at a time**, guarded by a hash of the exact value it
  replaces, with the original kept in a server-only ledger for 90 days.
- **Per-day logs (item 26).** `vitalsLog`, `burnLog`, `bodyLog` (and the
  retired `moodLog`) move to **one generic table**,
  `daily_log(user_id, kind, day, data jsonb)`. Clients and servers write it
  through two `SECURITY DEFINER` functions that apply key-level patches. No
  write path can delete a row, removals are journaled, and the client cannot
  forge provenance or creation time. Wearable crons stop rewriting the
  whole state.
- **The app's code mostly does not change shape.** About 30 files read
  `S.vitalsLog` / `S.burnLog` synchronously (Appendix A). The plan keeps that
  shape in memory. A new log store fills `S.vitalsLog` etc. from table rows,
  and a diff layer turns edits into table patches. Readers do not change.
- **Migration:** expand → shadow-write → backfill → verify → switch reads →
  wait for old builds to go → owner-approved, per-user, verified cleanup.
  Old keys are never removed in the release that copies them. Old builds,
  meaning a stale service worker today and old store binaries after launch,
  keep working at every phase, and nothing they write is lost.
- **Expected result:** state goes from ~967 kB to ~430 kB after the images
  move and to roughly 90 kB (estimated range 60–150 kB) after the logs
  move. A full load on open goes from ~1 MB to ~0.15 MB. A wearable cron
  write goes from ~2 MB to ~2 kB.
- **Do the images first.** They are the biggest share (~539 kB), the
  simplest change (a value swap, no change to meaning), and fully reversible
  from the ledger.
- **Timing matters for the store launch.** The first native binary must
  already contain the final client logic: reading logs from the table,
  following the cleanup marker, and resolving image references. Store
  builds are not replaced by a service worker, so any binary without that
  logic would stay in use indefinitely.

---

## 0. Rules this plan obeys

These come from CLAUDE.md ("DATA SAFETY IS PRIORITY #1"), the 2026-05-03
wipe (`f6a7a50`; not in the shallow clone here, described in
`public/sw.js:28-33` and `src/main.jsx:44-48`), the 2026-09-25 replay
incident (`src/lib/state/merge.js:147-165`) and the PR template
(`.github/pull_request_template.md`).

| # | Invariant | How the plan keeps it |
|---|---|---|
| R1 | **Copy, verify, switch, and only much later remove.** No release both copies data and removes the source. | Removal from `state` is a separate SQL function. The owner runs it per user, after the old builds have gone. It re-verifies inside the same transaction and archives what it removes (§4 L7, I5). |
| R2 | **No new path can delete user data when the app loads.** | Clients have no `DELETE` and no direct `INSERT`/`UPDATE` on the new tables. All writes go through patch functions. A key can be removed only by an explicit edit to a key the client actually loaded from the server. Bulk removals are refused on both client and server. Every overwrite or removal is journaled. |
| R3 | **Old builds keep working at every phase.** What they read stays complete until cleanup, and what they write is absorbed, never dropped. | Dual-write until cleanup. A server reconciler copies anything an old build wrote. After cleanup, a regrown key is absorbed back into the table (§4 matrix). |
| R4 | **"Moved to tables" must never look like "empty state" to the anti-wipe guard.** | Cleanup writes a non-empty marker object, `logsInTables`. Both `hasMeaningfulData` (`src/lib/state/meaningful.js`) and the SQL `vb_state_meaningful` (audit version) already treat any non-empty object not on the ignore list as evidence, so the marker protects the row automatically. Tests pin this (§7). |
| R5 | **Every phase has a flag and a rollback that needs no data restore.** | Flags live in a small `app_config` table. Each phase's rollback is "flag off" or "revert the build", because the old copy is still complete (§4). |
| R6 | **Server writes stay compare-and-set until the state copy is gone.** | `netlify/lib/stateWrite.js` stays in use for the state half of every dual-write. The new table writes are key-level patches, so they need no whole-row CAS. |
| R7 | **Fail soft until the SQL is applied.** | Every new call treats 404/400 (missing table or function) as "feature off", which is exactly today's behaviour. |
| R8 | **Bump `CACHE_VERSION`** on every client phase, so web clients reload onto the new build (`src/main.jsx:59-101`). | Listed per phase in §4. |

---

## 1. Where the bytes are today

### 1.1 What the checklist measured

Item 25: state is **~967 kB** per user, and `holidays` + `backgrounds` are
**~539 kB** of that, all base64 data URIs. Item 26: with both moves the
state would be **~90 kB**. So the per-day logs and the rest of the
growing stores are about 967 − 539 − 90 ≈ **340 kB**.

The split below is an estimate from the code. **Phase 0 confirms it with
aggregate-only SQL** (sizes per key and percentiles; no content leaves the
database; queries in the draft SQL §0). As an alternative,
`scripts/state-size.mjs` can be run locally on the owner's own export,
which must never be committed.

**Measured live, 2026-10-22** (aggregate-only queries from draft §0;
7 rows in `user_data`):

| Measure | Value |
|---|---|
| State size, wire (`octet_length(state::text)`) | mean 247 kB · median 4 kB · p90 717 kB · max 1.55 MB |
| Stored (TOAST-compressed) | mean 261 kB |
| Largest keys, mean over the users who have them | `burnLog` 281 kB (1 user) · `backgrounds` 196 kB (5 users, max 834 kB) · `holidays` 41 kB (7, max 285 kB) · `lifts` 18 kB (1) · `shopItems` 10 kB (7, max 69 kB) · `vitalsLog` 5 kB (2) |

What this changes:
- The heaviest account is **1.55 MB**, not ~967 kB, so the payoff is larger than item 25 assumed.
- `burnLog` is the single largest key on the account that has it, ahead
  of the pictures. Its WHOOP workout entries grow with every sync, which
  makes Track L (logs) at least as important as Track I (pictures) for
  that user.
- Most accounts are small (median 4 kB), so the migration's risk is
  concentrated on a few heavy, real accounts. That favours the owner-first
  canary.

Also checked 2026-10-22: the audit version of `vb_state_meaningful` is
live and `user_data_health_token_idx` exists (draft §0a). **There is no
`backgrounds` Storage bucket.** Live Storage has only `cv` and `recipes`
(CLAUDE.md's "backgrounds bucket" and an `avatars` bucket do not exist), so
background pictures exist only as data URIs in `state`, and the new
`media` bucket (I1) is their first Storage home.

### 1.2 Base64 images in `state` (item 25)

| Field | Written by | Encoding | Typical size as base64 | Rendered by |
|---|---|---|---|---|
| `backgrounds[<section>]` | `App.jsx:536-550` (pick → `BackgroundCropModal` 1600 px JPEG q.78 → `compressImageDataUrl` 1600 px q.72) | JPEG | 150–400 kB each | `App.jsx:587, 714` |
| `holidays[].imageUrl` | `Modals.jsx:37-58` `ImageField` (mobile picker, 900 px JPEG q.78); `HolidayFormTabs.jsx:72` | JPEG, or a pasted `https://` URL | 60–150 kB each | `holiday/TripRail.jsx:485`, `holiday/BoardingPass.jsx:101`, `HubSection.jsx:125` (HTML string template), `mobile/MobileWidget.jsx:1221`, `ImageField` preview |
| `shopItems[].imageUrl` | `Modals.jsx:1055, 1132` `ImageField` max 600 px; or auto-filled `https://` from shop-autofill | JPEG or URL | 30–70 kB each | `ShopSection.jsx:292`, `ImageField` preview |
| `savings[].image` | `Modals.jsx:684-711` `SavingsImagePicker` 600 px JPEG q.78 | JPEG | 30–60 kB each | Only the edit modal's preview today (no other reader found) |

Not in `state`, and not part of this plan:

- **Profile photo.** It lives in its own column, `user_data.photo`
  (`useVisionBoardState.js:28-30, 229-234`), as a base64 data URI of at
  most 512 px (`lib/image/compress.js:35-88`). **Correction to the brief:**
  item 59 moved the photo out of `state` into its own column, shrank it,
  and stopped re-sending it on every save. It did **not** move to Storage.
  `loadFromCloud` still downloads it on every full load
  (`useVisionBoardState.js:88`). Moving it to `media` with the same pattern
  is an optional follow-up (I6, §8).
- Recipe photos (`lib/diet/recipeImages.js`, bucket `recipes`) and CVs
  (`cv` bucket) are already in Storage. They are the precedent for §3.1.
- Friend avatars (`profiles.avatar_url`, 96 px data URI,
  `supabase/avatars_schema.sql`) are small and out of scope.

### 1.3 Per-day logs (item 26)

| Key | Shape | Writers | Estimated size |
|---|---|---|---|
| `vitalsLog` | `{ 'YYYY-MM-DD': { weight, sleep, rhr, hrv, recovery, strain, burnKcal, stepsWhoop, stepsOura } }` | client: `VitalsHistoryCard.jsx:690-717`, `track/VitalsEntryModal.jsx:81`, `mobile/MobileWidget.jsx:679`, `widgets/LifeWidgets.jsx:93`, `lib/whoopClient.js:29-55`, `lib/ouraClient.js:22-32`, `lib/appleHealth.js:149-165`; server: `health-sync.js:131-152`, `whoop-cron.js:79` and `oura-cron` through `mergeWhoopIntoState`/`mergeOuraIntoState` (`netlify/lib/whoop.js:275`, `oura.js:200`) | ~120 B/day with a wearable, so ~45 kB a year. An Apple Health export import can add several years of history at once. |
| `burnLog` | `{ day: [ { id, label, kcal, start?, steps? } ] }`, ids prefixed `whoop-`, `oura-`, `ah-steps-`, or `a<ms>` for manual | `MobileWidget.jsx:899-909`, whoop/oura/apple paths above, server crons | 200–300 B/day, so ~70–110 kB a year |
| `bodyLog` | `{ day: { waist?, bodyFat? } }` | `LifeWidgets.jsx:176` | small |
| `moodLog` | `{ day: { mood } }` | **none since 2026-08** (Mood widget retired; `lib/widgets/retired.js:13`, `App.jsx:305-311`). Kept on purpose, read by nothing. | small, frozen |

Other stores that grow and stay in `state` (not items 25/26, but candidates
for the same table later; see §9): `logs` and `logsAuto` (tracker cells per
day, the main ranking input), `macroHistory` (per-day copy of nutrition
percentages), `coinHistory` (an **unbounded** append-only array, written in
about a dozen places, e.g. `hooks/useCoinGrants.js:63-70`), and
`savingsHistory`.

---

## 2. How state moves today

These are the facts the design has to respect.

**Load** (`src/hooks/useVisionBoardState.js`):
- `loadFromCloud` (`:80-142`) selects `state, photo, updated_at` (the whole
  row) and returns a discriminated result (`loaded` / `no_row` /
  `empty_state` / throw). Only a genuine first `no_row` seeds defaults, and
  a seen-before breadcrumb blocks even that (`:61-78, 737-759`).
- Optimistic boot paints the slim local backup (`vb4_backup:`, built at
  `:297-312`, which drops backgrounds and savings images and is branded
  `__slim`) plus the pictures cache (`vb4_visuals:`, `:333-375`). Saves
  stay blocked until the cloud copy arrives (`:591-607`). Anything queued
  against the optimistic paint is discarded (`:645-673`).
- A pending-edit snapshot (`vb4_pending:`, `:408-441`) holds the full
  stripped state written synchronously on hide, and is merged on the next
  load (`:687-730`).
- Polling: every 60 s while visible, plus on focus. It reads `updated_at`
  first and downloads the full row only if it moved (`:832-907`, item 59).

**Save:**
- `update()` (`:1180-1215`) → 1.5 s debounce → `saveOnce` → `persist` →
  `saveToCloud`.
- `saveToCloud` (`:184-272`) writes the **whole `state` column** every
  time. With a known base it uses `UPDATE … WHERE updated_at = base`
  (compare-and-set); the first write is an upsert. On conflict, `persist`
  (`:933-997`) re-reads, runs a three-way `mergeState`, and writes the
  result.
- `mergeState` (`lib/state/merge.js`) recurses into objects, merges
  id-arrays by id, and **never deletes what the other side changed**. A
  top-level key removed on one side survives if the other side changed it
  (`:121-134`). This matters for cleanup (§4 L7).
- Anti-wipe guards: client-side `looksLikeFactoryDefault` refusal
  (`:1034-1040`), read-before-write refusal (`:206-216`), the slim guard
  (`:188-193`), and the guard predicates in `lib/state/meaningful.js` (an
  ignore-list design: any non-empty store counts).

**Server writers:**
- `health-sync.js` looks the token up with
  `state->>healthToken=eq.<token>&select=id,state,updated_at`. That
  returns the **whole state**, ~1 MB (`:117-119`), and then does
  `mergeStateCAS`.
- `whoop-cron.js:79` and `oura-cron.js` (through `syncOne`) each read the
  whole state and write it back with CAS (`netlify/lib/stateWrite.js:66-77`).
- `whoop-sync` / `oura-sync` (run on open) only **return** data. The
  client merges it (`lib/whoopClient.js`, `lib/ouraClient.js`).
- `recompute.js` reads a JSON-path projection of 11 keys, including
  `vitalsLog` and `burnLog` (`:424-429`), for ratings, the leaderboard and
  `prestige-up`.
- `push-dispatch` reads only `state->notifications`. `settle-leagues`
  never touches state. `ai-coach-daily` receives a **client-built**
  snapshot (`lib/coach/snapshot.js`) containing neither images nor
  vitals/burn (`lib/coach/wearableProvenance.js:11-15`).

**Database safety net:**
- `vb_snapshot_user_data` (`supabase/user_data_history_schema.sql`) is a
  BEFORE UPDATE trigger. It copies the old state into `user_data_history`
  when a wipe is in progress, or at most once every ~20 h. It keeps 14 per
  user and strips `backgrounds` (**but not holiday, shop or savings
  photos**). So each snapshot can still be several hundred kB.
- The audit version of `vb_state_meaningful` (`supabase/audit_schema_2026_10.sql:194-229`)
  mirrors the JS ignore list. Item 54 says it "needs audit SQL". **Whether
  it is live must be confirmed in Phase 0.** The older version in
  `user_data_history_schema.sql` ignores `vitalsLog`, `burnLog` and the
  rest.

**Service worker** (`public/sw.js`):
- Network-first HTML, cache-first only for `/assets/*`.
- `activate` **deletes every cache that is not the current version**
  (`:63-67`). That rules out Cache Storage for a media cache (§3.1).
- After an update the page reloads once per version (`src/main.jsx:59-101`).
- There is no service worker in the Capacitor shell. Native builds update
  only through the store, so **old native builds can stay in use for months**.

**Offline:** state edits survive offline through `pendingStateRef`, the
pending snapshot and the retry loop (`:1055-1111`). `nutrition_log` writes
have no offline queue (`lib/diet/quickLog.js`), which is a gap not to
repeat.

**Precedents:**
- *`nutrition_log`* (`supabase/nutrition_schema.sql`): own-row RLS on
  `auth.uid() = user_id`, FK cascade, client writes directly. Its
  `(user_id, log_date)` index arrived late (`security_hotfix_2026_09_30.sql:128-131`).
  Hub cards share a module-scope cache (`lib/diet/daySummary.js`), and
  export pages through `lib/data/accountExport.js`.
  Lessons: index from day one; readers that need synchronous access ended
  up with a copy back in state (`S.macroHistory`,
  `NutritionSection.jsx:403-429`), which shows synchronous in-memory
  access is a real requirement; and there is no offline queue.
- *`push_tokens`* (`supabase/push_tokens_schema.sql`): copied out of state
  **and stripped in the same script**, without bumping `updated_at`. That
  was acceptable for re-registrable tokens. **It is exactly what this plan
  must not do with user data.**
- *Recipe images* (`supabase/recipe_images.sql`, `lib/diet/recipeImages.js`):
  private bucket, folder-equals-uid policies, downscale before upload,
  batched `createSignedUrls`, fail soft when the bucket is missing.
  `delete-account.js:65` empties the bucket after the auth delete, because
  `storage.objects` has no FK.

---

## 3. Target design

### 3.1 Images → Storage

**Bucket.** One private bucket, `media`, with the same policy shape as
`recipes`:
- Read and insert only where `(storage.foldername(name))[1] = auth.uid()`.
- **No update and no delete policy for clients.** Paths are
  content-addressed, so nothing ever needs overwriting. A client that
  cannot delete cannot lose a picture through a bug. Orphans are swept
  later by the owner (I5).
- 8 MB per-object cap, JPEG/PNG/WebP only.

**Path:** `<uid>/<kind>/<sha256 of the decoded bytes>.<ext>`, with kind one
of `bg`, `holiday`, `shop`, `savings`. Content addressing makes uploads
idempotent: re-uploading the same picture hits a 409 "already exists",
which counts as success once a read-back confirms it.

**Reference in `state`:** the string `vbm:media/<path>`, stored in the
**same field** that held the data URI. Why a string in the same place:
- Every field keeps its type. `mergeState`, the backup, the pending
  snapshot and every pass-through spread need no changes.
- An old build sees an unknown URL. It renders a missing picture (CSS
  `url(vbm:…)` fails quietly) and passes the string through untouched when
  it saves. That is cosmetic, not lossy.
- Real `https://` URLs (pasted, or shop-autofill) are left alone.

**Client resolver** (new `lib/media/`):
- `resolveMedia(refs)` collects every `vbm:` ref in `S`, asks for signed
  URLs in **one** `createSignedUrls` call (as `recipeImages.signedUrls`
  does), fetches the bytes, and stores them in **IndexedDB** (`vb-media`)
  keyed by path. Paths are immutable, so a cache hit never expires.
- IndexedDB, not Cache Storage, because `sw.js` deletes every cache on
  activate.
- Renderers use a `useMediaUrl(value)` hook that returns an object URL (or
  the original string when it is a data URI or `https://`). The one
  string-template renderer (`HubSection.jsx:125`) reads a synchronous
  `mediaUrlNow(value)` map that the resolver fills before the hub islands
  render, and re-renders when it fills.
- The optimistic boot reads the IndexedDB entries for the current section's
  background and the visible trip cards **before first paint**, so the
  "board arrives undressed" problem that `writeVisuals` fixed
  (`useVisionBoardState.js:314-332`) does not come back.
- `vb4_visuals:` shrinks to references automatically.
- Signed URLs last 1 h, the `recipes` default. Only a cache miss ever
  needs one.
- Explicit sign-out and account deletion clear `vb-media`: add it to
  `lib/state/clearLocal.js`.
- CSP already allows `img-src blob: https:` and
  `connect-src https://*.supabase.co` (`netlify.toml:149`).

**New uploads.** Pickers keep their downscaling. They upload the blob and
store the reference. If the upload fails (bucket not set up, or offline),
they **fall back to today's data URI**, and the migrator picks it up later.
Nothing that works today can stop working.

**Migrating existing pictures runs on the server**, not in the client, for
four reasons:
- it is resumable and auditable in one place;
- it can keep a server-only copy of the original;
- it does not depend on every user opening a new build;
- it never moves the whole state.

The swap itself is a SQL function (`media_swap_ref`, service role only).
It locks the row, finds the field, and replaces it **only if** the current
value's SHA-256 equals the one the migrator uploaded. It then bumps
`updated_at`, so any open client gets a CAS conflict and merges: the base
and local copies still hold the old URI, the remote holds the reference,
and the reference wins (`merge.js` rule 2). A field the user changed in
the meantime is skipped and retried on the next run.

**Ledger (`media_ledger`, server-only).** One row per picture: kind, item
key, both hashes, size, storage path, status, and the **original data
URI**. The original stays for 90 days, beyond the backup window and PITR,
because database backups do not cover Storage. `media_restore_user` puts
originals back wherever the field still holds the reference. That is the
rollback.

**History snapshots** get smaller, because holiday photos are no longer
inside them. Later, once backgrounds are references, the trigger can stop
stripping `backgrounds`. That closes the runbook gap "backgrounds can't be
restored from here" (`docs/RESTORE_RUNBOOK.md`). It is a separate, later
change to a critical trigger (§8).

**Export:** the export embeds each referenced picture back as a data URI
(downloaded through signed URLs when the user presses Export), so the file
stays self-contained (`settings/DataExportCard.jsx`, `lib/data/accountExport.js`).

**Delete-account:** add `'media'` to `STORAGE_BUCKETS`
(`netlify/functions/delete-account.js:65`). This **must ship before the
first object is written** (I1). The ledger cascades through its FK.

### 3.2 Per-day logs → one table

**One generic table compared with one table per log:**

| | One `daily_log(user_id, kind, day, data jsonb)` | `vitals_log`, `burn_log`, `body_log` with typed columns |
|---|---|---|
| New metric (e.g. `stepsOura` arrived 2026-10) | New key, no migration. Matches CLAUDE.md's "new features = new keys". | `ALTER TABLE` each time, and migrations are approval-gated, so features would block on SQL. |
| RLS, grants, cascade, indexes, sync code, export, delete | Written and reviewed **once** | Three times, and drift is the risk item 81 exists for |
| Delta sync on open | One cursor, one query | Three |
| Server-side validation | A CHECK on shape plus function-level checks per known key | Column types and checks |
| SQL aggregates for ranking | JSON operators (fine at these sizes) | Plain columns |
| Mixed shapes (burn is a list) | Burn stored as an object keyed by entry id (below) | Natural per-entry rows |

**Recommendation: one generic table.** The flexibility is worth more than
typed columns, because the ranking maths needs only "does a day have a
weight, sleep or resting HR" and "sum of kcal". A function computes both
in a few lines (`daily_log_rating_days`).

**Schema** (full DDL in the draft SQL §2):

```
daily_log
  user_id     uuid  references auth.users(id) on delete cascade   -- item 20 rule
  kind        text  check in ('vitals','burn','body','mood')
  day         date  check between 2000-01-01 and 2100-01-01
  data        jsonb object, <= 16 kB
  src         jsonb object: key -> 'manual'|'whoop'|'oura'|'apple'|'backfill'|'absorb'
  created_at  timestamptz default now()   -- server-stamped, immutable
  updated_at  timestamptz default now()   -- bumped by trigger, only on a real change
  primary key (user_id, kind, day)        -- range reads by kind and day
  index (user_id, updated_at)             -- delta sync
```

- **`vitals` / `body` / `mood`:** `data` is the day object exactly as in
  state.
- **`burn`:** `data` is `{ <entry id>: { label, kcal, start?, steps?, ord } }`.
  Keying by id is what lets two writers change one day without clobbering
  each other: the WHOOP cron replaces only `whoop-*` keys, and the user
  adds an `a<ms>` key. `ord` keeps the list order. The view sorts by
  `ord`, then id, and strips `ord`. Missing or duplicate ids (none expected)
  become `legacy-<n>` or `<id>#<n>` and are reported by the backfill.
- **`src` is per key and server-stamped.** It records where each value came
  from, which state cannot know today (`lib/coach/wearableProvenance.js:17-20`).
  The view ignores it. Ranking and the coach guard can use it later.
- **No `deleted_at`.** Removing a value means removing its key. A day whose
  object becomes `{}` stays as an empty row, a tombstone that the delta
  sync carries to other devices. Only an account deletion (the cascade)
  removes rows.

**Writes: two functions, no table grants for clients.**
- `daily_log_apply(p_ops)`: `SECURITY DEFINER`, `search_path ''`,
  `auth.uid()`. Granted to `authenticated` only.
  - `p_ops` is a batch of up to 400 `{ kind, day, set:{…}, unset:[…] }`.
    The Apple Health importer touches thousands of days in one go, so this
    means a handful of calls.
  - Each op becomes `data = (data − unset) || set` and
    `src[k] = 'manual'` for each set key, inside one
    `INSERT … ON CONFLICT DO UPDATE`. That is atomic per row, and
    concurrent writers to different keys never collide.
  - Validation per op: kind is one of vitals, burn or body (`mood` is
    read-only now); day is a valid ISO date, no later than today + 2; at
    most 40 keys and 8 kB per op; known metrics are numbers within ranges
    **wider** than the UI's (`lib/vitals/metrics.js`,
    `VitalsHistoryCard.jsx` `EDIT_LIMITS`); unknown keys are allowed
    (future metrics) but must be names with small scalar values; burn
    entries need a numeric `kcal`.
  - Invalid ops are skipped and reported per op, never half-applied.
  - **Server-side bulk-removal brake:** more than 200 unset keys or more
    than 31 days with removals in one call → refused.
- `daily_log_apply_service(p_user, p_source, p_ops)`: service role only.
  Same core, plus `unset_prefix` (e.g. `'whoop-'`) so a cron can replace
  its own burn entries in the same statement, the way `mergeWhoopIntoState`
  does in memory.
- Table grants: `revoke all from anon, authenticated` (Supabase grants
  everything on new public tables by default), then `grant select to
  authenticated`, with the select policy `(select auth.uid()) = user_id`.
  **No insert, update or delete policy and no grant.** A client therefore
  cannot set `src` or `created_at`, cannot write another user's rows, and
  cannot delete. This is the property item 44 needs (§3.6).

**Journal (`daily_log_history`).** An AFTER UPDATE trigger copies the old
row whenever any existing key's value changes or disappears. Purely
additive writes are not journaled. Retention is 90 days. Restoring a day
or a key is a one-row update (runbook addition, §7).

**No-op writes do not move `updated_at`.** A BEFORE UPDATE trigger returns
NULL when `data` and `src` are unchanged. A cron re-sending the same three
days costs nothing and creates no delta traffic.

### 3.3 The client: `S` keeps its shape

The safest change is the one readers never see. A new module,
`lib/logs/store.js`, does six things:

1. **Hydrates** `S.vitalsLog`, `S.burnLog`, `S.bodyLog` and `S.moodLog`
   from table rows, rebuilding the exact state shapes (burn object → array).
   These keys become **transient** in memory once cleanup has happened for
   the user (see 5), the same way `TRANSIENT_KEYS` are today
   (`useVisionBoardState.js:9-31`).
2. **Caches** rows per user in localStorage (`vb4_logs:<uid>`, a few
   hundred kB after shrink, so smaller than today's backup) with a cursor:
   the newest `updated_at` seen. Boot paints from the cache and then
   fetches the delta,
   `daily_log?user_id=eq.X&updated_at=gte.<cursor − 10 min>`. The 10-minute
   overlap covers transactions that committed late. Re-applying rows is
   idempotent. The first boot on a new device pages through full history
   (`lib/data/paginate.js`, 1000 rows a page; ~3 years is about 3 pages).
   A weekly full-row-count check triggers a full resync on mismatch.
   **The cache is never the basis of a removal** (see 4).
3. **Polls the delta** on the existing 60 s visible-tab poll. The query
   uses the index and normally returns zero rows. Once the crons stop
   touching state (after cleanup), new WHOOP data no longer moves
   `user_data.updated_at`, so this poll is what makes it appear.
   **Realtime is not needed.**
4. **Diffs and patches.** After each `update()`, on the same 1.5 s
   debounce, `diffLogs(base, S)` compares the server view (base) with the
   in-memory logs and emits `set` and `unset` ops. Rules:
   - `set` ops are always allowed.
   - `unset` ops only for keys present in the **server-confirmed base**,
     and only once logs are hydrated. A missing cache or an empty view can
     never produce a removal.
   - **Client brake:** more than 31 days or 200 keys removed in one diff is
     refused and reported (`reportError('log-mass-unset')`). No UI removes
     that much today.
   - Ops go to an **outbox** (`vb4_logq:<uid>`) written synchronously
     before sending, retried with the same 5 s / 15 s / 60 s backoff as
     saves, and shown in `SaveStatusPill`. The outbox is flushed by
     `flushNow` before an explicit sign-out and cleared with the other
     per-user keys (`clearLocal.js` `USER_PREFIXES`).
   - Ops are idempotent, so replaying them is safe. This closes the
     "no offline queue" gap `nutrition_log` has.
5. **Follows the marker.** When the loaded state carries
   `logsInTables` (written by cleanup, §4 L7), `stripForSave` drops the
   log keys from the save payload. Without the marker it keeps sending
   them (dual-write). The behaviour is therefore per user, set by the
   server, and needs no client flag at cleanup time.
6. **Forward-fills.**
   - Before cleanup (dual-write): if `state.vitalsLog` holds a key the
     table lacks or disagrees with, **the state value wins**. While
     everyone dual-writes, a lasting difference can only mean an old build
     wrote state alone, or a table patch failed.
   - After cleanup: if a log key reappears in `state` (an old build, or a
     restored backup), the view shows the union with **the table winning**
     on conflicts, and the server's absorb function moves it back (§4 L7).

`hydrated` (`useVisionBoardState.js:490-503`) waits for the log hydration
as well as the state, so OVR and other figures never show a "logs not yet
loaded" value. `useAutomations` already waits on `hydrated`
(`App.jsx:177-180`). `autoLog` never deletes or retracts
(`lib/trackers/autoLog.js:17-25`), and visions only stamp when they pass,
so a late hydration cannot undo anything.

**On-open wearable syncs.** From L2, `whoop-sync` and `oura-sync` also
write the table themselves (`src` `whoop` or `oura`), and still return the
data. The client applies the returned values to **both `S` and the diff
base**, so the diff does not re-send them and relabel them `manual`.
`whoopClient`'s change check compares with `JSON.stringify`, which is
sensitive to key order, so it switches to `sameValue`. Otherwise a rebuilt
burn entry would look changed and cause extra writes.

### 3.4 Server writers on the new path

| Writer | Today | After L2 (dual-write) | After cleanup for that user |
|---|---|---|---|
| `whoop-cron`, `oura-cron` | Read the whole state, merge, CAS-write the whole state | The same **plus** `daily_log_apply_service(user, 'whoop'\|'oura', ops)`: vitals `set` per day, burn `unset_prefix 'whoop-'` + `set` | Only the RPC (~2 kB). First a tiny projection read, `select=m:state->logsInTables`, to choose the path. **The whole-state CAS for crons is gone.** |
| `health-sync` | Token lookup returns the **whole state**; CAS write | Same plus RPC (`src 'apple'`) | Lookup `select=id,tok:state->>healthToken,m:state->logsInTables` (index `user_data_health_token_idx`, audit SQL) + RPC. No state transfer. |
| `whoop-sync`, `oura-sync` | Return data, the client merges | Also write the table (service RPC) | Same |
| Apple Health importer (client) | `update()` into state | The diff layer turns it into batched RPC ops | Same |

The builders for the ops (`whoopOps(vitals, burn)`, `ouraOps`) live next
to `mergeWhoopIntoState` and `mergeOuraIntoState`. A unit test asserts
that applying the ops to a view equals running the existing merge on a
state (§7).

**Write-order rule for every dual-writer (client and server): state
first, then the table, and only after the state write succeeded.** If the
state CAS conflicts and the run skips the user, the table write is skipped
too. This keeps the table from ever being newer than state while both are
written, which is what makes "state wins" safe in the backfill and the
forward-fill.

Testing the draft SQL showed why this matters. A cron that wrote the table
but lost its state CAS would leave `whoop-9` in the table and `whoop-1` in
state. A state-wins reconcile would then put `whoop-1` back next to
`whoop-9`, double-counting that day's burn until the next cron run.

### 3.5 Readers and query patterns

- **Client readers (about 30 files, Appendix A):** unchanged. They read
  `S.*` as today.
- **Hub widgets** (`MobileWidget`, `LifeWidgets`, `GoalsWidget`,
  `lib/hub/primeData.js`) and **desktop islands** (`HubSection.jsx`):
  unchanged. They get their data from the single log store, so there is
  no per-widget fetch (the problem `lib/diet/daySummary.js` had to solve
  for nutrition).
- **Track calendar** (`TrackSection.jsx`, reading `S.logs`) is not
  affected. `VitalsPanel` and `VitalsHistoryCard` read `S.vitalsLog` as
  today.
- **Range reads**, where something needs a window without full history:
  `kind=eq.vitals&day=gte.X&day=lte.Y`, served by the primary key. JSON
  projection where only one metric is needed, e.g.
  `select=day,w:data->weight`.
- **Server ranking:** `daily_log_rating_days(p_user)` returns one small row
  per day instead of moving the logs: kind, day, whether it has a core
  vital, the sources of those core vitals (per key), total burn kcal, the
  kcal from server-sourced entries, and created_at.

### 3.6 Ranking, leaderboard and anti-forgery (items 44/26)

- **L5-server flag `ratings_from_table`.** `loadRatingInputs`
  (`netlify/lib/recompute.js:457-499`) builds `vitalsLog`/`burnLog` maps
  from `daily_log_rating_days`, unioned with the projected state keys until
  that user is cleaned up, and drops the two keys from `RATING_STATE_KEYS`
  after cleanup. `deriveRatings` and the client's `derive.js` do not
  change, so `scripts/check-ratings-parity.mjs` keeps them identical.
- **Before switching**, a parity run computes both ways for every user and
  logs the differences. The flag flips only when the differences are zero
  or explained.
- **The durable anti-forgery fix this enables** (an owner decision, a
  separate PR after L5, and a ranking-rule change for `docs/RANKING_SYSTEM.md`):
  - The server can now trust two facts the client cannot forge: **when a
    row was written** (`created_at`) and **which writer wrote each value**
    (`src`).
  - Values sourced from WHOOP or Oura count as written by the server.
  - A `manual` day counts only if its row was created within ~2 days of
    the day it describes. Retro-typing a year in one sitting would earn
    nothing.
  - Values marked `backfill` are grandfathered: they count exactly as
    today, capped by account age as today.
  - `apple` (a token-authenticated Shortcut, but self-reported numbers)
    is the owner's call. Treat it like `manual` or like a wearable.
  - This replaces "trust the client-written state, capped by account age"
    (item 44's current status) with "trust what the server can attest".

### 3.7 Export, deletion, history and restore

- **Export.** `accountExport.js` adds `daily_log` (paged, ordered by kind
  and day) and the `media` pictures (embedded). `data: S` still includes
  the hydrated view. The export waits for log hydration, and lists
  `daily_log` under `missing` if it cannot read it. Update `INCLUDED` in
  `DataExportCard.jsx`.
- **Delete-account.** `daily_log`, `daily_log_history`, `media_ledger`,
  `state_archive` and the run tables all declare
  `references auth.users(id) on delete cascade`. Storage `media` objects
  are added to `STORAGE_BUCKETS`.
- **Restore runbook additions** (`docs/RESTORE_RUNBOOK.md`):
  - restore a day or key from `daily_log_history`;
  - undo a picture swap from `media_ledger` (`media_restore_user`);
  - put back an archived state key from `state_archive`.
  - `user_data_history` no longer contains logs after cleanup. The journal
    and archive tables cover them.
- **DPIA** (`docs/DPIA_DRAFT.md`): the new tables hold health data. Add
  them with their retention: journal 90 days, ledger originals 90 days,
  archive until the owner approves a purge.

### 3.8 Anti-wipe guard changes

- **The marker counts as evidence with no code change.** `logsInTables` is
  a non-empty object and not on `MEANINGFUL_IGNORE`, so both the JS
  predicate and the audit SQL predicate count it. A WHOOP-only user's
  cleaned state, which has almost nothing else, still reads as meaningful.
  So the read-before-write refusal (`useVisionBoardState.js:206-216`) and
  the history trigger keep protecting it. New tests pin this
  (`meaningful.test.mjs`), and the SQL mirror is checked with the
  verification queries.
- **Precondition:** the audit version of `vb_state_meaningful` must be
  live (Phase 0). The old version would not count the marker.
- **No guard is needed for "empty tables".** No table write path can
  remove rows. Removals are key-level, made only from a confirmed base,
  braked on both sides, and journaled.
- **Picture references are non-empty strings in the same places**, so they
  change nothing for the guard.

### 3.9 Offline, caching and the service worker

- **Offline:** state edits work as today. Log edits go to the outbox. The
  view works from the local log cache. Pictures come from IndexedDB.
- **Service worker:** no `sw.js` change is needed. Supabase calls are
  cross-origin and pass straight through (`sw.js:96-97`). Media
  deliberately stays out of Cache Storage. Bump `CACHE_VERSION` on every
  client phase (R8).
- **Native:** IndexedDB and localStorage work in the WebView. The
  "update-required" gate (P0) is what stands in for the service worker's
  forced reload.

---

## 4. Migration phases

Two tracks, images (I) and logs (L), after a shared Phase 0. Each phase is
its own PR and its own deploy. A phase starts only after the previous one
has been verified.

**Flags.** A new table, `app_config` (global flags; readable by signed-in
users, writable only by the owner in SQL), plus `app_config_users`
(per-user overrides, own-row read, so canary ids are not visible to
others). The client reads them once at boot, caches them for 10 minutes,
and treats them as **off** if it cannot read them. Functions cache them at
module scope for 5 minutes. No flag needs a redeploy, which also helps
with item 89's build-credit budget.

**Owner first.** Every flag goes on for the owner's account (per-user
override) for at least a week before it goes on globally.

### Phase 0: prerequisites (no data moves)

**Ships:**
1. Build stamping. Vite defines a monotonic `__BUILD__` (build time) for
   web and native.
2. `note_client_build(platform, build)`: one tiny upsert per boot into
   `client_builds`. This is the census that answers "is anyone still on an
   old build?".
3. An **update-required gate**. If `app_config.min_build` is above this
   build, the app stops **before load** (never mid-session) and asks for a
   refresh or store update. On the web a refresh fixes it; on native it
   links to the store.
4. `app_config` / `app_config_users` with all flags off.

The gate must ship **now**, because a gate only binds builds that contain it.

*Status 2026-10-22: built.*
- The SQL is `supabase/state_size_phase0_2026_10.sql`. It is draft §0 with
  three changes:
  - `client_builds` is keyed by build as well, so a second device on an old
    build stays visible;
  - signed-out visitors may read the `min_build` row only, because the gate
    reads it while the session is still being restored;
  - `ops_mark` start and done.

  It was dry-run on Postgres 16 with `scripts/statesize/test-phase0-sql.sh`
  (grants, what each role reads, census guards, cascades, re-run).
- Client:
  - `src/lib/buildGate.js` makes the decisions. It is pure, and
    `check:buildgate` tests it, including that Board never mounts behind the
    gate.
  - `src/lib/buildGateClient.js` does the reads: a 2.5 s cap, then the gate
    opens. The census is written once per user, platform and build, 5 s
    after boot.
  - The UI is in `src/components/buildgate/`, and `App.jsx` wraps the web
    gate in `BuildGateBoundary`.
- The gate fails open. A minimum from the future is ignored, and a running
  app is never stopped.

**Owner runs and decides:**
- ~~Confirm `supabase/audit_schema_2026_10.sql` is applied~~ — done
  2026-10-22 (§1.1).
- ~~Run the size measurement and record the per-key numbers here~~ — done
  2026-10-22 (§1.1).
- ~~Run `supabase/state_size_phase0_2026_10.sql`~~ — applied and verified
  2026-10-22.
- Run the **restore drill** (item 82) as `docs/RESTORE_RUNBOOK.md` describes.
- **Decide on PITR** (item 27; recommendation in §7).
- ~~Confirm whether the "backgrounds bucket" exists~~ — it does not
  (2026-10-22, §1.1).

**Rollback:** flags off; the gate's `min_build` stays at 0.

### Track I: images

| Phase | What ships | What is written where | Who reads what | Old build (pre-I2) | Verified by | Rollback |
|---|---|---|---|---|---|---|
| **I1 Expand** | SQL: `media` bucket + policies, `media_ledger`, `media_swap_ref`, `media_restore_user`. Code: `'media'` in `delete-account.js` `STORAGE_BUCKETS` (coordinate with whoever is editing `netlify/`). | Nothing yet | Nothing | Unaffected | Advisors clean. Policies tested with two test accounts (A cannot read or list B). | Drop the empty bucket and table |
| **I2 Read support** | Client: `lib/media` resolver, IndexedDB cache, `useMediaUrl` in every renderer from §1.2, export embedding, `clearLocal` addition. **CACHE_VERSION bump.** | Nothing new | New build renders both data URIs and `vbm:` refs | Unaffected (no refs exist yet) | Playwright: refs and URIs render; offline boot from cache; the hub template path. | Revert the build. No data changed. |
| **I3 New uploads** (flag `media_uploads`) | Pickers upload, then store the ref; any failure falls back to a data URI. CACHE_VERSION bump. | New pictures go to Storage, refs go to state | New builds resolve refs | **Sees a broken picture for new uploads** made on new builds. Its saves pass the ref through. That is cosmetic, which is why I3 waits until the census shows ≥ 99% of 14-day-active users on ≥ I2, and `min_build` is raised to I2. | Census; telemetry for upload failures | Flag off. Existing refs keep rendering (I2 stays). |
| **I4 Migrate existing** (flag `media_migrate`) | Function `media-migrate` (service role). It runs (a) per user for themselves on open (JWT, rate-limited) and (b) as an owner-triggered batch with `requireScheduler`, a 20 s deadline and resume-from-ledger. | Per picture: decode → sha256 → upload (no upsert; 409 counts as present) → read back and compare size and hash → ledger row with original, status `verified` → `media_swap_ref` (hash-guarded, bumps `updated_at`) → status `swapped`. Non-JPEG/PNG/WebP and SVG data URIs are left alone and reported. | All new builds | Same as I3. An old build that loaded before the swap gets a CAS conflict, and the merge takes the ref. One editing that very picture keeps its own new URI (merge rule 5, local wins), and the next sweep migrates it. | Per user: count of data URIs in state is 0 or "reported"; ledger `swapped` = refs in state; spot-check pictures; state bytes before and after (projection). | `media_restore_user(uid)` per user (ledger originals, 90 days); flag off. |
| **I5 Cleanup** (much later, owner-approved) | Owner-run SQL: purge ledger originals older than 90 days (`original = null`, `purged_at`). Report-only orphan listing (objects no longer referenced by state **or** by any `user_data_history` snapshot); deletion only after review. Optionally stop stripping `backgrounds` in `vb_snapshot_user_data`. | | | | | Before purge: restore from ledger. After: from the Storage objects, which are never deleted while referenced. |

### Track L: per-day logs

**Old-build matrix.** "Old build" means a build without the log store
(before L3). "Mid build" means one with shadow-write but not table reads
(L3–L4).

| Phase | New build writes | New build reads | Servers write | Old build reads | Old build writes go… | Can anything be lost? |
|---|---|---|---|---|---|---|
| L1 | state | state | state | state (complete) | state | No: nothing changed |
| L2 | state | state | state **+ table** | state (complete) | state | No: state remains the source |
| L3 | state + table (shadow) | state | state + table | state (complete) | state; the backfill/reconciler copies them to the table | No: state remains the source |
| L4 | as L3 | state | as L3 | state | as L3 | No: backfill only adds to the table (state wins key by key, table-only keys kept) |
| L5 | state + table | **table** (+ state forward-fill, state wins) | state + table | state (**still complete**, because everyone dual-writes) | state; forward-filled by new clients and the reconciler | No. A value or burn entry that an *old* build deletes may reappear, because removals only travel as explicit ops, which old builds never send. This is the merge rule's deliberate "resurrect rather than lose" (`merge.js:31-38`). Its size is visible in verify's `extra_in_table` count. |
| L6 | as L5 | as L5 | as L5 | as L5 | as L5 | No. This phase is only waiting. |
| L7 (per user) | **table only** (marker strips the keys) | table | table only | state without logs → **empty vitals and burn display** (cosmetic; the server-side OVR is unaffected) | Regrown key in state → shown as a union (table wins) → absorbed by the server | Only one narrow case: an old build's *edit to an existing value* made after cleanup is set-if-absent, so the table value stays. New days from an old build are kept. Bounded by `min_build` (L6). |

| Phase | What ships | Verified by | Rollback |
|---|---|---|---|
| **L1 Expand** | SQL: `daily_log`, triggers, `daily_log_history`, validation helpers, `daily_log_apply` / `_service`, `daily_log_rating_days`, `daily_log_backfill_runs`, backfill and verify functions (draft §2–§3). No code reads or writes the table. | Advisors; RLS tests (A cannot read B; `authenticated` cannot insert, update or delete directly; `anon` nothing); RPC validation tests on a scratch project | Drop the empty objects |
| **L2 Server shadow-write** (flag `logs_server_shadow`) | `whoop-cron`, `oura-cron`, `health-sync`, `whoop-sync`, `oura-sync` also call the service RPC, **only after their state CAS returned `written`** (write-order rule, §3.4). The state CAS path is unchanged, and an RPC failure is logged and never fails the run. | Row counts grow for connected users; the RPC error rate in function logs is 0 | Flag off; the rows are harmless |
| **L3 Client shadow-write** (flag `logs_client_shadow`) | `lib/logs/store.js` diff + outbox + RPC **after** each successful state save. It never blocks a save. A **shadow compare** on load (table view vs `state` view; counts and hashes only, no values) goes to `client_errors` as `log-shadow-diff`. CACHE_VERSION bump. | Shadow diffs trend to zero for users who have been backfilled | Flag off |
| **L4 Backfill + verify** | The owner runs `daily_log_backfill_user` for everyone in batches (draft §3). It is idempotent: it locks the `user_data` row so it serialises with CAS writers, copies with state winning per key, never removes table keys, and reports invalid keys. `daily_log_verify_user` gives per-user, per-kind counts: days in state, rows present, days missing, values that differ, invalid keys. A **nightly reconciler** re-runs the backfill for users whose `user_data.updated_at` moved since their last run, which catches old-build writes, until L7. | **Gate to L5:** every user shows 0 missing and 0 differing for 14 consecutive days, and invalid keys are reviewed. Restore drill done first (§7). | Nothing to undo: the table only gained rows. Truncating is possible but unnecessary. |
| **L5 Switch reads** (flags `logs_read_from_table` for the client, `ratings_from_table` for the server) | Client: view from table rows + forward-fill (state wins). Keeps dual-writing state. The marker-following `stripForSave` logic is **included but dormant** (no marker exists yet). Export adds `daily_log`. Server: recompute from `daily_log_rating_days`, after the parity run. CACHE_VERSION bump. **The first native store binary should be cut from this build or later.** | Playwright with heavy data; parity report; shadow-diff telemetry stays at 0; owner account for a week first | Flag off: the client reads state again, which is complete because of dual-write |
| **L6 Wait** | No code. Raise `min_build` to the L5 build once the census shows nobody active on older builds for 14 days. Owner approval recorded. | Census | n/a |
| **L7 Cleanup per user** (owner-run SQL, batches; draft §4, **commented out** until approved) | `daily_log_cleanup_user(uid)`, in one transaction: lock the row → re-run verify → **refuse** on any missing or differing value (and on invalid keys unless the owner opts in) → copy each log key whole into `state_archive` → `state − 'vitalsLog' − 'burnLog' − 'bodyLog' − 'moodLog'` plus the `logsInTables` marker → bump `updated_at`. `daily_log_absorb_user(uid)` handles a regrown key: archive, set-if-absent into the table (table wins), remove from state. The reconciler switches from backfill to absorb for users with the marker. Crons drop the state CAS for users with the marker. | Per batch: verify before and after; state bytes before and after; cleaned users' clients stop sending log keys (payload size drop in the save path's telemetry); spot-check in the app | `state_archive` → put the key back (runbook SQL). The table rows remain, and clients without a marker dual-write again. |

**Why the cleanup is server-side SQL and not the client.** A client
removing keys on load is the "new build resets state on load" pattern this
plan must avoid. The server version locks, verifies, archives and removes
in one transaction. It moves no data over the wire (`state − key` runs
inside Postgres). It bumps `updated_at` so any open client merges instead
of overwriting.

The merge behaviour is safe here:
- a client whose copy of `vitalsLog` is **unchanged** since its base lets
  the removal stand;
- one that **changed** it keeps its copy (`merge.js:121-134`), which is
  then absorbed.

The history trigger also takes a snapshot on that update if the last one
is over 20 h old.

---

## 5. Expected result

Figures are estimates from §1 and are re-checked in Phase 0. Wire sizes
are after the API's gzip: base64 JPEG barely compresses, while JSON logs
compress roughly 5–10×. So pictures dominate wire bytes even more than the
raw sizes suggest.

| Per user | Today | After images (I4) | After logs (L7) |
|---|---|---|---|
| `state` size | ~967 kB | ~430 kB | **~90 kB** (range 60–150 kB) |
| Full load on open (`state` + `photo`) | ~1.0 MB | ~0.48 MB | ~0.14 MB + log delta (typically < 5 kB) |
| Returning-device pictures | inside `state` (~539 kB, every load) | 0 (IndexedDB hit) | 0 |
| New device, first open | ~1.0 MB | ~0.48 MB + pictures once (~0.54 MB) | ~0.14 MB + log history once (~0.3 MB raw, much less gzipped) + pictures once |
| Each debounced save (upload) | ~967 kB | ~430 kB | ~90 kB; a log edit is a ~0.2–1 kB RPC |
| Poll when something changed | ~1 MB | ~0.48 MB | ~0.14 MB |
| `whoop-cron` / `oura-cron`, per user per run | read + write ~2 MB | ~0.9 MB | **~2 kB RPC** |
| `health-sync`, per call | ~1 MB lookup + ~1 MB write | ~0.9 MB | indexed lookup (bytes) + ~1 kB RPC |
| `user_data_history` (14 snapshots) | up to several MB (holiday photos included) | roughly halved | ~1.3 MB |
| localStorage backup + pending snapshot | ~1 MB+ (quota risk on hide) | ~0.45 MB | ~0.1 MB + log cache |
| `daily_log` growth | n/a | n/a | ~0.2 MB a year per active wearable user, including the index |

**DB load (items 88/91).** Today every save makes Postgres parse,
TOAST-compress and WAL-log about 1 MB, and run `vb_state_meaningful` over
the old and new values (2 MB processed). Every cron and health-sync call
does the same twice. After L7 a save is about a tenth of that, and the
background writers become row upserts of a few hundred bytes. That is what
item 88 named as the condition for Micro being comfortable. Recommend
re-measuring after L7 and only then deciding whether to drop from Small to
Micro.

---

## 6. Draft SQL

All in `supabase/state_size_DRAFT_not_run.sql`, headed **DRAFT, do not
run**. It follows the PR template's SQL rules: additive, re-runnable, RLS
plus cascade plus explicit grants, `security definer` with
`set search_path = ''`, and `revoke execute … from public, anon`.

| § | Phase | Contents |
|---|---|---|
| 0 | P0 | Read-only preflight (audit SQL live? aggregate size measurement); `app_config`, `app_config_users`, `client_builds`, `note_client_build` |
| 1 | I1 | `media` bucket + policies; `media_ledger`; `media_state_path`, `media_swap_ref`, `media_restore_user` |
| 2 | L1 | `daily_log` (+ indexes, RLS, grants, touch/journal triggers), `daily_log_history`, `vb_is_date`, `daily_log_burn_obj`, `daily_log_valid_value`, `daily_log_strip`, `daily_log_apply_core` / `daily_log_apply` / `daily_log_apply_service`, `daily_log_rating_days` |
| 3 | L4 | `daily_log_backfill_runs`, `daily_log_backfill_user`, `daily_log_verify_user`, batch and report queries |
| 4 | L7 | `state_archive`, `daily_log_cleanup_user`, `daily_log_absorb_user`. **Entirely inside a block comment.** Not to be created until the owner approves L7. |
| 5 | all | Verification queries (privileges, policies, per-user verify, sizes) |

**What has been checked, and what has not.** The draft has **never been
run against the Supabase project**. On 2026-10-20 it was checked on a
throwaway local PostgreSQL 16 with stub `auth` and `storage` schemas,
Supabase-style default grants and synthetic data only. The database was
deleted afterwards.

What passed:
- §0–§3 apply cleanly and re-run idempotently, and §4 creates when
  uncommented.
- The backfill copies vitals, body, mood and burn. Duplicate and missing
  burn ids become `#n` and `legacy-n`. Invalid day keys
  (`2026-02-30`, `junk`) are counted and left in place.
- A second backfill writes 0 rows, and `updated_at` does not move.
- An old-build state edit shows up in verify and is healed by the next
  backfill, and the overwrite is journaled.
- Client writes:
  - set and unset work, and `src` becomes `manual`;
  - out-of-range values, `mood` writes, future days, a prefix removal
    from a client and an empty op are each refused per op;
  - direct `INSERT`/`UPDATE`/`DELETE` are denied;
  - a 41-day bulk removal is refused;
  - a user cannot see another user's rows;
  - a client removal is journaled and visible to its owner.
- The service write replaces only `whoop-*` burn entries.
- The picture swap is hash-guarded. A re-run returns `already`, and
  `media_restore_user` puts the original back.
- Cleanup refuses on mismatches and on invalid keys (unless allowed),
  archives every key, and leaves a state that `vb_state_meaningful` still
  calls meaningful.
- Absorb keeps the table's value and adds new days.
- Deleting the auth user cascades every new table.
- Only `daily_log_apply` and `note_client_build` are executable by
  `authenticated`.

The test scripts are in the session scratchpad (`sqlcheck/`), not the repo.

**Still required before any phase:** a run against a real Supabase scratch
project or branch (real `storage` schema, real `auth.uid()`, Advisors), as
§7 describes.

---

## 7. Test plan

**Unit tests** (node `*.test.mjs`, added to `npm run build` like
`check:merge` and `check:wipeguard`):
- `lib/logs/view`: rows ↔ state shapes, round trip including burn `ord`,
  duplicate and legacy ids, empty tombstone rows.
- `lib/logs/diff`:
  - sets and unsets per kind;
  - **no unset without a hydrated, server-confirmed base**;
  - the client brake at 31 days and 200 keys;
  - Apple Health import of 1,000+ days → batches of ≤ 400;
  - idempotent replay of the outbox.
- Forward-fill: before the marker (state wins), after the marker (table
  wins, set-if-absent).
- `whoopOps` / `ouraOps` / health-sync ops: applying them to a view equals
  `mergeWhoopIntoState` / `mergeOuraIntoState` / health-sync `merge` on a
  state, using shared fixtures.
- `meaningful.test.mjs`: a state that is only `{ logsInTables: {...} }`
  plus seeds is meaningful. Picture refs keep every store meaningful.
- `merge.test.mjs`:
  - a server swap of a data URI for a ref merges to the ref;
  - a local new pick wins over a concurrent swap;
  - a cleanup removal is kept when local is unchanged and the local copy
    is kept when local changed.
- `media`: ref parsing, field discovery (which values are data URIs,
  skipping `https://` and SVG), resolver batching.
- `check-ratings-parity.mjs` with a `daily_log` fixture:
  `daily_log_rating_days` → maps → `deriveRatings` equals today's result
  from state.
- A **property test**: random edit sequences applied through the state
  path and through the table path give identical views.

**Playwright harness** (CLAUDE.md rule: temporary `harness.html` +
`src/harness-main.jsx`, `npx vite --port 5199`, Playwright from
`/opt/node22/lib/node_modules/playwright`, files deleted before commit).
Use **realistic heavy synthetic data** and no personal data: 3 years of
WHOOP + Apple vitals, 2–3 burn entries a day, an Apple Health import of
1,000 days, 4 holidays with 900 px photos, 3 backgrounds at 1600 px, 20
shop items with pictures, savings images. Assert:
- `state` bytes and request bytes on load before and after;
- first paint with the media cache cold and warm (no "undressed board"
  regression);
- offline boot;
- phone width (no overflow) for every renderer that changed.

Also intercept every `PATCH`/`POST` body and assert **no save ever drops a
log key or picture field that was present**, except a cleanup marker
state. Old-build simulations:
- serve the pre-change bundle against migrated data (refs, a cleaned
  state): no crash, no write of empties;
- keep a "stale tab" open across a server swap and a cleanup: it merges,
  and absorb recovers its edits.

**Staging run on a copied account.** A scratch Supabase project (or a
branch) with the current schema, the audit SQL and the draft SQL. Load:
(a) synthetic heavy accounts and (b) a copy of the **owner's own** state
(the owner's data, with the owner's consent, deleted afterwards and never
committed). Run every phase end to end, including each rollback, the
backfill twice (idempotence), a backfill racing a CAS write, and
`media_restore_user` and the `state_archive` restore.

**Restore drills (item 82).**
- Before I4 and again before L4: the existing `user_data_history` drill.
- New drills added to the runbook:
  - restore one picture from `media_ledger`;
  - restore one day from `daily_log_history`;
  - restore one archived key from `state_archive`.
- Time each drill and record it in the runbook's table.

**PITR (item 27), recommendation:**
- **Enable PITR before I4 and keep it at least until 30 days after the
  last L7 batch**, then decide deliberately whether to keep it.
- This is the one stretch where a bug would touch every user's row.
  Daily backups would lose up to a day for everyone, and a
  whole-database restore takes every user back in time
  (`RESTORE_RUNBOOK.md`).
- Check the current price and compute requirement before enabling. As far
  as known it is a paid add-on that needs at least Small compute, which
  the project already runs (item 88).
- Whatever is decided, take an on-demand backup immediately before each
  I4 batch, L4 batch and L7 batch.
- Storage is not covered by database PITR, which is why the ledger keeps
  originals for 90 days.

**Canary:** each flag goes on for the owner's account for a week before
it goes on globally.

---

## 8. Effort and order

Rough sizes for one developer. Each row is one PR and one deploy, merged
on its own.

| Order | Phase | Size | Owner must… |
|---|---|---|---|
| 1 | **P0** build stamp, census, update gate, `app_config` | S (1 day) | Run the P0 SQL; confirm the audit SQL is live; run the size measurement; restore drill; decide PITR |
| 2 | **I1** bucket, ledger, swap/restore functions, delete-account bucket | S (0.5 day) | Run the I1 SQL; check Advisors |
| 3 | **I2** resolver, IndexedDB cache, renderers, export | M (2–3 days) | — |
| 4 | **I3** uploads to Storage | S–M (1 day) | Turn the flag on (owner first) once the census allows |
| 5 | **I4** migration function + batch | M (2–3 days) | Enable PITR or take a backup; run batches; check reports |
| 6 | **L1** `daily_log` SQL | M (1 day, mostly review) | Run the L1 SQL; check Advisors |
| 7 | **L2** server shadow-write | S–M (1 day) | Flag on |
| 8 | **L3** client log store: diff, outbox, shadow compare | L (3–4 days) | Flag on (owner first) |
| 9 | **L4** backfill + verify + reconciler | M (1–2 days) | Backup; restore drill; run batches; schedule the reconciler |
| 10 | **L5** read switch + recompute switch + parity | M–L (2–3 days) | Review the parity report; flags on; **cut the first native binary from this build or later** |
| 11 | **L6** wait | 2–4 weeks of calendar time | Approve; raise `min_build` |
| 12 | **L7** cleanup functions + crons drop the state path for marked users | S code (1 day) | Approve and run the L7 SQL; run batches |
| 13 | **I5** ledger purge, orphan report, snapshot-trigger tweak | S | Approve the purge (≥ 90 days after I4) |
| opt. | **I6** profile photo column → `media` | S–M | — |
| later | `logs` / `logsAuto` as `kind='tracker'` (the main ranking input), `macroHistory`, `coinHistory` | M each | Decide |

**Total:** about 3–4 weeks of work over 2–3 months of calendar time. The
waiting is deliberate.

**What to do first:** P0, then I1–I4. The images are the biggest single
win (about 55% of the state), the change does not alter meaning, every
step is reversible from the ledger, and none of it depends on the log
work. The log track can start (L1–L2) while I4 batches run.

---

## 9. Risks and open questions for the owner

### Owner decisions — 2026-10-20
- **PITR: yes**, for the migration window — enabled before the image migration (Phase "images",
  existing pictures swapped) and kept until 30 days after the last per-user cleanup; recommended
  permanently from public launch. ~$100/month for 7 days, hourly billed, outside the spend cap.
  Recovery foundations (restore markers, one-user recovery from a restored copy, runbook, drill) are
  being built separately (docs/RESTORE_RUNBOOK.md, supabase/recovery_2026_10b.sql).
- **Build-order rule: accepted.** The first App Store / Play binaries are built from the read-switch
  build or later — store installs don't self-update.
- **`moodLog`: deleted, never returning.** Removed once after hydration by `lib/state/retiredKeys.js`
  (commit "Delete the retired mood entries"), so it is NOT migrated into `daily_log` — drop it from the
  backfill, the kinds list and the draft SQL's comments.
- **Ranking rule for hand-entered days:** a manual entry counts towards ratings only if it was logged
  within **3 days** of the day itself (wearable values always count). This needs the entry's write time,
  which the `daily_log` rows (created_at / journal) provide — implement it in `netlify/lib/recompute.js`
  at the read switch, with the client mirror kept in parity (`check:parity`). Apple Health Shortcut data
  counts like a wearable source (owner-only surface).

**Risks**

1. **Old native builds are permanent.** Native builds never get the
   service worker's forced reload. A binary shipped before L5 would show
   empty vitals after cleanup and would rely on absorb indefinitely.
   *Mitigation:* the first store binary contains the L5 client logic and
   the P0 update gate.
2. **A bug in the diff layer could remove log values.**
   *Mitigation:* clients have no delete grant; removals only from a
   confirmed base; brakes on both sides; a journal of every overwrite and
   removal; property tests; and state stays complete until L7.
3. **Migration races with open clients.**
   *Mitigation:* every server mutation of `user_data` locks the row,
   checks a hash or verifies, and bumps `updated_at`, so open clients
   conflict and merge rather than overwrite (as `stateWrite.js` does
   today).
4. **The audit `vb_state_meaningful` may not be live.** If not, the marker
   is not counted by the history trigger.
   *Mitigation:* a Phase 0 check blocks everything after it.
5. **Storage is outside database backups.**
   *Mitigation:* ledger originals are kept for 90 days, objects are never
   deleted while referenced, and clients cannot delete.
6. **Concurrent work in `netlify/`.** Another agent is editing it now.
   The I1 `delete-account` change and the L2 cron changes must be
   coordinated and rebased, not merged blind.
7. **Burn order and ids.** Rebuilt entries may differ in key order or
   carry a `#n` suffix on a duplicate id.
   *Mitigation:* `sameValue` instead of `JSON.stringify`; the backfill
   reports duplicates (none expected).
8. **Supabase key retirement (item 85)** changes how functions
   authenticate. The new RPC calls should use the same helper that item
   85 introduces, so they are not rewritten twice.

**Decisions the owner must make**

1. **Order relative to the store launch.** Accept "first native binary ≥
   L5 build"?
2. **PITR.** Enable for the migration window as recommended, and then
   keep or drop it?
3. **Ranking rule.** Adopt "manual days count only if written within ~2
   days; wearable values always count; backfill grandfathered"? And how is
   `apple` (Shortcut) data treated?
4. **`moodLog`.** Move it into the table as read-only `kind='mood'`, as
   drafted (it stays exportable and leaves `state`), or leave it in
   `state`?
5. **Retention.** Journal 90 days, ledger originals 90 days, archive until
   a purge you approve. Acceptable? This goes into the DPIA either way.
6. **Bucket.** Does a backgrounds bucket already exist live (CLAUDE.md
   mentions one)? If so, reuse or retire it before I1.
7. **Value precedence.** Today the last writer wins per key (a WHOOP sync
   overwrites a hand-entered sleep). The plan **keeps** that. Per-key
   `src` would make "a hand entry always wins" possible later. Do you want
   that?
8. **Profile photo (I6)** and the next stores (`logs`, `macroHistory`,
   `coinHistory`): in scope after this, or not?
9. **`min_build` policy.** How long after a release may old builds keep
   working before the gate is raised? Suggested: 14 days on web; for
   native, the store review cycle plus 14 days.

---

## Appendix A. Every reader and writer of the keys that move

Found with `grep` over `src/`, `netlify/`, `scripts/` and `supabase/` on
2026-10-20. Re-run before each phase.

**`vitalsLog` / `burnLog`:**
- **Writers:** listed in §1.3 and §3.4.
- **Client readers** (unchanged, served by the in-memory view):
  - `VitalsHistoryCard.jsx`, `track/VitalsPanel.jsx`, `track/VitalsEntryModal.jsx`
  - `mobile/MobileWidget.jsx`, `widgets/LifeWidgets.jsx`, `widgets/GoalsWidget.jsx`
  - `NutritionSection.jsx:475-476`, `upgrade/DietTab.jsx`,
    `upgrade/home/useHomeLines.js`, `upgrade/lifts/useLifts.js`
  - `settings/DataExportCard.jsx:52`
  - `hooks/useAutomations.js:53-55`, `hooks/useDailyBrief.js`, `hooks/useRatings.js:85-94`
  - `lib/burn.js`, `lib/body/goal.js:77,339,361`, `lib/coach/heuristicBrief.js`,
    `lib/coach/wearableProvenance.js`, `lib/diet/weightTrend.js`
  - `lib/hub/primeData.js:793-835`, `lib/lifts/lifts.js`, `lib/ratings/derive.js:386-410`
  - `lib/trackers/autoLog.js`, `lib/upgrade/homeLines.js`, `lib/visions/definitions.js:108-109`
  - `lib/vitals/metrics.js`, `lib/vitals/readiness.js`, `lib/widgets/readiness.js`
- **Server readers:**
  - `netlify/lib/recompute.js:251-273, 424-429`, used by `recompute-ratings.js`,
    `get-leaderboard.js` and `prestige-up.js`
  - `netlify/lib/coachWearableGuard.js` (snapshot fields only)
  - `scripts/check-ratings-parity.mjs`
- **Guards and merge:** `lib/state/meaningful.js`, `lib/state/merge.js`,
  `supabase/audit_schema_2026_10.sql` (`vb_state_meaningful`).

**`bodyLog`:** `widgets/LifeWidgets.jsx` (the only reader and writer).

**`moodLog`:** no reader or writer since 2026-08 (`App.jsx:305-311`,
`lib/widgets/retired.js:13`).

**`backgrounds`:**
- `App.jsx:242-300, 536-560, 587, 714`
- `hooks/useVisionBoardState.js` (backup, visuals)
- `supabase/user_data_history_schema.sql` (stripped from snapshots)
- `data/initialState.js:36`

**`holidays[].imageUrl`:**
- `Modals.jsx` (`ImageField`), `holiday/HolidayFormTabs.jsx:72`
- `holiday/TripRail.jsx:485`, `holiday/BoardingPass.jsx:101`
- `HubSection.jsx:125`, `mobile/MobileWidget.jsx:1220-1221`

**`shopItems[].imageUrl`:** `Modals.jsx:1055,1132`, `ShopSection.jsx:292`.

**`savings[].image`:** `Modals.jsx:624-831` (picker and save), and
`useVisionBoardState.js:299-301` (stripped from the slim backup).
