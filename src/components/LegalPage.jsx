import { useEffect, useState } from 'react';

// ── Shared prose wrapper ─────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <h2 style={{ fontFamily: 'var(--serif, Playfair Display, serif)', fontSize: '16px', fontWeight: 700, color: 'var(--text, #e8eaf0)', margin: '0 0 10px', borderBottom: '1px solid rgba(255,255,255,.1)', paddingBottom: '8px' }}>
        {title}
      </h2>
      <div style={{ fontSize: '13px', lineHeight: 1.75, color: 'rgba(232,234,240,.8)', fontFamily: 'var(--sans, DM Sans, sans-serif)' }}>
        {children}
      </div>
    </div>
  );
}

function P({ children }) {
  return <p style={{ margin: '0 0 10px' }}>{children}</p>;
}

function Ul({ items }) {
  return (
    <ul style={{ margin: '6px 0 10px 18px', padding: 0 }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom: '5px' }}>{item}</li>)}
    </ul>
  );
}

const LAST_UPDATED = '2 October 2026';

function Updated() {
  return (
    <P>
      <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'rgba(255,255,255,.4)' }}>
        Last updated: {LAST_UPDATED}
      </span>
    </P>
  );
}

// Placeholders still to be filled in before launch. Styled so nobody can
// mistake one for finished text — a policy that quietly says "[Company
// name]" in body type reads as an oversight; this reads as a TODO.
function Todo({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: '12px', padding: '1px 5px', borderRadius: '4px',
      background: 'rgba(200,151,10,.16)', color: '#e0b43c', border: '1px dashed rgba(200,151,10,.5)',
    }}>{children}</span>
  );
}

function Mono({ children }) {
  return <span style={{ fontFamily: 'var(--mono)', color: 'var(--em-light, #4dc485)' }}>{children}</span>;
}

