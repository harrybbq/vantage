import { useEffect, useState } from 'react';
import { SUPPORT_EMAIL, SECURITY_EMAIL, isPlaceholderEmail, mailtoHref } from '../lib/support';

// ── Shared prose wrapper ─────────────────────────────────────────────────
// Exported for the /support and /delete-account pages (support/
// SupportPages.jsx) so every public page reads the same.
//
// Colours are fixed, not theme tokens: the overlay is always dark, and
// pre-auth (or in Cream) var(--text) is the cream theme's near-black —
// which made every section heading invisible on the dark overlay.
export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <h2 style={{ fontFamily: 'var(--serif, Playfair Display, serif)', fontSize: '16px', fontWeight: 700, color: '#e8eaf0', margin: '0 0 10px', borderBottom: '1px solid rgba(255,255,255,.1)', paddingBottom: '8px' }}>
        {title}
      </h2>
      <div style={{ fontSize: '13px', lineHeight: 1.75, color: 'rgba(232,234,240,.8)', fontFamily: 'var(--sans, DM Sans, sans-serif)' }}>
        {children}
      </div>
    </div>
  );
}

export function P({ children }) {
  return <p style={{ margin: '0 0 10px' }}>{children}</p>;
}

export function Ul({ items }) {
  return (
    <ul style={{ margin: '6px 0 10px 18px', padding: 0 }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: '5px' }}>{item}</li>)}
    </ul>
  );
}

const LAST_UPDATED = '20 October 2026';

function Updated() {
  return (
    <P>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-floor)', color: 'rgba(255,255,255,.4)' }}>
        Last updated: {LAST_UPDATED}
      </span>
    </P>
  );
}

// Placeholders still to be filled in before launch. Styled so nobody can
// mistake one for finished text — a policy that quietly says "[Company
// name]" in body type reads as an oversight; this reads as a TODO.
export function Todo({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: '12px', padding: '1px 5px', borderRadius: '4px',
      background: 'rgba(200,151,10,.16)', color: '#e0b43c', border: '1px dashed rgba(200,151,10,.5)',
    }}>{children}</span>
  );
}

// A contact address from lib/support.js — the one place they live. While
// it is still the "[your-domain]" placeholder it renders as a marked
// TODO, never as a mailto nobody can send to.
function ContactEmail({ address, subject }) {
  if (isPlaceholderEmail(address)) return <Todo>{address} — to be confirmed</Todo>;
  return (
    <a href={mailtoHref(address, subject)} style={{ color: LINK_COLOR, textDecoration: 'underline', textUnderlineOffset: '2px' }}>
      {address}
    </a>
  );
}

function Mono({ children }) {
  return <span style={{ fontFamily: 'var(--mono)', color: 'var(--em-light, #4dc485)' }}>{children}</span>;
}

// Link to another public page (/support, /delete-account, /privacy,
// /terms). A real href, so it works opened in a new tab or with
// JavaScript off; `go` swaps the page in place when the overlay can.
export const LINK_COLOR = '#5fd39a';
export function PageLink({ to, go, children }) {
  return (
    <a
      href={`/${to}`}
      onClick={e => { if (!go) return; e.preventDefault(); go(to); }}
      style={{ color: LINK_COLOR, textDecoration: 'underline', textUnderlineOffset: '2px' }}
    >
      {children}
    </a>
  );
}

