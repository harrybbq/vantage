/**
 * What each consent covers, in the words the person agrees to. Shared by
 * the sheet and Settings → Privacy → Consent so the two can never
 * describe the same permission differently. Keep in step with sections 3
 * and 7 of the privacy policy (components/LegalPage.jsx).
 */
export const CONSENT_COPY = {
  health: {
    title: 'Health data',
    prompt: 'Allow health data?',
    what: 'Weight, sleep, heart rate, HRV, recovery, strain and calories burned — from WHOOP, an Oura Ring or Apple Health.',
    where: 'Stored in your Vantage account (EU servers). Only you see it: never shown to friends, never used for ads, never sold.',
    ask: 'Needed before connecting WHOOP, Oura or Apple Health.',
  },
  ai: {
    title: 'AI features',
    prompt: 'Allow AI features?',
    what: 'The daily coach brief, the food photo scanner and recipe-from-video send what they need to Anthropic’s API to produce the result — a summary of your habits, goals, vitals and macros for the brief; one camera frame for a scan; a video’s title and description for a recipe.',
    where: 'Handled under Anthropic’s commercial terms, which do not allow API data to be used to train their models. We don’t keep the photo or the summary we send.',
    ask: 'Needed before the coach brief, photo scanning or reading a video.',
  },
};