// ── Privacy Policy ───────────────────────────────────────────────────────
// Section 8 is written from the code, not from memory: every host listed
// is one the app or its Netlify functions actually contact (grep
// netlify/ and src/ for https:// when adding a provider, and add it here
// in the same change). It separates what your DEVICE contacts directly —
// which hands that provider your IP address — from what our functions
// contact on your behalf, which does not.
function PrivacyPolicyContent() {
  return (
    <>
      <Section title="1. Who We Are">
        <P>Vantage ("the App", "we", "us") is a personal productivity, goal-tracking and wellness application, available on the web and as a mobile app. The data controller for personal data processed through the App is <Todo>[Company name, registered address — to be completed on incorporation]</Todo>.</P>
        <P>For any privacy question or request, contact us at the support email shown on the App's store listing, or via Settings inside the App. To report a security vulnerability, email <Todo>security@[domain — to be confirmed]</Todo>. This policy is written for users in the United Kingdom and European Economic Area, but it applies to everyone who uses the App.</P>
      </Section>

      <Section title="2. Data We Collect">
        <P>We collect only what is needed to provide the service:</P>
        <Ul items={[
          'Account data — your email address, used to create and authenticate your account.',
          'Profile & social data (optional) — a display name, a unique @handle you may claim, a profile picture, your level and ratings, and — if you enable them — an activity streak, a 91-day activity heatmap, recent achievement wins, and an online-status indicator. See section 6 for who can see what.',
          'User-generated content — boards, trackers, achievements, shopping wish-list items, savings pots, holiday plans, habit entries, notes, group names and group pictures you create inside the App.',
          'Direct messages — messages you exchange with accepted friends are stored in our database so they can be delivered and shown in your conversation history. They are transmitted over TLS but are not end-to-end encrypted; treat them like email, not like a sealed letter.',
          'Nutrition data — food log entries, macro targets and goals you record, stored in our database and linked to your account.',
          'Health & fitness data (optional, with your explicit consent) — vitals you enter yourself, and, if you connect WHOOP, connect an Oura Ring, or import Apple Health data, daily metrics such as sleep duration, resting heart rate, heart-rate variability, recovery/readiness score, strain, energy expenditure (calories) and workout summaries. See section 3.',
          'Reports and blocks — if you report or block someone, we store who reported whom, the reason you chose and any note you add. A report can include a copy of the reported person\'s handle and display name at the time, and recent messages from them if you report from a conversation.',
          'Payment & subscription data — if you purchase Vantage Pro, the purchase is processed by Apple (App Store), Google (Google Play) and RevenueCat. We receive your subscription status and a transaction reference. We never receive or store your card number.',
          'Device & notification data — if you enable push notifications, we store a device push token so notifications can be delivered via Apple/Google push services (Firebase Cloud Messaging).',
          'Camera images (Pro, optional) — if you use the AI food scanner, a single camera frame is sent to Anthropic\'s API to identify the food (section 7). We do not store the image.',
          'Approximate location — to show local weather, our server looks up the approximate city for your IP address (section 8). We do not store the result against your account, and we never collect precise (GPS) location.',
          'Third-party sign-in data (optional) — if you sign in with Google or Apple, we receive a minimal profile from that provider (section 9).',
          'Session data — a session token kept by our authentication provider to keep you signed in.',
          'Preferences — colour scheme, background and similar choices, stored in your browser\'s / device\'s localStorage and in your account.',
          'Anonymous performance measurements (web app only) — on about one page load in five, the browser measures how quickly the page loaded and responded and sends us those timings with the page path and a coarse device type (phone, tablet or desktop); they are stored without your account, IP address or any other identifier and are used only to find and fix slow pages.',
          'Problem reports — if you use Settings → Report a problem, we store what you write, the category you choose and the page you were on, linked to your account so we can follow up.',
        ]} />
        <P>We do not collect precise location data, biometric identification data, advertising identifiers, contact lists or purchase history. We use no advertising or analytics trackers.</P>
      </Section>

      <Section title="3. Health Data & Your Explicit Consent">
        <P>Vitals, sleep, heart-rate and nutrition information are health data — "special category" data under UK GDPR. We ask for your explicit consent to health data on a consent screen that every account sees once, and again before you connect WHOOP or an Oura Ring or turn on Apple Health import — no connected source is set up without it. Saying no is fine: features that do not need health data keep working, and anything you choose to type in yourself (such as a weight or a meal) is still saved to your account and shown only to you.</P>
        <Ul items={[
          'You can withdraw consent at any time in Settings → Privacy → Consent. To stop a connected source sending anything further, also use Disconnect on its WHOOP or Oura panel (this immediately deletes that device’s stored access tokens) or turn off Apple Health sync. You can delete individual entries or your whole account at any time; metrics already recorded stay in your history until you do.',
          'Health data is used solely to show you your own trends, widgets and (if you use it) the daily AI brief. It is never shown to other users, never used for advertising, and never sold.',
          'WHOOP and Oura data is fetched from their respective APIs under your OAuth authorisation; Apple Health data only ever reaches us when you explicitly export or sync it.',
        ]} />
      </Section>

      <Section title="4. Legal Bases for Processing">
        <Ul items={[
          'Performance of a contract — your email, account and app content are processed to deliver the service you signed up for.',
          'Explicit consent — health & fitness data (section 3), AI features (section 7) and push notifications. You can withdraw consent at any time without affecting the rest of the App.',
          'Legitimate interests — storing preferences, keeping the service secure, screening uploaded group pictures and profile pictures, handling reports and preventing abuse of social features.',
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
        ]} />
      </Section>

      <Section title="7. AI Features (Anthropic)">
        <P>These optional features send data to Anthropic's API, our AI provider. We ask for your consent before the first one runs, and you can withdraw it in Settings → Privacy → Consent:</P>
        <Ul items={[
          'AI food scanner (Pro) — one camera frame per scan, used to identify the food and estimate nutrition.',
          'Daily brief / AI coach — a compact snapshot of your own App data (e.g. first name, recent habits, trackers, goals, vitals and macro trends) is sent to generate your personal daily brief.',
          'Recipe from a video — the title and description of a YouTube or TikTok video you save are sent to extract the ingredient list and estimate macros.',
        ]} />
        <P>Separately, and not optional: when a group picture is uploaded, or before your profile picture is shown to other people, the image is sent to Anthropic's API to screen it for content that breaks the Terms. Until a picture passes, other people see your initial instead; the picture itself stays on your account. This is done on the basis of legitimate interests (keeping the App safe).</P>
        <P>In each case the data is sent to Anthropic's API to generate the result and is handled by Anthropic under its commercial terms, under which data sent via the API is not used to train their models. We do not store the camera frame or the snapshot we send; the result (for example your brief) is saved in your account. If you never use the optional features, none of your data is sent to Anthropic by them. AI output can be wrong — see the Terms of Service health disclaimer.</P>
      </Section>

      <Section title="8. Third Parties (Processors and Services We Contact)">
        <P><strong>Providers that run the App</strong> (they process your personal data on our behalf):</P>
        <Ul items={[
          'Supabase — database and authentication, hosted in the EU. Stores your account, app content, messages, nutrition and health data.',
          'Netlify — web hosting and the serverless functions that power sync, leaderboards, groups and integrations. Receives your IP address when you use the App.',
          'Anthropic — AI features and screening of group and profile pictures, as described in section 7.',
          'RevenueCat, Apple and Google — subscription billing and entitlement management for Vantage Pro. Payment details are handled by the platform you purchase through.',
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
          'YouTube (Google) and TikTok — when you save a cooking video, the video\'s public page or oEmbed data is fetched to read its title and description.',
          'GNews — news headlines for the news widget, including any topic you search for.',
          'Finnhub — stock and market quotes for the ticker symbols you add to the market widget.',
          'Shop websites — when you paste a product link, or open Shopping, our server fetches that product page to read its name, image and current price.',
        ]} />
        <P><strong>Services your device contacts directly</strong> (these receive your IP address, as any website you load does):</P>
        <Ul items={[
          'Google Fonts — the App\'s typefaces.',
          'Google favicon service — small brand logos next to foods and shops; the brand\'s website name is sent.',
          'GitHub API — only if you add the GitHub widget: the GitHub username you enter is looked up to show that public profile and its repositories.',
          'YouTube image servers (i.ytimg.com) — thumbnails for cooking videos you save.',
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
          'Account & content — retained while your account is active. Delete your account at any time via Settings → Account → Delete account; your login and all associated data are permanently erased within 30 days.',
          'History snapshots — to recover from accidental loss, we automatically keep up to 14 daily copies of your app data (without images). Older copies are replaced as new ones are made, and all of them are deleted with your account.',
          'WHOOP and Oura tokens — deleted immediately when you disconnect that device.',
          'Direct messages — retained until you delete them or your account.',
          'Reports — a report you make, or one made about you, may be kept after the account involved is deleted, only as long as needed to deal with it and with repeat abuse.',
          'Problem reports — kept until the problem is dealt with; if you delete your account first, the report loses its link to you.',
          'Camera frames & AI snapshots — not stored by us; discarded after each request.',
          'Subscriptions — deleting your account does not cancel an App Store or Google Play subscription; cancel it in the store.',
          'Data export — you can export your data at any time in Settings → Account.',
        ]} />
      </Section>

      <Section title="12. Security">
        <P>All data is encrypted in transit (TLS). Database access is protected by row-level security so users can only read what they are entitled to; server-side keys never ship in the app. No system is perfectly secure — if we become aware of a breach affecting your personal data we will notify you and the ICO as required by law. To report a vulnerability, email <Todo>security@[domain — to be confirmed]</Todo>.</P>
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
function TermsContent() {
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
        ]} />
      </Section>

      <Section title="5. Coins & Virtual Items">
        <P>The App awards virtual coins and similar in-app items for completing activities. Coins have no monetary value, cannot be purchased, sold, transferred or redeemed for cash, and exist purely as an in-app motivation mechanic. We may adjust balances or mechanics to fix bugs, prevent abuse or maintain game integrity.</P>
      </Section>

      <Section title="6. Health & Wellness Disclaimer">
        <P><strong>Vantage is not a medical device and does not provide medical advice.</strong></P>
        <Ul items={[
          'Nutrition figures (including AI food-scanner estimates and third-party food databases) are estimates and may be inaccurate.',
          'Vitals and fitness metrics from WHOOP, an Oura Ring, Apple Health or manual entry are for general wellness information only.',
          'AI-generated content (the daily brief, coach suggestions, food identification) can be wrong. Never rely on it for medical, dietary or mental-health decisions.',
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
          'Evidence — a report, with a copy of the reported handle and display name and any messages attached to it, may be kept after the account involved is deleted, so that repeat abuse can be recognised.',
          'Disagree with a decision? Contact us via the support address on the store listing and we will look at it again.',
        ]} />
      </Section>

      <Section title="8. Your Content">
        <P>You own the content you create in the App. You grant us a limited, worldwide, royalty-free licence to host, store, transmit and display it solely to operate the service — including showing your shared items to friends and the leaderboard according to your privacy settings. The licence ends when you delete the content or your account, except for anonymised aggregates that contain no personal data.</P>
      </Section>

      <Section title="9. Third-Party Services">
        <P>Optional integrations (WHOOP, Oura, Apple Health, Google / Apple sign-in, Open Food Facts) are provided by third parties under their own terms and privacy policies. We are not responsible for third-party services, and integrations may change or become unavailable if a provider changes its API.</P>
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
        <P>You may close your account at any time in Settings (Settings → Account → Delete account), which deletes your data as described in the Privacy Policy. We may suspend or terminate accounts that violate these terms, with notice where reasonably possible. Sections that by their nature should survive termination (your content licence for anonymised aggregates, disclaimers, liability limits, governing law) survive.</P>
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
export default function LegalPage({ page, onClose }) {
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
            <div style={{ fontFamily: 'var(--mono, DM Mono, monospace)', fontSize: '10px', letterSpacing: '2px', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', marginBottom: '4px' }}>
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
        {isPrivacy ? <PrivacyPolicyContent /> : <TermsContent />}
      </div>
    </div>
  );
}
