import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import {
  previewInvite, acceptInvite, rememberPendingInvite, peekPendingInvite, takePendingInvite,
} from '../../lib/friends/invites';
import './friends-dm.css';

/**
 * /invite/<code> — what a friend sees when they open your link.
 *
 * Deep-links before sign-in, like /privacy: the inviter's card and one
 * button. Signed out, the button parks the code (rememberPendingInvite,
 * sessionStorage) and goes through sign-in/sign-up; App brings the
 * visitor back here, and the request is sent without a second tap. It
 * lands in the inviter's pending list marked "via your invite"; they
 * still accept it.
 *
 * Anything that is not a live, usable code — expired, revoked, blocked
 * either way, a suspended inviter — gets the same calm message. Which of
 * those it was is nobody's business but the inviter's.
 */

const COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return COLORS[h % COLORS.length];
}

const GONE = new Set(['invalid', 'revoked', 'expired', 'unavailable']);

export default function InviteLanding({ code, session, onSignIn, onDone }) {
  const [preview, setPreview] = useState({ state: 'loading' }); // loading | ok | gone | off
  const [phase, setPhase] = useState('idle');                   // idle | sending | sent | note
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const autoTried = useRef(false);
  const signedIn = !!session;

  useEffect(() => {
    let cancelled = false;
    setPreview({ state: 'loading' });
    previewInvite(code).then(res => {
      if (cancelled) return;
      if (res?.ok) setPreview({ state: 'ok', inviter: res.inviter, relationship: res.relationship || 'none' });
      else if (res?.reason === 'not_configured') setPreview({ state: 'off' });
      else setPreview({ state: 'gone' });
    });
    return () => { cancelled = true; };
  }, [code, signedIn]);

  const inviter = preview.inviter || null;
  const name = inviter?.name || 'your friend';
  const first = name.replace(/^@/, '').split(' ')[0];

  async function accept() {
    if (!signedIn) { rememberPendingInvite(code); onSignIn?.(); return; }
    setPhase('sending'); setErr('');
    const res = await acceptInvite(code);
    if (res?.ok) { setPhase('sent'); return; }
    const r = res?.reason || 'error';
    setPhase('idle');
    if (r === 'signed_out') { rememberPendingInvite(code); onSignIn?.(); return; }
    if (GONE.has(r)) { setPreview({ state: 'gone' }); return; }
    if (r === 'already_requested') { setPhase('sent'); return; }
    if (r === 'self') { setPhase('note'); setNote('That\'s your own invite link — send it to a friend.'); return; }
    if (r === 'already_friends') { setPhase('note'); setNote(`You and ${first} are already friends.`); return; }
    if (r === 'incoming_request') { setPhase('note'); setNote(`${first} has already sent you a request — accept it under Friends.`); return; }
    if (r === 'throttled') { setErr('You\'ve sent a lot of friend requests today. Try again tomorrow.'); return; }
    if (r === 'not_configured') { setPreview({ state: 'off' }); return; }
    setErr(res?.message || 'Couldn\'t send the request. Check your connection and try again.');
  }

  // Back from sign-in with the button already pressed: finish the job.
  useEffect(() => {
    if (!signedIn || autoTried.current || preview.state !== 'ok') return;
    if (peekPendingInvite() === code) {
      autoTried.current = true;
      takePendingInvite();
      if (preview.relationship === 'none') accept();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, preview.state, code]);

  function done() { takePendingInvite(); onDone?.(); }

  // What the preview already knows about the two of you (signed in).
  const rel = signedIn && preview.state === 'ok' ? preview.relationship : 'none';
  const relNote = {
    self: 'This is your own invite link. Send it to a friend — when they open it, they can add you in one tap.',
    friends: `You and ${first} are already friends.`,
    outgoing: `Your request is with ${first} — they'll see it under Friends.`,
    incoming: `${first} has already sent you a request — accept it under Friends.`,
  }[rel];

  let content;
  if (preview.state === 'loading') {
    content = <div className="inv-card-text" role="status">Opening your invite…</div>;
  } else if (preview.state === 'gone' || preview.state === 'off') {
    content = (
      <>
        <div className="inv-card-done-icon" aria-hidden="true"><Icon name="link" size={20} /></div>
        <div className="inv-card-done">
          {preview.state === 'off' ? 'Invite links aren\'t switched on yet.' : 'This invite link isn\'t available any more.'}
        </div>
        <p className="inv-card-text">
          {preview.state === 'off'
            ? 'Ask your friend for their @handle instead — you can search for it under Friends.'
            : 'It may have expired or been replaced with a new one. Ask your friend to send their latest link.'}
        </p>
        <button type="button" className="btn btn-primary" onClick={done}>{signedIn ? 'Open Vantage' : 'Go to Vantage'}</button>
      </>
    );
  } else if (phase === 'sent') {
    content = (
      <>
        <div className="inv-card-done-icon" aria-hidden="true"><Icon name="check" size={22} /></div>
        <div className="inv-card-done" role="status">Request sent — {first} will see it.</div>
        <p className="inv-card-text">You'll show up as friends once {first} accepts. Then you can message each other and compare progress.</p>
        <button type="button" className="btn btn-primary" onClick={done}>Open Vantage</button>
      </>
    );
  } else {
    content = (
      <>
        {inviter?.avatarUrl
          ? <img className="inv-card-avatar" src={inviter.avatarUrl} alt="" />
          : <div className="inv-card-avatar" style={{ background: avatarColor(name) }} aria-hidden="true">{name.replace(/^@/, '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}</div>}
        <div className="inv-card-name">{name}</div>
        {inviter?.handle && <div className="inv-card-handle">@{inviter.handle}</div>}
        {inviter?.level != null && <div className="inv-card-level">Level {inviter.level}</div>}
        {phase === 'note' || relNote ? (
          <>
            <p className="inv-card-text" role="status">{phase === 'note' ? note : relNote}</p>
            <button type="button" className="btn btn-primary" onClick={done}>Open Vantage</button>
          </>
        ) : (
          <>
            <p className="inv-card-text"><strong>{first}</strong> invited you to be friends on Vantage — track habits, health and money, and keep each other going.</p>
            <button type="button" className="btn btn-primary" onClick={accept} disabled={phase === 'sending'}>
              {phase === 'sending' ? 'Sending request…' : `Add ${first} as a friend`}
            </button>
            {!signedIn && (
              <p className="inv-card-text" style={{ margin: '10px 0 0', fontSize: 13 }}>You'll sign in or create an account first, then come straight back.</p>
            )}
            {err && <div className="inv-card-err" role="alert">{err}</div>}
            <button type="button" className="btn btn-ghost inv-card-secondary" onClick={done}>Not now</button>
          </>
        )}
      </>
    );
  }

  return (
    <main className="inv-landing">
      <div className="inv-card">
        <div className="inv-card-eyebrow">Vantage · Invite</div>
        {content}
      </div>
    </main>
  );
}

/** Shown over the sign-in screen while an invite is waiting. */
export function InvitePill({ onCancel }) {
  return (
    <div className="inv-pill" role="status">
      <span>Sign in to finish adding your friend</span>
      <button type="button" onClick={onCancel} aria-label="Cancel invite"><Icon name="x" size={13} /></button>
    </div>
  );
}
