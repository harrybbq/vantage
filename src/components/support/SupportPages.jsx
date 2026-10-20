import { useEffect, useRef } from 'react';
import { Section, P, Ul, Todo, PageLink, LINK_COLOR } from '../LegalPage';
import { SUPPORT_EMAIL, SECURITY_EMAIL, mailtoHref } from '../../lib/support';

/**
 * /support and /delete-account — public, pre-auth, and reachable in-app.
 *
 * Both stores require a support URL; Google Play also requires a web page
 * where someone who no longer has the app can ask for their account and
 * data to be deleted (STARTUP_REQUIREMENTS items 72 and 74).
 *
 * EVERY CLAIM HERE IS WRITTEN FROM THE CODE OR THE POLICY. When the
 * behaviour changes, change this page in the same commit:
 *   · deletion   — netlify/functions/delete-account.js (cascade, Storage,
 *                  RevenueCat, group hand-over), SettingsSection
 *                  handleDeleteAccount (two confirms, local clear-down),
 *                  supabase/audit_schema_2026_10.sql (reports and
 *                  crash reports survive, unlinked), privacy policy §11
 *   · reply times — Terms §7a (24 h, reports), Privacy §14 (one month,
 *                  data rights), SECURITY.md (3 working days). Do not add
 *                  a promise here that those don't already make.
 *   · FAQ        — the Settings panels and labels each answer names.
 *
 * Styling follows LegalPage (same overlay, header, section rules), on a
 * solid surface with fixed colours, so it reads the same pre-auth, in
 * Cream and in Dark OS. Targets are at least 44 px; text at least 12 px.
 *
 * This page never deletes anything. Signed in, its button opens Settings
 * → Account at the existing Delete account group (onOpenSettings).
 */

const C = {
  bg: '#0b0d13',
  card: '#151924',
  border: 'rgba(255,255,255,.12)',
  text: '#e8eaf0',
  body: 'rgba(232,234,240,.84)',
  muted: 'rgba(232,234,240,.62)',
  em: '#1a7a4a',
};

const btnBase = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
  minHeight: '44px', padding: '10px 18px', borderRadius: '10px', boxSizing: 'border-box',
  fontFamily: 'var(--sans, DM Sans, sans-serif)', fontSize: '14px', fontWeight: 600,
  cursor: 'pointer', textDecoration: 'none', maxWidth: '100%', textAlign: 'center',
};
const BTN = {
  primary: { ...btnBase, background: C.em, color: '#fff', border: `1px solid ${C.em}` },
  ghost: { ...btnBase, background: 'rgba(255,255,255,.08)', color: C.text, border: '1px solid rgba(255,255,255,.2)' },
  danger: { ...btnBase, background: 'rgba(220,38,38,.18)', color: '#fecaca', border: '1px solid rgba(248,113,113,.55)' },
};

// Page-level links are <div role="navigation">, not <nav>: index.css
// styles the bare `nav` element as the app's fixed top bar.
const NAV = [
  ['support', 'Support'],
  ['delete-account', 'Delete account'],
  ['privacy', 'Privacy Policy'],
  ['terms', 'Terms of Service'],
];