// ── Privacy Policy ───────────────────────────────────────────────────────
// Section 8 is written from the code, not from memory: every host listed
// is one the app or its Netlify functions actually contact (grep
// netlify/ and src/ for https:// when adding a provider, and add it here
// in the same change). It separates what your DEVICE contacts directly —
// which hands that provider your IP address — from what our functions
// contact on your behalf, which does not.
//
// Revised 2026-10-20 against the code (STARTUP_REQUIREMENTS item 100,
// docs/STORE_PRIVACY_LABELS.md §4 M1–M16, docs/DPIA_DRAFT.md). When the
// behaviour behind a sentence changes, change the sentence in the same
// commit — the store labels are filled in from this page. Evidence:
//   · deletion: netlify/functions/delete-account.js (immediate, cascade);
//     user_data_history (14 snapshots, cascade); Supabase Pro daily
//     backups, 7 days (no PITR today)
//   · purchase history: lib/billing/revenuecat.js logIn(Supabase id)
//   · crash reports: netlify/functions/client-error.js → client_errors
//     (30-day purge: audit_schema_2026_10.sql note; schedule = item 96)
//   · AI coach payload: lib/coach/snapshot.js buildSnapshot() + the
//     server's wearable guard in ai-coach-daily.js
//   · AI caps: netlify/lib/aiQuota.js (food scan 3/week free, 40/day Pro)
//   · ratings from logging days: lib/ratings/derive.js vitalsPoints etc.
//   · invite preview: preview_friend_invite (dm_upgrade_2026_10.sql)
//   · community foods: food_contributions_schema.sql
//   · closed reports deleted after 12 months: launch batch B's SQL —
//     until that runs, §11's report line is a commitment, not yet a job
//   · owner-only (not described as features): Apple Health import,
//     recipe-from-video, and everything in lib/native/ownerSurfaces.js
function PrivacyPolicyContent({ go }) {
  return (
    <>
      <Section title="1. Who We Are">
        <P>Vantage ("the App", "we", "us") is a personal productivity, goal-tracking and wellness application, available on the web and as a mobile app. The data controller for personal data processed through the App is <Todo>[Company name, registered address — to be completed on incorporation]</Todo>.</P>
        <P>For any privacy question or request, email <ContactEmail address={SUPPORT_EMAIL} subject="Privacy request" />, or use Settings → Report a problem inside the App (see <PageLink to="support" go={go}>Support</PageLink>). To report a security vulnerability, email <ContactEmail address={SECURITY_EMAIL} subject="Security report" />. This policy is written for users in the United Kingdom and European Economic Area, but it applies to everyone who uses the App.</P>
      </Section>

      <Section title="2. Data We Collect">
        <P>We collect only what is needed to provide the service:</P>
        <Ul items={[
          'Account data — your email address, used to create and authenticate your account.',
          'Profile & social data (optional) — a display name, a unique @handle you may claim, a profile picture, your level and ratings, and — if you enable them — an activity streak, a 91-day activity heatmap, recent achievement wins, and an online-status indicator. See section 6 for who can see what.',
          'User-generated content — boards, trackers, achievements, shopping wish-list items, holiday plans, notes, group names and group pictures you create inside the App.',
          'Money you enter — savings goals, balances and contributions, accounts and interest rates, monthly income and spending, and subscriptions and bills with their costs and renewal dates. All of it is typed in by you; Vantage has no connection to your bank and does not see your transactions.',
          'Habits you are breaking — each habit\'s name, when you last slipped, and how many relapses you have recorded. A habit\'s name can say something about your health (for example a quit-drinking habit): it is sent to the AI brief only if you use it (section 7), and shown to friends only if you turn on the habit-streak card (section 6).',
          'Self-check scores — your scores from the Brain, Finance, Fitness and Social self-checks, used in your ratings.',
          'Friends — the people you add as friends, friend requests you send and receive, and invite links you create.',
          'Direct messages — messages you exchange with accepted friends are stored in our database so they can be delivered and shown in your conversation history. They are transmitted over TLS but are not end-to-end encrypted; treat them like email, not like a sealed letter.',
          'Nutrition data — food log entries, macro targets and goals you record, stored in our database and linked to your account.',
          'Shared foods (optional) — if you choose to share a food you created, its name, brand and nutrition values are added to food search for every user. Your name is never shown with it; we keep a record that you shared it so it can be moderated, and it is removed when you delete your account.',
          'Health & fitness data (section 3) — things you type in yourself: weight, body measurements (such as waist, chest, hips and body fat), sleep, resting heart rate, workouts, steps and calories burned; your height, age and sex if you give them for a calorie estimate. And, only with your explicit consent, if you connect WHOOP or an Oura Ring: daily metrics such as sleep duration, resting heart rate, heart-rate variability, recovery/readiness score, strain, energy expenditure (calories), steps and workout summaries.',
          'Reports and blocks — if you report or block someone, we store who reported whom, the reason you chose and any note you add. A report can include a copy of the reported person\'s handle and display name at the time, and recent messages from them if you report from a conversation.',
          'Payment & subscription data — if you buy Vantage Pro, the purchase is processed by Apple (App Store) or Google (Google Play), and RevenueCat, our subscription provider, keeps the purchase and renewal history of your Pro subscription (which plan, when it started, renewed or ended, and the store) linked to your Vantage account ID. We receive your subscription status. We never receive or store your card number.',
          'Device & notification data — if you turn on push notifications, we store a device push token so notifications can be delivered via Apple/Google push services (Firebase Cloud Messaging). In the app, the token is only created once you agree to notifications.',
          'Camera images (optional) — if you use the AI food scanner (3 free scans a week; more on Pro, within a daily fair-use limit), a single camera frame is sent to Anthropic\'s API to identify the food (section 7). We do not store the image.',
          'Approximate location — to show local weather, our server looks up the approximate city for your IP address (section 8). We do not store the result against your account, and we never collect precise (GPS) location.',
          'Third-party sign-in data (optional) — if you sign in with Google or Apple, we receive a minimal profile from that provider (section 9).',
          'Session data — a session token kept by our authentication provider to keep you signed in.',
          'Preferences — colour scheme, background and similar choices, stored in your browser\'s / device\'s localStorage and in your account.',
          'Crash reports — when the App hits an error, it sends us the error message and technical trace, the screen it happened on, your browser or device type and the App version, linked to your account if you are signed in. We use them only to find and fix bugs, and delete them after 30 days (section 11).',
          'Anonymous performance measurements (web app only) — on about one page load in five, the browser measures how quickly the page loaded and responded and sends us those timings with the page path and a coarse device type (phone, tablet or desktop); they are stored without your account, IP address or any other identifier and are used only to find and fix slow pages.',
          'Problem reports — if you use Settings → Report a problem, we store what you write, the category you choose and the page you were on, linked to your account so we can follow up.',
        ]} />
        <P>We do not collect precise location data, biometric identification data, advertising identifiers or your phone’s contact list, and we have no access to your bank. We use no advertising or analytics trackers.</P>
        <P>Mood entries from the retired Mood feature were deleted in October 2026. Copies age out of the history snapshots within 14 days and of our database provider&apos;s backups within 7 days (section 11).</P>
        <P>A few features on the website are still being tested on the developer&apos;s own account (for example an Apple Health import). They are not available to users, are not part of the iOS or Android app, and are not described here; if one becomes available, this policy will be updated first.</P>
      </Section>

      <Section title="3. Health Data & Your Explicit Consent">
        <P>Vitals, body measurements, sleep, heart-rate, activity and nutrition information are health data — "special category" data under UK GDPR. We ask for your explicit consent to health data on a consent screen that every account sees once, and again before you connect WHOOP or an Oura Ring — no connected source is set up without it. Saying no is fine: features that do not need health data keep working, and anything you choose to type in yourself (such as a weight or a meal) is still saved to your account and shown only to you.</P>
        <Ul items={[
          'You can withdraw consent at any time in Settings → Privacy → Consent. To stop a connected source sending anything further, also use Disconnect on its WHOOP or Oura panel (this immediately deletes that device’s stored access tokens). You can delete individual entries or your whole account at any time; metrics already recorded stay in your history until you do.',
          'Health data is used solely to show you your own trends and widgets. It is never used for advertising and never sold. Your readings — weights, measurements, sleep, heart rate, meals — are never shown to other users. One thing others can see is derived from it: your ratings (shown to friends, and on the leaderboard and in groups if you take part) are partly worked out from how many days you logged vitals, activity and on-target nutrition, with activity counted only up to a daily cap. The ratings show a score, never the readings behind it.',
          'The daily AI brief (section 7) does not receive your Vitals log, body measurements, food log or anything from WHOOP or Oura — only the trackers, habits and other items listed there.',
          'WHOOP and Oura data is fetched from their respective APIs under your OAuth authorisation.',
        ]} />
      </Section>

      <Section title="4. Legal Bases for Processing">
        <Ul items={[
          'Performance of a contract — your email, account and app content are processed to deliver the service you signed up for.',
          'Explicit consent — health & fitness data (section 3), AI features (section 7) and push notifications. You can withdraw consent at any time without affecting the rest of the App.',
          'Legitimate interests — storing preferences, keeping the service secure, finding and fixing crashes (crash reports), keeping history snapshots so lost data can be recovered, screening uploaded group pictures and profile pictures, handling reports and preventing abuse of social features.',
          'Legal obligation — keeping records we are required to keep, and responding to lawful requests.',
        ]} />
      </Section>

      <Section title="5. How We Use Your Data">
        <Ul items={[
          'To create and manage your account and sync your data across devices.',
          'To operate the social features you choose to use (friends, messages, groups, leaderboard).',
          'To provide optional AI features when you use them (section 7).',
          'To review reports and act on accounts or content that break the Terms of Service.',
          'To send transactional emails (account confirmation, password reset) — we send no marketing emails.',
          'To deliver push notifications you have enabled.',
          'To verify subscription entitlements for Vantage Pro.',
          'To find and fix bugs and crashes.',
        ]} />
      </Section>

      <Section title="6. Social Features — What Others Can See">
        <P>Everything social in Vantage is controlled in Settings → Privacy:</P>
        <Ul items={[
          'Handle search — you are only findable by @handle search while "Show me in handle search" is on. It is off by default for new accounts and needs a claimed handle. Accounts created before this default changed keep the setting they had — check it in Settings → Privacy.',
          'Leaderboard — the global leaderboard shows your display name, profile picture, level, rating and prestige. You appear on it only while "Show me on the global leaderboard" is on; it is off by default for new accounts (older accounts: as above). Friends see you on the friends board regardless. Pro users may optionally colour their name.',
          'Friends — people you accept as friends can see your profile card: display name, avatar, level, and any of streak / heatmap / recent wins / online status you have enabled. Each has its own toggle. The habit-streak card, which shows the habit\'s name, is off unless you turn it on.',
          'Groups — if you join a group, its members see your display name, profile picture, rating and weekly climb. The group\'s name, picture and weekly score appear on its division\'s board to other groups.',
          'Direct messages — visible only to you and the recipient (and stored as described in section 2). If the recipient reports a conversation, recent messages from it are included in the report for review.',
          'Invite links — if you share a friend-invite link, anyone who opens it, signed in or not, sees your display name, @handle, profile picture, level and rating, until the link expires (after 30 days) or has been used up.',
          'Ratings — the level and ratings others see are scores. The Fitness rating (and the overall rating that includes it) is partly worked out from how many days you logged vitals, activity and nutrition; nobody sees the readings themselves (section 3).',
          'Shared foods — a food you choose to share appears in everyone\'s food search with its name, brand and nutrition values, never with your name.',
        ]} />
      </Section>

      <Section title="7. AI Features (Anthropic)">
        <P>These optional features send data to Anthropic's API, our AI provider. We ask for your consent before the first one runs, and you can withdraw it in Settings → Privacy → Consent:</P>
        <Ul items={[
          'AI food scanner (3 free scans a week; more on Pro, within a daily fair-use limit) — one camera frame per scan, used to identify the food and estimate nutrition.',
          <>Daily AI brief (Vantage Pro) — once a day, a summary of your own App data is sent to write your brief. It contains: your first name; today&apos;s date; the habits you are breaking, with their names, days since your last relapse and number of relapses; your achievements (names, whether done, coin values); your trackers (names, units, goals and the last 14 days of values) — except any tracker filled from WHOOP or Oura, which is left out; up to two holidays in the next 90 days (destination and days to go); how many wish-list items you have and up to two you can afford now (name and coin cost); your coin balance; your last few briefs; and which kinds of tip you have recently dismissed. It does not contain your email, your account ID, your Vitals log, body measurements, food log, money entries, messages or anything from WHOOP or Oura.</>,
        ]} />
        <P>Separately, and not optional: when a group picture is uploaded, or before your profile picture is shown to other people, the image is sent to Anthropic's API to screen it for content that breaks the Terms. Until a picture passes, other people see your initial instead; the picture itself stays on your account. This is done on the basis of legitimate interests (keeping the App safe).</P>
        <P>In each case the data is sent to Anthropic's API to produce the result, without your name, email or account ID attached (beyond the first name in the brief). Anthropic handles it under its commercial terms: it does not use data sent through its API to train its models, and it may retain inputs and outputs for a limited period (for example for safety and abuse monitoring) before deleting them. We do not store the camera frame or the summary we send; the result (for example your brief) is saved in your account. If you never use the optional features, none of your data is sent to Anthropic by them. AI output can be wrong — see the Terms of Service health disclaimer.</P>
      </Section>

      <Section title="8. Third Parties (Processors and Services We Contact)">
        <P><strong>Providers that run the App</strong> (they process your personal data on our behalf):</P>
        <Ul items={[
          'Supabase — database and authentication, hosted in the EU. Stores your account, app content, money entries, messages, nutrition and health data, history snapshots and crash reports.',
          'Netlify — web hosting and the serverless functions that power sync, leaderboards, groups and integrations. Receives your IP address when you use the App.',
          'Anthropic — AI features and screening of group and profile pictures, as described in section 7.',
          'RevenueCat — manages Vantage Pro subscriptions: keeps the purchase and renewal history of your subscription, linked to your Vantage account ID, and tells us whether Pro is active. Apple and Google — billing for purchases made through their stores; payment details are handled by the platform you buy through and never reach us.',
          'Firebase Cloud Messaging (Google) — delivery of push notifications you enable; processes your device push token.',
          'Google / Apple sign-in — optional authentication only (section 9).',
        ]} />
        <P><strong>Services you connect</strong> (under your authorisation; their own privacy policies govern their side):</P>
        <Ul items={[
          'WHOOP — your WHOOP recovery, sleep, strain and workout data, fetched via their API.',
          'Oura Health (Oura Ring) — your sleep, heart-rate, readiness and activity data, fetched via the Oura API.',
        ]} />
        <P><strong>Services our servers contact on your behalf</strong> (they see the request, not your account):</P>
        <Ul items={[
          <>ipwho.is — <strong>receives your IP address</strong> so our weather function can find your approximate city. Nothing else is sent.</>,
          'Open-Meteo — weather forecasts for that approximate location, and historic weather and place lookups for holiday destinations you add.',
          'Frankfurter (frankfurter.app) — currency exchange rates for holiday destinations.',
          'Open Food Facts, USDA FoodData Central and FatSecret — food search. Only your search text or a scanned barcode is sent.',
          'GNews — news headlines for the news widget, including any topic you search for.',
          'Finnhub — stock and market quotes for the ticker symbols you add to the market widget.',
          'Shop websites — when you paste a product link, or open Shopping, our server fetches that product page to read its name, image and current price.',
        ]} />
        <P><strong>Services your device contacts directly</strong> (these receive your IP address, as any website you load does):</P>
        <Ul items={[
          'Google Fonts — the App\'s typefaces.',
          'Google favicon service — small brand logos next to foods and shops; the brand\'s website name is sent.',
          'GitHub API — only if you add the GitHub widget: the GitHub username you enter is looked up to show that public profile and its repositories.',
        ]} />
        <P>We do not sell, rent, or share your data with advertisers or data brokers.</P>
      </Section>

      <Section title="9. Third-Party Sign-In (Google & Apple)">
        <P>You can sign in with Google or Apple instead of a password. This is optional — email and password sign-in works without either.</P>
        <P><strong>Google</strong> shares with us: your email address, display name, profile picture and a unique account identifier. <strong>We do not request access to Gmail, Drive, Calendar or any other Google service.</strong></P>
        <P><strong>Apple</strong> shares with us: your email (or a private relay address if you hide it), your name on first sign-in, and a unique identifier.</P>
        <P>Revoking access: Google Account → Security → Third-party apps → remove Vantage; or Apple ID → Sign in with Apple → Vantage → Stop using. Revoking provider access does not delete your Vantage data — use in-app account deletion for that (section 11).</P>
      </Section>

      <Section title="10. International Transfers">
        <P>Your core data is stored in the EU (Supabase). Several providers in section 8 are based in, or process data in, the United States or elsewhere outside the UK/EEA — including Anthropic, RevenueCat, Netlify, Google and GitHub. Where personal data leaves the UK/EEA, transfers are protected by UK adequacy regulations, the UK International Data Transfer Addendum and/or EU Standard Contractual Clauses entered into with each processor.</P>
      </Section>

      <Section title="11. Data Retention & Deletion">
        <Ul items={[
          <>Account &amp; content — retained while your account is active. Delete your account at any time via Settings → Account → Delete account (see <PageLink to="delete-account" go={go}>Delete your account</PageLink>). Deletion is immediate: your login and everything stored against your account — app data, history snapshots, profile, food log, friends, messages, push tokens, WHOOP and Oura connections, uploaded files and your RevenueCat subscription record — are deleted at once.</>,
          'Backups — our database provider (Supabase) keeps daily backups of the whole database for 7 days. A deleted account can survive in those backups until they roll off, so it is fully gone within 7 days — inside the 30 days we commit to. Backups cannot be edited and are used only to restore the service after a failure.',
          'History snapshots — to recover from accidental loss, we automatically keep up to 14 daily copies of your app data (without images). Older copies are replaced as new ones are made, and all of them are deleted with your account.',
          'WHOOP and Oura tokens — deleted immediately when you disconnect that device.',
          'Direct messages — retained until you delete them or your account.',
          'Reports — a report you make, or one made about you, is kept while it is being dealt with and may be kept after the account involved is deleted, so repeat abuse can be recognised. A closed report is deleted automatically 12 months after it was closed.',
          'Problem reports — kept until the problem is dealt with; if you delete your account first, the report loses its link to you.',
          'Crash reports — deleted after 30 days. If you delete your account sooner, they lose their link to you.',
          'Purchase records — Apple and Google keep their own records of purchases made through their stores, under their own policies.',
          'Camera frames & AI summaries — not stored by us; discarded after each request (Anthropic\'s own limited retention is described in section 7).',
          'Subscriptions — deleting your account does not cancel an App Store or Google Play subscription; cancel it in the store.',
          'Data export — you can export your data at any time in Settings → Account.',
        ]} />
      </Section>

      <Section title="12. Security">
        <P>All data is encrypted in transit (TLS). Database access is protected by row-level security so users can only read what they are entitled to; server-side keys never ship in the app. No system is perfectly secure — if we become aware of a breach affecting your personal data we will notify you and the ICO as required by law. To report a vulnerability, email <ContactEmail address={SECURITY_EMAIL} subject="Security report" />.</P>
      </Section>

      <Section title="13. Cookies & Local Storage">
        <Ul items={[
          'Session tokens — set by our authentication provider to keep you signed in. Essential; the service cannot work without them.',
          'localStorage — preferences (colour scheme, backgrounds, dismissals) and a local backup of your data, stored on your device.',
          'No third-party tracking, advertising or analytics cookies are used.',
        ]} />
      </Section>

      <Section title="14. Your Rights (UK GDPR)">
        <Ul items={[
          'Access — request a copy of your personal data (or use the in-app export).',
          'Erasure — delete your account and all data in-app.',
          'Portability — export your data in-app.',
          'Rectification — correct data by editing it in the App.',
          'Restriction & objection — ask us to limit or stop certain processing.',
          'Withdraw consent — at any time, for health data, AI features or notifications, without affecting the rest of the App (Settings → Privacy → Consent).',
        ]} />
        <P>To exercise a right not available in-app, contact us as described in section 1. We respond within one month.</P>
      </Section>

      <Section title="15. Children">
        <P>The App is not intended for children under 13, and we do not knowingly collect data from anyone under 13. If you believe a child has registered, contact us and we will delete the account promptly.</P>
      </Section>

      <Section title="16. Changes to This Policy">
        <P>We will notify registered users of material changes in-app and by updating the date below. Continued use after changes take effect constitutes acceptance.</P>
        <Updated />
      </Section>

      <Section title="17. Complaints">
        <P>If you are unhappy with how we handle your data, you can lodge a complaint with the UK Information Commissioner's Office at <Mono>ico.org.uk</Mono> (0303 123 1113), or with your local EU supervisory authority.</P>
      </Section>
    </>
  );
}

