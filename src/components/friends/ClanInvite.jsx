/**
 * Inviting a friend to your clan from the conversation you are already
 * having with them, and joining from the invite they sent you.
 *
 * Both halves are separate components on purpose. MessagesModal runs all
 * its hooks before its `!open` early return, so anything it calls at the
 * top level runs for every mounted thread whether or not it is on
 * screen. Loading the league board on every app start to render a menu
 * item nobody has opened would be a poor trade. These mount only when
 * the menu is opened or when an invite is actually in the thread, and
 * the 45s board cache means the usual case is not a request at all.
 */
import { useState } from 'react';
import { useGroups } from '../../hooks/useGroups';
import { joinByCode } from '../../lib/groups/api';
import { formatInvite } from '../../lib/friends/clanInvite';

/**
 * The menu item. Renders only while the ⋯ menu is open, which is what
 * makes the board fetch lazy.
 */
export function ClanInviteMenuItem({ onInvite, disabled }) {
  const { data, loading } = useGroups();
  const group = data?.group || null;

  if (loading) {
    return <div className="fc-menu-item is-quiet" role="none">Checking your clan…</div>;
  }
  // Not set up on this server, or not in a clan: say which, rather than
  // showing a dead button or silently hiding the feature.
  if (data && data.setup === false) return null;
  if (!group) {
    return (
      <div className="fc-menu-item is-quiet" role="none">
        Join a clan to invite friends
      </div>
    );
  }

  const body = formatInvite(group);
  if (!body) return null;

  return (
    <button
      type="button"
      role="menuitem"
      className="fc-menu-item"
      disabled={disabled}
      onClick={() => onInvite(body, group)}
    >
      Invite to {group.name}
    </button>
  );
}

/**
 * An invite, in the thread.
 *
 * The sender sees what they sent. The recipient gets the button. Whether
 * they can actually join — already in a clan, clan full, code rotated
 * since — is the server's call, and whatever it says is shown verbatim
 * rather than guessed at here.
 */
export function ClanInviteBubble({ invite, mine, time }) {
  const [state, setState] = useState('idle');   // idle | joining | joined | error
  const [msg, setMsg] = useState('');

  async function join() {
    setState('joining');
    setMsg('');
    try {
      await joinByCode(invite.code);
      setState('joined');
    } catch (e) {
      setState('error');
      setMsg(e?.message || 'Could not join.');
    }
  }

  return (
    <div className={`msg-invite${mine ? ' mine' : ''}`}>
      <div className="msg-invite-head">
        <span className="msg-invite-icon" aria-hidden="true">⚔</span>
        <span className="msg-invite-title">{invite.name || 'A clan'}</span>
      </div>
      <div className="msg-invite-sub">
        {mine ? 'Clan invite sent' : 'You have been invited to this clan'}
      </div>

      {!mine && state !== 'joined' && (
        <button
          type="button"
          className="msg-invite-join"
          onClick={join}
          disabled={state === 'joining'}
        >
          {state === 'joining' ? 'Joining…' : 'Join clan'}
        </button>
      )}
      {state === 'joined' && <div className="msg-invite-done">Joined ✓</div>}
      {state === 'error' && <div className="msg-invite-err">{msg}</div>}

      {/* The code stays visible either way: it is the invite, and it
          still works if the button does not — pasted into the clan
          screen, or used on another device. */}
      <div className="msg-invite-code">code <b>{invite.code}</b></div>
      {time && <span className="msg-time">{time}</span>}
    </div>
  );
}