export default function SupportPages({ page, signedIn, onClose, onNavigate, onOpenSettings, onSignIn }) {
  const headingRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // A page switch starts at the top, with focus on the new heading.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    headingRef.current?.focus({ preventScroll: true });
  }, [page]);

  const isDelete = page === 'delete-account';
  const go = key => onNavigate?.(key);

  return (
    <div
      ref={scrollRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000, background: C.bg,
        overflowY: 'auto', overflowX: 'hidden', color: C.body,
        fontFamily: 'var(--sans, DM Sans, sans-serif)',
      }}
    >
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '40px 20px 80px', boxSizing: 'border-box' }}>
        {/* Header — same shape as LegalPage's */}
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '24px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--mono, DM Mono, monospace)', fontSize: '12px', letterSpacing: '2px', color: C.muted, textTransform: 'uppercase', marginBottom: '4px' }}>
              Vantage
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              style={{ fontFamily: 'var(--serif, Playfair Display, serif)', fontSize: '26px', lineHeight: 1.2, fontWeight: 700, color: '#fff', margin: 0, outline: 'none' }}
            >
              {isDelete ? 'Delete your account' : 'Support'}
            </h1>
          </div>
          <button type="button" onClick={onClose} style={{ ...BTN.ghost, flexShrink: 0, fontWeight: 500, fontSize: '13px' }}>
            ← Back
          </button>
        </header>

        <div role="navigation" aria-label="Vantage help and legal pages" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '32px' }}>
          {NAV.map(([key, label]) => {
            const current = key === page;
            return (
              <a
                key={key}
                href={`/${key}`}
                aria-current={current ? 'page' : undefined}
                onClick={e => { e.preventDefault(); if (!current) go(key); }}
                style={{
                  ...btnBase, padding: '10px 14px', fontSize: '13px',
                  background: current ? C.em : 'rgba(255,255,255,.07)',
                  color: current ? '#fff' : C.body,
                  border: `1px solid ${current ? C.em : 'rgba(255,255,255,.14)'}`,
                }}
              >
                {label}
              </a>
            );
          })}
        </div>

        {isDelete
          ? <DeleteAccountContent signedIn={signedIn} go={go} onOpenSettings={onOpenSettings} onSignIn={onSignIn} />
          : <SupportContent signedIn={signedIn} go={go} onOpenSettings={onOpenSettings} onSignIn={onSignIn} />}
      </div>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Card({ children, label }) {
  return (
    <section
      aria-label={label}
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '18px', marginBottom: '28px', fontSize: '13px', lineHeight: 1.7 }}
    >
      {children}
    </section>
  );
}

function CardTitle({ children }) {
  return <h2 style={{ fontFamily: 'var(--serif, Playfair Display, serif)', fontSize: '17px', fontWeight: 700, color: C.text, margin: '0 0 8px' }}>{children}</h2>;
}

function Actions({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '6px 0 12px' }}>{children}</div>;
}

/** The address, as a mailto link — or a marked placeholder until it exists. */
function Email({ address, subject }) {
  const href = mailtoHref(address, subject);   // null while still a placeholder
  if (!href) return <Todo>{address}</Todo>;
  return <a href={href} style={{ color: LINK_COLOR, overflowWrap: 'anywhere' }}>{address}</a>;
}

function Strong({ children }) {
  return <strong style={{ color: C.text, fontWeight: 600 }}>{children}</strong>;
}

/** A question that opens. Native <details>, so it is keyboard- and reader-friendly for free. */
function Faq({ q, children }) {
  return (
    <details style={{ borderBottom: `1px solid ${C.border}` }}>
      <summary style={{ cursor: 'pointer', padding: '12px 0', lineHeight: '20px', fontSize: '14px', fontWeight: 600, color: C.text }}>
        {q}
      </summary>
      <div style={{ padding: '0 0 12px 18px', fontSize: '13px', lineHeight: 1.75, color: C.body }}>
        {children}
      </div>
    </details>
  );
}

function CancelInStore() {
  // Same wording as Settings → Account → Delete account (item 61).
  return (
    <>
      {' '}<Strong>iPhone:</Strong> Settings → your name → Subscriptions → Vantage → Cancel.
      {' '}<Strong>Android:</Strong> Google Play → profile icon → Payments &amp; subscriptions → Subscriptions → Vantage → Cancel.
    </>
  );
}

function MoreLinks({ go, items }) {
  return (
    <div role="navigation" aria-label="Related pages" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
      {items.map(([key, label]) => (
        <a
          key={key}
          href={`/${key}`}
          onClick={e => { e.preventDefault(); go(key); }}
          style={{ ...BTN.ghost, fontSize: '13px', fontWeight: 500 }}
        >
          {label}
        </a>
      ))}
    </div>
  );
}

// ── /support ─────────────────────────────────────────────────────────────

