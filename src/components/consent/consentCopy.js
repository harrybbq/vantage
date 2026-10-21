/**
 * What each consent covers, in the words the person agrees to. Shared by
 * the sheet and Settings → Privacy → Consent so the two can never
 * describe the same permission differently. Keep in step with sections 3
 * and 7 of the privacy policy (components/LegalPage.jsx).
 *
 * Written from the code (item 100, 2026-10-20):
 *   · health — WHOOP and Oura only. Apple Health import is owner-only
 *     and compiled out of the native build, so it is not offered here.
 *   · health "where" — true since item 124 (2026-10-20): WHOOP/Oura
 *     values are left out of ratings, visions (honours) and the friends
 *     heatmap (lib/wearables/strip.js, netlify/lib/wearableShare.js).
 *   · ai — what lib/coach/snapshot.js actually sends (WHOOP/Oura-fed
 *     trackers withheld by the wearable guard), the one camera frame of
 *     a scan, and Anthropic's limited retention. Recipe-from-video is
 *     owner-only and is not offered here.
 */
export const CONSENT_COPY = {
  health: {
    title: 'Health data',
    prompt: 'Allow health data?',
    what: 'Weight, sleep, heart rate, HRV, recovery, strain, steps and calories burned — from WHOOP or an Oura Ring.',
    where: 'Stored in your Vantage account (EU servers). Your readings are never shown to anyone else, never used for ads and never sold, and nothing from WHOOP or Oura counts toward your ratings or the activity friends see. Synced values stay in your account until you delete them.',
    ask: 'Needed before connecting WHOOP or Oura.',
  },
  ai: {
    title: 'AI features',
    prompt: 'Allow AI features?',
    what: 'The daily coach brief and the food photo scanner send what they need to Anthropic’s API — for the brief, your first name, habit names with relapse counts, achievements, trackers (not WHOOP or Oura ones), upcoming holiday destinations and wish-list counts; for a scan, one camera frame.',
    where: 'Never your email, vitals, food log or money. Anthropic doesn’t train on API data and may keep it for a limited time under its commercial terms. We don’t keep the photo or the summary we send.',
    ask: 'Needed before the coach brief or photo scanning.',
  },
};