// ── Terms of Service ─────────────────────────────────────────────────────
function TermsContent({ go }) {
  return (
    <>
      <Section title="1. The Service">
        <P>Vantage is a personal productivity and wellness app for tracking goals, habits, achievements, nutrition, vitals, savings, a wish-list and holidays, with optional social features. The core service is free. An optional paid subscription, <strong>Vantage Pro</strong>, unlocks additional features (section 4). By creating an account or using the App you agree to these terms.</P>
      </Section>

      <Section title="2. Eligibility">
        <P>You must be at least 13 years old to create an account. If you are under 18, you confirm you have permission from a parent or guardian, and you may only make purchases with the account holder's / bill payer's permission.</P>
      </Section>

      <Section title="3. Your Account">
        <Ul items={[
          'You are responsible for keeping your login credentials secure and for all activity under your account.',
          'You must provide a valid email address and must not share your account.',
          'If you sign in via Google or Apple, that provider\'s terms also apply. Losing access to your provider account may mean losing access to your Vantage account — keep a recovery method enabled with the provider.',
        ]} />
      </Section>

      <Section title="4. Vantage Pro — Subscriptions & Payments">
        <Ul items={[
          'Vantage Pro is an optional auto-renewing subscription. Price, billing period and included features are shown before you buy.',
          'Purchases made in the iOS app are billed by Apple through your App Store account; purchases in the Android app are billed by Google Play. Subscription management (including RevenueCat, our entitlement provider) links your purchase to your Vantage account.',
          'Your subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Cancel any time in your App Store / Google Play subscription settings; access continues until the end of the paid period.',
          'Refunds for store purchases are handled by Apple or Google under their policies. Nothing in these terms affects your statutory rights, including your rights under UK consumer law.',
          'If we change the price of your subscription we will give you notice in advance, and the change will only apply from your next renewal.',
          'Free features remain free unless we clearly communicate otherwise with adequate notice.',
          'Pro lifts the free plan\'s limits on lists such as habits, achievements, trackers and holidays. AI features keep a daily fair-use limit on Pro, so that one account cannot run up costs for everyone.',
        ]} />
      </Section>

      <Section title="5. Coins & Virtual Items">
        <P>The App awards virtual coins and similar in-app items for completing activities. Coins have no monetary value, cannot be purchased, sold, transferred or redeemed for cash, and exist purely as an in-app motivation mechanic. We may adjust balances or mechanics to fix bugs, prevent abuse or maintain game integrity.</P>
      </Section>

      <Section title="6. Health & Wellness Disclaimer">
        <P><strong>Vantage is not a medical device and does not provide medical advice.</strong></P>
        <Ul items={[
          'Nutrition figures (including AI food-scanner estimates and third-party food databases) are estimates and may be inaccurate.',
          'Vitals and fitness metrics from WHOOP, an Oura Ring or manual entry are for general wellness information only.',
          'AI-generated content (the daily brief, food identification) and the coach\'s rule-based tips can be wrong. Never rely on them for medical, dietary or mental-health decisions.',
          'Always consult a qualified professional before changing your diet, exercise, or health regimen — and never disregard professional advice because of something shown in the App.',
          'If you may be experiencing a medical emergency, call emergency services immediately.',
        ]} />
      </Section>

      <Section title="7. Social Features & Acceptable Use">
        <P>Vantage includes friends, direct messages, handles, and a leaderboard. You agree not to:</P>
        <Ul items={[
          'Use the App for any unlawful purpose, or to harass, abuse, threaten, defame or impersonate anyone — including via messages, handles, display names or item names.',
          'Post content that is hateful, sexually explicit, infringing, or that exposes another person\'s private information.',
          'Attempt to access another user\'s account or data, or to circumvent privacy controls.',
          'Reverse-engineer, decompile or extract the App\'s source code, or use bots/scripts to scrape or interact with the App.',
          'Manipulate the leaderboard or coins through fake accounts or automated activity.',
        ]} />
        <P>These rules apply to everything other people can see: display names, @handles, profile pictures, messages, group names and group pictures.</P>
      </Section>

      <Section title="7a. Reporting, Blocking & Moderation">
        <Ul items={[
          'Report — you can report a person from their friend card, from a conversation, from a leaderboard row or from a group\'s member list. Reports are private: the person reported is not told who reported them.',
          'Block — blocking removes the person from your friends, stops them messaging you and stops them sending you friend requests.',
          'Review — every report is reviewed by a person. We aim to act within 24 hours. Group pictures and profile pictures are also screened automatically before others see them, and held back if the screen is unsure.',
          'Action — depending on what we find we may remove or reset content (for example a display name, handle or group picture), hide an account from the leaderboard, search and group boards, suspend it, or close it. Serious or repeated breaches lead to permanent closure. Content that may be illegal can be reported to the police or other authorities.',
          'Evidence — a report, with a copy of the reported handle and display name and any messages attached to it, may be kept after the account involved is deleted, so that repeat abuse can be recognised. Closed reports are deleted 12 months after they are closed.',
          <>Disagree with a decision? Email <ContactEmail address={SUPPORT_EMAIL} subject="Moderation decision" /> (see <PageLink to="support" go={go}>Support</PageLink>) and we will look at it again.</>,
        ]} />
      </Section>

      <Section title="8. Your Content">
        <P>You own the content you create in the App. You grant us a limited, worldwide, royalty-free licence to host, store, transmit and display it solely to operate the service — including showing your shared items to friends and the leaderboard according to your privacy settings. The licence ends when you delete the content or your account, except for anonymised aggregates that contain no personal data.</P>
      </Section>

      <Section title="9. Third-Party Services">
        <P>Optional integrations (WHOOP, Oura, Google / Apple sign-in, Open Food Facts) are provided by third parties under their own terms and privacy policies. We are not responsible for third-party services, and integrations may change or become unavailable if a provider changes its API.</P>
      </Section>

      <Section title="10. App Store & Google Play">
        <P>If you downloaded the App from Apple's App Store or Google Play, the following also applies:</P>
        <Ul items={[
          'These terms are between you and us — not with Apple or Google. Apple and Google have no obligation to provide maintenance or support for the App.',
          'Apple and Google are not responsible for addressing any claims relating to the App (including product liability, legal compliance or IP claims).',
          'Apple (and its subsidiaries) is a third-party beneficiary of these terms and may enforce them against you.',
          'You confirm you are not located in a country subject to a relevant government embargo and are not on any restricted-parties list.',
          'To the extent these terms conflict with Apple\'s or Google\'s mandatory store terms, the store terms prevail for purchases made through that store.',
        ]} />
      </Section>

      <Section title="11. Availability & Changes">
        <P>We aim for high availability but do not guarantee uninterrupted access. We may update, add, or remove features at any time, and will give reasonable notice of significant changes where possible. We may discontinue the service entirely with reasonable notice, in which case you will be able to export your data first.</P>
      </Section>

      <Section title="12. Intellectual Property">
        <P>The Vantage name, logo, design and underlying code are our intellectual property. Nothing in these terms grants you any rights in them beyond using the App as intended.</P>
      </Section>

      <Section title="13. Disclaimers">
        <P>The App is provided "as is" and "as available" without warranty of any kind, to the extent permitted by law. We do not warrant that the App will be error-free, secure, or meet your specific requirements. If you are a consumer, nothing in this section affects your statutory rights — including that a digital service must be as described, fit for purpose and of satisfactory quality.</P>
      </Section>

      <Section title="14. Limitation of Liability">
        <P>To the maximum extent permitted by law, our total liability for any claim arising from your use of the App is limited to the greater of £50 or the amount you paid us in the 12 months before the claim. We are not liable for loss of data (export regularly), lost profits, or indirect or consequential damages.</P>
        <P>Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, for fraud or fraudulent misrepresentation, or for anything else that cannot lawfully be excluded.</P>
      </Section>

      <Section title="15. Termination">
        <P>You may close your account at any time in Settings (Settings → Account → Delete account; see <PageLink to="delete-account" go={go}>Delete your account</PageLink>), which deletes your data as described in the Privacy Policy. We may suspend or terminate accounts that violate these terms, with notice where reasonably possible. Sections that by their nature should survive termination (your content licence for anonymised aggregates, disclaimers, liability limits, governing law) survive.</P>
      </Section>

      <Section title="16. Changes to These Terms">
        <P>We may update these terms from time to time. We will notify registered users of material changes in-app before they take effect; continued use after that constitutes acceptance. If you do not agree, stop using the App and close your account.</P>
      </Section>

      <Section title="17. Governing Law">
        <P>These terms are governed by the law of England and Wales, and disputes are subject to the exclusive jurisdiction of the courts of England and Wales — except that if you are a consumer resident elsewhere in the UK or EU, you keep the benefit of any mandatory consumer protections, and may bring proceedings, in your country of residence.</P>
        <Updated />
      </Section>
    </>
  );
}