function SupportContent({ signedIn, go, onOpenSettings, onSignIn }) {
  return (
    <>
      <P>
        Help with Vantage on the web, iPhone or Android — for anyone using it, and for anyone who used to.
        Most questions are answered below; if yours isn&apos;t, here is how to reach the people who build it.
      </P>

      <Card label="Contact us">
        <CardTitle>Contact us</CardTitle>
        {signedIn ? (
          <>
            <p style={{ margin: '0 0 10px' }}>
              You&apos;re signed in, so the quickest way is <Strong>Report a problem</Strong> in Settings → Account.
              It goes straight to the people who build Vantage, linked to your account so we can follow up.
            </p>
            <Actions>
              <button type="button" style={BTN.primary} onClick={() => onOpenSettings?.('support')}>
                Open Report a problem
              </button>
            </Actions>
            <p style={{ margin: 0 }}>Prefer email? <Email address={SUPPORT_EMAIL} subject="Vantage support" /></p>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 10px' }}>
              Have an account? Sign in and use <Strong>Settings → Account → Report a problem</Strong> — it reaches us
              linked to your account, so we can follow up.
            </p>
            <Actions>
              <button type="button" style={BTN.primary} onClick={() => onSignIn?.('support')}>
                Sign in
              </button>
            </Actions>
            <p style={{ margin: 0 }}>
              Can&apos;t sign in, or don&apos;t have an account? Email <Email address={SUPPORT_EMAIL} subject="Vantage support" />.
              If it&apos;s about your account, write from the email address you signed up with.
            </p>
          </>
        )}

        <h3 style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: '16px 0 4px' }}>How quickly we reply</h3>
        <Ul items={[
          'Reports about another person — every report is reviewed by a person, and we aim to act within 24 hours.',
          'Requests about your personal data (a copy, a correction, erasure) — we respond within one month.',
          'Security vulnerabilities — acknowledged within 3 UK working days.',
          'Everything else — we read every report.',
        ]} />
      </Card>

      <Section title="Common questions">
        <Faq q="How do I connect WHOOP or an Oura Ring?">
          <P>
            Go to <Strong>Settings → Tools → Health &amp; sync</Strong> and tap <Strong>Connect WHOOP</Strong> or{' '}
            <Strong>Connect Oura Ring</Strong>, then approve access on their site. You&apos;ll be asked for consent to
            health data first.
          </P>
          <P>
            Once connected, Vantage syncs when you open the app or come back to it (at most every 10 minutes), and
            our servers sync once more each morning so overnight sleep and recovery arrive even if you don&apos;t
            open it. <Strong>Sync WHOOP</Strong> / <Strong>Sync Oura</Strong> fetches the latest now. Vitals flow into
            your Vitals &amp; Macros history; nothing you&apos;ve logged by hand is replaced.
          </P>
          <P>
            <Strong>Disconnect</Strong> deletes our stored access to that device straight away. Vitals already
            synced stay in your history.
          </P>
        </Faq>

        <Faq q="How do I get a copy of my data?">
          <P>
            <Strong>Settings → Account → Your data.</Strong> Choose a passphrase and download an encrypted file. The
            passphrase never leaves your device and we don&apos;t keep a copy, so if you lose it the file can&apos;t
            be opened — not by us either. A plain-text download is there too, behind a confirmation, and an
            encrypted export can be opened again in the same place.
          </P>
          <P>
            The file includes your app data (vitals, habits, trackers, savings, boards and settings), your food log,
            your profile, your friend list and your messages.
          </P>
        </Faq>

        <Faq q="How do I delete my account?">
          <P>
            <Strong>Settings → Account → Delete account</Strong>, then confirm twice. It is permanent. The{' '}
            <PageLink to="delete-account" go={go}>Delete your account</PageLink> page explains what is deleted,
            what is kept and why, and what to do if you no longer have the app.
          </P>
        </Faq>

        <Faq q="How do I cancel Vantage Pro?">
          <P>
            Pro is billed by Apple or Google, so it is cancelled in the store, not in Vantage — and deleting your
            account does not cancel it.<CancelInStore />
          </P>
          <P>
            Cancel at least 24 hours before it renews; Pro stays on until the end of the period you&apos;ve paid
            for. Refunds are handled by Apple or Google under their policies.
          </P>
        </Faq>

        <Faq q="I've changed phone or reinstalled. How do I get Pro back?">
          <P>
            Sign in to the same Vantage account. Then, in the iPhone or Android app, go to{' '}
            <Strong>Settings → Tools → Subscription → Restore purchases</Strong>, signed in to the same App Store or
            Google Play account you bought it with. Restore isn&apos;t available on the web.
          </P>
        </Faq>

        <Faq q="I've forgotten my password.">
          <P>
            On the sign-in screen, tap <Strong>Forgot password?</Strong>, enter your email, and we&apos;ll send a
            reset link. If you signed up with Google or Apple there is no Vantage password — use{' '}
            <Strong>Continue with Google</Strong> or <Strong>Continue with Apple</Strong> instead.
          </P>
        </Faq>

        <Faq q="Who can see my data?">
          <P>
            Your health data — vitals, sleep, heart rate, meals — is never shown to other people. What others can
            see is up to you in <Strong>Settings → Privacy</Strong>: being findable by @handle and appearing on the
            global leaderboard are both off by default for new accounts, and friends see only the parts of your
            profile card you&apos;ve turned on.
          </P>
          <P>
            Consent for health data and AI features can be withdrawn in <Strong>Settings → Privacy → Consent</Strong>.
            The <PageLink to="privacy" go={go}>Privacy Policy</PageLink> has the detail.
          </P>
        </Faq>

        <Faq q="Are my messages private?">
          <P>
            Direct messages are visible only to you and the person you&apos;re talking to. They are encrypted in
            transit but not end-to-end encrypted, so treat them like email rather than a sealed letter. If someone
            reports a conversation, recent messages from it are included in the report so we can see what happened.
          </P>
        </Faq>
      </Section>

      <Section title="Staying safe">
        <P>
          <Strong>Report someone</Strong> — on their friend card, tap <Strong>⋯ → Report</Strong>. In a conversation,
          tap <Strong>⋯ → Report abuse</Strong>. On a leaderboard or group row, tap the flag. The person isn&apos;t
          told who reported them. Every report is reviewed by a person, and we aim to act within 24 hours.
        </P>
        <P>
          <Strong>Block someone</Strong> — the same menus have <Strong>Block</Strong> (<Strong>Block user</Strong> in a
          conversation). Blocking removes them from your friends, stops them messaging you and stops them sending you
          friend requests.
        </P>
        <div
          role="note"
          style={{ background: 'rgba(220,38,38,.12)', border: '1px solid rgba(248,113,113,.45)', borderRadius: '12px', padding: '12px 14px', margin: '4px 0 10px', color: C.text }}
        >
          <Strong>In danger right now?</Strong> If you or someone else is in immediate danger, call 999 in the UK
          (112 in the EU) or your local emergency number. Vantage can&apos;t send help — report the account
          afterwards so we can act on it.
        </div>
      </Section>

      <Section title="Security">
        <P>
          Found a security problem? Email <Email address={SECURITY_EMAIL} subject="Security report" /> — please
          don&apos;t post it publicly. We acknowledge reports within 3 UK working days, and we won&apos;t take legal
          action over good-faith research. The same contact is published at{' '}
          <a href="/.well-known/security.txt" style={{ color: LINK_COLOR, overflowWrap: 'anywhere' }}>/.well-known/security.txt</a>.
        </P>
      </Section>

      <MoreLinks go={go} items={[['privacy', 'Privacy Policy'], ['terms', 'Terms of Service'], ['delete-account', 'Delete account']]} />
    </>
  );
}

