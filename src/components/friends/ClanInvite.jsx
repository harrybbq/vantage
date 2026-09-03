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
import { formatInvite, isClanMember } from '../../lib/friends/clanInvite';

/**
 * The menu item. Renders only while the ⋯ menu is open, which is what
 * makes the board fetch lazy.
 */
export function ClanInviteMenuItem({ onInvite, disabled, friendId, friendName }) {
  const { data, loading } = useGroups();
  const group = data?.group || null;
  const already = isClanMember(data?.members, friendId);

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

  // Already in it. Offering the invite would send a code that works and
  // then be refused by the server with "you are already in a group" —
  // a worse way to find out than simply not being offered it.
  if (already) {
    return (
      <div className="fc-menu-item is-quiet" role="none">
        {friendName ? `${friendName} is` : 'Already'} in {group.name}
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

      {/* The button is the way in. The code is deliberately NOT shown:
          it grants entry to the clan, and a card that displays it invites
          being screenshotted onward to people who were never invited.
          It reappears only if joining fails, as the manual way through. */}
      {state === 'error' && (
        <div className="msg-invite-code">
          or enter <b>{invite.code}</b> on the Clan screen
        </div>
      )}
      {time && <span className="msg-time">{time}</span>}
    </div>
  );
}
