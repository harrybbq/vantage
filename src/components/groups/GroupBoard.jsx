/**
 * My Group — the week your group is having.
 *
 * ── What this is scoring ─────────────────────────────────────────────
 * The number at the top is the sum of how much every member's OVR GREW
 * since Monday, not the sum of their OVRs. That choice is the whole
 * feature: a group cannot win by recruiting one highly-rated person,
 * because a rating you already had is worth nothing this week, and a
 * member having a quiet month costs the group nothing rather than
 * dragging an average down. What is being ranked is effort, over seven
 * days, which is the only thing here anybody can actually do something
 * about today.
 *
 * The zone strip says the one thing you came to find out — are we going
 * up, staying, or going down — before any of the detail.
 */
import { useState } from 'react';
import Icon from '../Icon';
import InviteModal from './InviteModal';

const CATS = [
  { id: 'fitness', label: 'Fitness', color: '#1a7a4a' },
  { id: 'brain',   label: 'Brain',   color: '#2563eb' },
  { id: 'finance', label: 'Finance', color: '#c8970a' },
  { id: 'social',  label: 'Social',  color: '#7c3aed' },
];

const AVATAR_COLORS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d', '#854d0e'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  return (name || '?').replace(/^@/, '').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
const ordinal = n =>
  n == null ? '—' : n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

const ZONE = {
  promoted: {
    tone: 'up', glyph: '▲', title: 'In the promotion places',
    note: up => `Hold a top-three finish and the group moves up to ${up}.`,
  },
  relegated: {
    tone: 'down', glyph: '▼', title: 'In the relegation places',
    note: down => `The bottom three drop to ${down} when the week closes.`,
  },
  held: {
    tone: 'flat', glyph: '●', title: 'Safe — but not climbing',
    note: () => 'Nothing moves from here. Third place is what changes that.',
  },
};

