import SettingsGroup from './SettingsGroup';
import { SupportLines } from '../friends/StayingSafe';
import { mutedList, unmuteUser } from '../../lib/friends/mutes';
import '../friends/friends-dm.css';

/**
 * Settings › Privacy › Staying safe (item 113).
 *
 * Two things the Codes ask a user to be able to find without hunting:
 *   · who they've muted, and a way to undo each one (ICU J1 user
 *     controls; ABUSE_HANDLING G-1). Mute itself lives on the friend card
 *     and the conversation's ⋯ menu; this is the list. There is no
 *     blocked list here — none exists anywhere in the app yet, and
 *     unblocking is out of scope for this change.
 *   · who to talk to and where to report (ICU F2 supportive information;
 *     G-2), the full set including Samaritans.
 *
 * Reads S.mutedUsers; Unmute removes one entry and nothing else. Names
 * are the snapshot taken when muting, so the list needs no profile read.
 */
const fmt = iso => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export default function StayingSafeCard({ S, update }) {
  const muted = mutedList(S?.mutedUsers);
  return (
    <SettingsGroup
      title="Staying safe"
      desc="Mute, report or block anyone from the ⋯ menu on their friend card or in your conversation. Muting and blocking are private, and a report never says who sent it."
    >
      <div className="safe-mute-head">Muted{muted.length ? ` · ${muted.length}` : ''}</div>
      {muted.length === 0 ? (
        <p className="safe-mute-empty">
          No one. Muting someone keeps their messages but stops the alerts and hides their activity — they aren&apos;t told.
        </p>
      ) : (
        <ul className="safe-mute-list">
          {muted.map(p => {
            const label = p.name || (p.handle ? `@${p.handle}` : 'Someone');
            const since = fmt(p.at);
            return (
              <li key={p.id} className="safe-mute-row">
                <span className="safe-mute-who">
                  <span className="safe-mute-name">{label}</span>
                  <span className="safe-mute-sub">
                    {p.handle && p.name ? `@${p.handle}` : ''}{p.handle && p.name && since ? ' · ' : ''}{since ? `muted ${since}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm safe-mute-btn"
                  onClick={() => update(prev => unmuteUser(prev, p.id))}
                  aria-label={`Unmute ${label}`}
                >
                  Unmute
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <SupportLines full title="Who to talk to" className="safe-lines-settings" />
    </SettingsGroup>
  );
}