// ── Main LegalPage overlay ───────────────────────────────────────────────
// Publicly reachable pre-auth: App.jsx opens this for /privacy, /terms
// (and #privacy / #terms) so app-store listings can link straight to it.
export default function LegalPage({ page, onClose, onNavigate }) {
  // Internal doc switcher — seeded from the prop, but self-managed so the
  // Privacy ↔ Terms toggle actually swaps content (the old version only
  // set location.hash, which never re-rendered anything).
  const [active, setActive] = useState(page === 'terms' ? 'terms' : 'privacy');

  // Trap scroll to the overlay
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isPrivacy = active === 'privacy';

  function switchTo(key) {
    setActive(key);
    // Keep the URL shareable/bookmarkable without a reload.
    try { window.history.replaceState(null, '', `/${key}`); } catch { /* no-op */ }
    // Tell the host (PublicPage) so the tab title follows.
    onNavigate?.(key);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(10,12,18,0.96)',
      backdropFilter: 'blur(12px)',
      overflowY: 'auto',
      fontFamily: 'var(--sans, DM Sans, sans-serif)',
    }}>
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '40px 24px 80px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
          <div>
            <div style={{ fontFamily: 'var(--mono, DM Mono, monospace)', fontSize: 'var(--fs-floor)', letterSpacing: '2px', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Vantage
            </div>
            <h1 style={{ fontFamily: 'var(--serif, Playfair Display, serif)', fontSize: '26px', fontWeight: 700, color: '#fff', margin: 0 }}>
              {isPrivacy ? 'Privacy Policy' : 'Terms of Service'}
            </h1>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)',
              borderRadius: '10px', color: 'rgba(255,255,255,.7)', cursor: 'pointer',
              fontSize: '13px', padding: '8px 16px', fontFamily: 'var(--sans)',
            }}
          >
            ← Back
          </button>
        </div>

        {/* Toggle between docs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
          {[['privacy', 'Privacy Policy'], ['terms', 'Terms of Service']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => switchTo(key)}
              style={{
                padding: '7px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', transition: 'all .15s', fontFamily: 'var(--sans)',
                background: active === key ? 'var(--em, #1a7a4a)' : 'rgba(255,255,255,.07)',
                color: active === key ? '#fff' : 'rgba(255,255,255,.5)',
                border: `1px solid ${active === key ? 'var(--em, #1a7a4a)' : 'rgba(255,255,255,.12)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isPrivacy ? <PrivacyPolicyContent go={onNavigate} /> : <TermsContent go={onNavigate} />}
      </div>
    </div>
  );
}