export default function GroupBoard({ data, onLeave, onRename, onRotateCode, onKick, busy }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const group = data?.group;
  const members = data?.members || [];
  if (!group) return null;

  const split = data.group.split || { brain: 0, finance: 0, fitness: 0, social: 0 };
  const splitTotal = CATS.reduce((s, c) => s + (split[c.id] || 0), 0);
  const climbers = members.filter(m => m.counted > 0);
  const podium = climbers.slice(0, 3);
  const maxClimb = Math.max(1, ...members.map(m => m.counted || 0));
  const coins = data.coinAward || [300, 200, 100];

  const divisions = data.divisions || [];
  const nameOf = num => divisions.find(d => d.num === num)?.name || 'Iron';
  const zone = ZONE[group.zone] || ZONE.held;
  const zoneNote = group.zone === 'promoted' ? zone.note(nameOf(group.division - 1))
    : group.zone === 'relegated' ? zone.note(nameOf(group.division + 1))
    : zone.note();

  return (
    <>
      <div className="grp-wrap">
        {/* ── The group, and its week ── */}
        <div className="grp-card grp-hero">
          <div className="grp-hero-top">
            <div className="grp-crest" style={group.crestColor ? { background: group.crestColor } : undefined}>
              {initials(group.name)}
            </div>
            <div className="grp-hero-id">
              <div className="grp-hero-name">
                {group.name}
                <span className={`grp-div-badge is-d${group.division}`}>
                  Div {group.division} · {group.divisionName}
                </span>
              </div>
              {/* Not the position — the zone strip below says that, and
                  saying it twice in 40px makes the reader check whether
                  they are two different numbers. */}
              <div className="grp-hero-meta">
                {members.length} of {data.seats} members · {climbers.length} climbing
              </div>
            </div>
            <div className="grp-hero-score">
              <div className="grp-hero-num">+{group.score}</div>
              <div className="grp-hero-lbl">OVR climbed this week</div>
            </div>
          </div>

          <div className={`grp-zone is-${zone.tone}`}>
            <span className="grp-zone-glyph" aria-hidden="true">{zone.glyph}</span>
            <div className="grp-zone-body">
              <div className="grp-zone-title">{zone.title}</div>
              <div className="grp-zone-note">{zoneNote}</div>
            </div>
            <div className="grp-zone-pos">
              <div className="grp-zone-posnum">{ordinal(group.position)}</div>
              <div className="grp-zone-poslbl">of {group.of}</div>
            </div>
          </div>

          {/* Where the week came from. These four are category points,
              which do NOT add up to the OVR figure above — OVR is the
              mean of four ratings, so four points of fitness alone move
              the group one. Labelled as such rather than quietly not
              adding up. */}
          <div className="grp-split">
            <div className="grp-rule">
              <span>Where the growth came from</span><i />
            </div>
            {splitTotal > 0 ? (
              <>
                <div className="grp-split-bar">
                  {CATS.map(c => (
                    (split[c.id] || 0) > 0 && (
                      <span key={c.id} style={{ width: `${(split[c.id] / splitTotal) * 100}%`, background: c.color }} />
                    )
                  ))}
                </div>
                <div className="grp-split-keys">
                  {CATS.map(c => (
                    <div key={c.id} className="grp-split-key">
                      <i style={{ background: c.color }} />
                      <span>{c.label}</span>
                      <b>{split[c.id] || 0}</b>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="grp-quiet">Nobody has moved yet this week. Log something and this fills in.</div>
            )}
          </div>
        </div>

        {/* ── Podium ── */}
        <div className="grp-card grp-podium-card">
          <div className="grp-rule">
            <span>Contributor podium</span><i />
            <em>⬡ paid Monday</em>
          </div>
          {podium.length ? (
            <div className="grp-podium">
              {podium.map((m, i) => (
                <div key={m.userId} className="grp-pod">
                  {m.avatarUrl
                    ? <img className={`grp-pod-av is-p${i}`} src={m.avatarUrl} alt="" />
                    : <span className={`grp-pod-av is-p${i}`} style={{ background: avatarColor(m.name) }}>
                        {initials(m.name)}
                      </span>}
                  <div className="grp-pod-name">{m.name}</div>
                  <div className={`grp-pod-bar is-p${i}`}>
                    <div className="grp-pod-place">{['1st', '2nd', '3rd'][i]}</div>
                    <div className="grp-pod-climb">+{m.climb}</div>
                    <div className="grp-pod-coins">⬡ {coins[i]}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grp-quiet">No climbers yet this week — the podium fills as people move.</div>
          )}
          <p className="grp-foot-note">
            The top three climbers earn coins. An idle week pays nothing, however high the member's
            rating already is.
          </p>
        </div>

        {/* ── Members ── */}
        <div className="grp-card grp-members">
          <div className="grp-members-head">
            <div className="grp-rule"><span>Members · this week</span><i /></div>
            <button type="button" className="btn btn-sm" onClick={() => setInviteOpen(true)}>Invite</button>
          </div>
          <div className="grp-mrow grp-mhead">
            <div>#</div><div>Member</div><div>OVR</div><div>Share of the climb</div><div className="grp-num">Climb</div>
          </div>
          {members.map((m, i) => {
            const idle = !m.counted;
            const top3 = !idle && i < 3;
            return (
              <div key={m.userId} className={`grp-mrow${m.userId === data.selfId ? ' is-self' : ''}`}>
                <div className={`grp-mrank${top3 ? ' is-top' : ''}`}>{i + 1}</div>
                <div className="grp-mwho">
                  {m.avatarUrl
                    ? <img className="grp-mav" src={m.avatarUrl} alt="" />
                    : <span className="grp-mav" style={{ background: avatarColor(m.name) }}>{initials(m.name)}</span>}
                  <span className="grp-mname">{m.name}</span>
                  {m.role === 'owner' && <span className="grp-tag">Owner</span>}
                  {top3 && <span className="grp-tag is-mvp">MVP</span>}
                  {idle && <span className="grp-tag is-idle">Idle</span>}
                  {group.isOwner && m.role !== 'owner' && (
                    <button type="button" className="grp-kick" disabled={busy}
                      title={`Remove ${m.name} from the group`}
                      onClick={() => {
                        if (window.confirm(`Remove ${m.name} from ${group.name}?`)) onKick(m.userId);
                      }}>×</button>
                  )}
                </div>
                <div className="grp-movr">{m.ovr}</div>
                <div className="grp-mbar">
                  <i style={{ width: `${Math.round(((m.counted || 0) / maxClimb) * 100)}%` }}
                     className={top3 ? 'is-top' : undefined} />
                </div>
                <div className={`grp-num grp-mclimb${idle ? ' is-idle' : ''}`}>
                  {m.climb == null ? '—' : idle ? '—' : `+${m.climb}`}
                </div>
              </div>
            );
          })}
          <p className="grp-foot-note">
            The group's score is the sum of every member's OVR growth since Monday — {data.seats} seats,
            so a quiet member costs the group nothing but adds nothing.
          </p>
        </div>

        <div className="grp-actions">
          {group.isOwner && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => {
              const name = window.prompt('Rename the group', group.name);
              if (name && name.trim() && name.trim() !== group.name) onRename(name.trim());
            }}>Rename</button>
          )}
          <button type="button" className="btn btn-sm grp-leave" disabled={busy} onClick={() => {
            const msg = group.isOwner
              ? `Leave ${group.name}? The longest-standing member takes it over.`
              : `Leave ${group.name}?`;
            if (window.confirm(msg)) onLeave();
          }}>
            <Icon name="log-out" size={13} /> Leave group
          </button>
        </div>
      </div>

      {inviteOpen && (
        <InviteModal
          group={group}
          seatsLeft={data.seats - members.length}
          onRotate={onRotateCode}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </>
  );
}