// ── /delete-account ──────────────────────────────────────────────────────

function DeleteAccountContent({ signedIn, go, onOpenSettings, onSignIn }) {
  return (
    <>
      <P>
        You can delete your Vantage account, and the data that goes with it, at any time — from the app, or by
        asking us if you no longer have it.
      </P>

      <Card label="How to delete your account">
        <CardTitle>How to delete it</CardTitle>
        {signedIn ? (
          <>
            <p style={{ margin: '0 0 10px' }}>
              You&apos;re signed in. <Strong>Delete account</Strong> is in Settings → Account; you&apos;ll be asked
              to confirm twice. This page doesn&apos;t delete anything by itself.
            </p>
            <Actions>
              <button type="button" style={BTN.danger} onClick={() => onOpenSettings?.('delete')}>
                Go to Delete account
              </button>
            </Actions>
          </>
        ) : (
          <>
            <ol style={{ margin: '0 0 10px 20px', padding: 0 }}>
              <li style={{ marginBottom: '4px' }}>Sign in to Vantage — here on the web, or in the app.</li>
              <li style={{ marginBottom: '4px' }}>Open <Strong>Settings → Account → Delete account</Strong>.</li>
              <li>Confirm twice. You&apos;re signed out once it&apos;s done.</li>
            </ol>
            <Actions>
              <button type="button" style={BTN.primary} onClick={() => onSignIn?.('delete')}>
                Sign in to delete your account
              </button>
            </Actions>
            <p style={{ margin: '0 0 10px' }}>
              Forgotten your password? Use <Strong>Forgot password?</Strong> on the sign-in screen first.
            </p>
            <p style={{ margin: 0 }}>
              Can&apos;t sign in at all, or no longer have the app? Email{' '}
              <Email address={SUPPORT_EMAIL} subject="Delete my Vantage account" /> <Strong>from the email address on
              the account</Strong>, asking us to delete it — writing from that address is how we know the request is
              yours. We respond to data-protection requests within one month.
            </p>
          </>
        )}
      </Card>

      <Section title="Before you delete">
        <Ul items={[
          <>
            <Strong>Cancel Vantage Pro in the store first.</Strong> Deleting your account does not cancel an App
            Store or Google Play subscription.<CancelInStore />
          </>,
          <>
            <Strong>Want a copy?</Strong> Download your data from Settings → Account → Your data. After deletion
            there is nothing left to export.
          </>,
          <>
            <Strong>Groups you own</Strong> are handed to the member who has been in the group longest, so the group
            carries on for everyone else. If you are its only member, the group is deleted.
          </>,
        ]} />
      </Section>

      <Section title="What is deleted">
        <P>As soon as you confirm, your login is deleted, and with it everything stored against your account:</P>
        <Ul items={[
          'Your app data — boards, trackers, habits, achievements, savings, holidays, notes, vitals and settings — and the up to 14 daily history snapshots kept for recovery.',
          'Your profile: display name, @handle, profile picture and ratings.',
          'Your food log and nutrition history.',
          'Your friends, friend requests and blocks, and your direct messages in both directions — messages you sent disappear from the other person’s conversation too.',
          'Your push-notification tokens and your stored WHOOP and Oura connections.',
          'Files you uploaded to Vantage’s file storage, such as recipe photos.',
          'Your record at RevenueCat, our subscription provider.',
        ]} />
        <P>
          On the device you delete from, Vantage&apos;s local copy of your data and its offline caches are cleared
          too. The same email address can sign up again later, but only as a brand-new, empty account.
        </P>
      </Section>

      <Section title="What is kept, and why">
        <Ul items={[
          <>
            <Strong>Reports.</Strong> A report you made, or one made about you, may be kept after the account is
            deleted — for up to 12 months after the report is closed, to deal with it and with repeat abuse. It loses its link to your
            account but keeps a copy of the handle and display name it was about, and any messages attached to it
            (up to five from a reported conversation).
          </>,
          <>
            <Strong>Problem reports</Strong> you sent from Settings → Report a problem are kept until the problem is
            dealt with, without the link to you.
          </>,
          <>
            <Strong>Crash reports</Strong> the app sent automatically lose their link to your account. They hold the
            error details, the page and the browser type.
          </>,
        ]} />
      </Section>

      <Section title="When it happens">
        <Ul items={[
          <><Strong>Immediately</Strong> — your login and everything under “What is deleted”. You are signed out.</>,
          <>
            <Strong>Within 30 days</Strong> — any remaining copies, for example in our database provider&apos;s
            backups, are gone. The <PageLink to="privacy" go={go}>Privacy Policy</PageLink> (section 11) commits to
            permanent erasure within 30 days.
          </>,
        ]} />
      </Section>

      <Section title="What deleting doesn't do">
        <Ul items={[
          <>It doesn&apos;t cancel an App Store or Google Play subscription — cancel it in the store (above).</>,
          <>
            It doesn&apos;t remove Vantage from your WHOOP or Oura account. Our stored access is deleted, so we can
            no longer use it, but to take Vantage off your list of connected apps, do it in your WHOOP or Oura
            account.
          </>,
          <>
            It doesn&apos;t unlink Google or Apple sign-in on their side: Google Account → Security → Third-party
            apps → remove Vantage; or Apple ID → Sign in with Apple → Vantage → Stop using.
          </>,
        ]} />
      </Section>

      <MoreLinks go={go} items={[['support', 'Support'], ['privacy', 'Privacy Policy'], ['terms', 'Terms of Service']]} />
    </>
  );
}
