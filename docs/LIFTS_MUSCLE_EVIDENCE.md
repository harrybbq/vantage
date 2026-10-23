# Lifts: muscle weights and the evidence behind them

The adaptive training planner (`src/lib/lifts/adaptive.js`, `EXERCISE_PARTS`)
credits each set of an exercise to the muscle parts it trains. These
weights decide weekly targets, the "twice a week" hits, the body map, and
which exercises a built Upper / Lower picks. This file records where each
number comes from, so a later change can be checked against it.

The review was commissioned by the owner in October 2026. The sources were
read by a separate research session (Claude in Chrome), and its notes are
summarised here. Evidence tags: **[FT]** full text read · **[Abs]**
abstract only · **[2°]** secondary source only.

## Counting convention

- **Fractional counting:** 1 for a muscle trained directly, 0.5 for a
  substantial secondary. Pelland, Remmert, Robinson, Hinson & Zourdos,
  *Sports Medicine* 2026;56(2):481–505 (doi:10.1007/s40279-025-02344-w;
  preprint SportRxiv #460 [FT]).
  - The study coded indirect sets as 1, 0.5 or 0, and fractional (0.5) fit
    best in all four models.
  - Volume and hypertrophy show diminishing returns: a minimum effective
    dose of about 4 sets a week, and sparse data above 25–30.
  - Frequency has close to no effect on hypertrophy once volume is equated;
    for strength it levels off after about 2 sessions a week.
  - The authors note that classifying a set as direct or indirect "was not
    wholly objective".
- **Compound lifts give synergists real but smaller growth than direct
  work.** Gentil 2015 [FT] found pulldowns grew the elbow flexors about as
  much as curls; Mannarino [FT preprint] found rows gave about 47% of
  curl-level growth. Both fit 0.5.
- **Stronger by Science (Nuckols 2025) uses the same convention:** a row is
  0.5 of a biceps set.
- **Renaissance Periodization counts a set** if it has 5–30 reps taken to
  0–4 RIR.
- **The 0.25 tier is this app's own heuristic** for a minor contributor; no
  study tests it. Where a muscle grew in an MRI or ultrasound trial it is
  credited from that, and EMG alone earns at most 0.25.

**How groups are counted:** a set credits each muscle group the weight of
the strongest part it works in that group (`groupWeightsOf`). So a
feet-high leg press counts in full for both glutes and quads, which the old
"first tag 1, others ½" rule couldn't express. Lifts outside the programme
still use their muscle tags, which gives the same rule as before.

## Programme exercises

| Exercise | Weights (main part first) | Basis | Confidence |
|---|---|---|---|
| 45° hyperextension | Lower back 1 · Glute max 0.5 · Hamstrings 0.5 (unchanged) | EMG only (da Silva 2009 [FT]). A neutral-spine hip hinge shifts it toward hamstrings (Andersen 2021 [FT]); worth a separate entry if done that way. | low–medium |
| Leg extension | Rectus femoris 1 · **Outer & inner quads 1** (was 0.5) | Kinoshita, Maeo et al. 2026, MSSE (MRI): RF +13.2%; vasti +5–7%, the same as leg press. | high |
| Machine leg press | Outer & inner quads 1 · Glute max 0.5 · **Adductors 0.5** (RF dropped) | Kinoshita 2026: RF +1.1% (not significant), adductors +4.1%. | medium–high |
| Standing calf raise | Gastrocnemius 1 · Soleus 0.5 (unchanged) | Kinoshita 2023, Front Physiol (MRI). | medium |
| Walking dumbbell lunge | Outer & inner quads 1 · Glute max 0.5 · Glute medius 0.25 · **Adductors 0.25** | No lunge hypertrophy trial; glute EMG very high (Krause Neto 2020 [FT]). Adductors 0.25 is a judgement: the notes say they work in deep lunges, without numbers. | low–medium |
| Ab crunch machine | Abs 1 (unchanged) | Rectus-dominant EMG (Escamilla 2006 [Abs]). | medium |
| Dip | Mid & lower chest 1 · Triceps lat & med 0.5 · Front delts 0.5 (unchanged) | No share data; mirrors the bench evidence. Pressing barely grows the long head (Brandão 2020 [FT]; Wakahara 2013 [FT]). | low |
| Incline dumbbell press | Upper chest 1 · **Mid & lower chest 0.5** · Front delts 0.5 · **Triceps lat & med 0.5** | Chaves 2020 [FT]: incline also grew the mid/lower pec. Wakahara 2013: dumbbell pressing grew the triceps ~20%. | medium |
| Machine shoulder press | Front delts 1 · Side delts 0.5 · Triceps lat & med 0.5 · **Upper chest 0.25** | Campos 2020 [Abs] EMG; Coratella 2022 [Abs]. | medium |
| Dumbbell lateral raise | Side delts 1 · **Front delts 0.25 · Rear delts 0.25** | Campos 2020 EMG (anterior 21%, posterior 24%); EMG only, so 0.25. | low |
| Single-arm cable triceps pushdown | Triceps lat & med 1 · **Triceps long head 0.5** | Maeo 2023 [Abs] (MRI): pushdown grew the long head +19.6% (overhead +28.5%). | medium |
| Overhead cable bar extension | Triceps long head 1 · **Triceps lat & med 1** | Maeo 2023: overhead also out-grew pushdown for lateral/medial (+14.6% vs +10.5%). | medium–high |
| Lat pulldown | Lats 1 · **Mid-back 0.5** · Biceps 0.5 · **Brachialis 0.25 · Rear delts 0.25** | Lehman 2004 [FT], Lee & Lim 2017 [FT]: mid-trap/rhomboid EMG ≈ lats. Gentil 2015: grew the elbow flexors like curls. Signorile 2002, Botton 2013: rear delt active. | medium |
| Single-arm cable row | Lats 1 · Mid-back 0.5 · **Biceps 0.5** (was 0.25) · **Brachialis 0.25 · Rear delts 0.25** | Mannarino: ~47% of curl-level growth. Botton 2013: posterior delt ~54%. Fenwick 2009: no lower-back credit. | medium |
| Cable bar pullover | Lats 1 · **Triceps long head 0.25 · Mid & lower chest 0.25** | Muyor 2022 [FT]: the standing cable version is lat-dominant. A lying pullover would earn ~0.5 for each. | low–medium |
| Cable archer pull (rear delt) | Rear delts 1 · Mid-back 0.5 (unchanged) | No study of this exercise; horizontal abduction is the rear delt's job (Schoenfeld 2013 [FT]). | low |
| Incline dumbbell curl, 21s | Biceps 1 · **Brachialis 0.5** | Date 2021 [FT]; Attarieh 2025 [Abs]: the brachialis is a prime flexor in every grip. Long-range work grows more (Sato 2021 [FT]). | medium |
| Reverse EZ-bar curl | Brachialis 1 · **Forearms 1** · Biceps 0.25 | Kleiber 2015 [FT]: brachioradialis rises most in pronation. Forearms added at the owner's request (Oct 2026). | low–medium |
| Hip thrust | Glute max 1 · **Hamstrings 0.25** (was 0.5) · **Outer & inner quads 0.25** | Plotkin 2023 [FT] (MRI): hamstring growth "equivocal". Contreras 2015 [Abs]: quad EMG high, but squats out-grew it. | medium |
| Seated leg curl | Hamstrings 1 (unchanged) | Maeo 2021 [FT]: seated beat lying. | high |
| Leg press, feet high | Glute max 1 · **Outer & inner quads 1** (was 0.5) · **Adductors 0.5** · **Hamstrings 0.25** (was 0.5) | Kinoshita 2026 used this set-up: glute max +15.4%, vasti as leg extension, hamstrings +3.1%, adductors +4.1%. | medium–high |
| Reverse lunge | Outer & inner quads 1 · Glute max 0.5 · Glute medius 0.25 · **Adductors 0.25** | As the walking lunge. | low–medium |
| Seated calf raise | Soleus 1 (unchanged) | Kinoshita 2023: no gastrocnemius growth seated. | medium |
| Pallof press | Obliques 1 · Abs 0.25 (unchanged) | Consensus only (one 4-person pilot). | low |
| Wide-grip cable row | Mid-back 1 · Rear delts 0.5 · Lats 0.5 · **Biceps 0.5 · Brachialis 0.25** | Padovan 2025 [FT] (HD-EMG): wide grip favours mid-trap; biceps and rear delt as any row. | medium |

The muscle tags in `src/lib/lifts/muscles.js` (`PROGRAMME_MUSCLES`) are
the groups each exercise credits at 0.5 or more, strongest first. A test
in `adaptive.test.mjs` keeps the tags and the weights in step.

## New muscle groups (owner's choice, Oct 2026)

- **Adductors.** One of the largest thigh muscles. They grow from squats
  (Kubo 2019 [2°]; Plotkin 2023) and leg press (Kinoshita 2026). They are
  on the twice-a-week rule, which Legs and Lower meet without an extra
  exercise.
- **Forearms (brachioradialis).** Reverse and hammer curls train them
  heavily (Kleiber 2015). They are tracked and credited, but **exempt from
  the twice-a-week rule** (`FREQ_EXEMPT`). Only the reverse curl trains them
  in the programme, so the rule would add an exercise to Upper on
  shift-length sessions.
- **Upper traps.** Not added (owner's choice).

The library (`src/lib/lifts/catalogue.js`) now tags:
- the hip adduction machine → Adductors (was "Other");
- hammer curl → Biceps + Forearms;
- back, front, hack, Smith and goblet squats → + Adductors.

The body map fills the inner-thigh shapes (front and back) and the
forearms, which it used to draw empty.

## Not done, and why

- **Common lifts outside the programme.** The research produced weights for
  about 40 of them, but the JSON block with those values didn't come
  through. They still use their muscle tags. Paste the JSON to apply them.
- **Unverified items.** ExRx (blocked to automated fetching), some citation
  details, and several studies seen only through secondary sources; listed
  in the research notes. Kinoshita 2026 was read from a third-party PDF and
  should be checked against the journal page once it is in an issue.
- **Study limits.** Most hypertrophy trials are small, short (8–12 weeks)
  and in untrained people. EMG figures from different labs can't be
  compared directly.
