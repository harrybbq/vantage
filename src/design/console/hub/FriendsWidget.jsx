/**
 * Friends — the widget, the opened friend, and the overlays they share.
 *
 *   FriendsWidget   online count (in the frame meta), incoming requests
 *                   with accept / decline inline, friend rows (avatar +
 *                   online dot, name + prestige, a status line, unread
 *                   pill, band-coloured OVR), footer: Messages · Add a
 *                   friend · All N.
 *   FriendCardCx    the friend's card: ratings in band colours, streak,
 *                   13-week activity, recent wins, Message, ⋯ Report /
 *                   Block / Remove (the existing report and block flows).
 *   FriendTakeover  desktop: the friend takes the widget area, the way the
 *                   classic FriendPanel does — friends list, the
 *                   conversation (MessagesModal inline, unchanged), the card.
 *   FriendsOverlays phone: the card in a bottom sheet; both: the
 *                   conversation overlay, Add a friend, Report.
 *
 * All data and every action come from useFriendsHub, which wraps the
 * classic friends data layer.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import { Sheet } from '../ui';
import { bandClass, bandVar, bandOf } from '../../../lib/ratings/bands';
import { ovrTier } from '../../../lib/ratings/tiers';
import AddFriendModal from '../../../components/friends/AddFriendModal';
import ReportFriendModal from '../../../components/friends/ReportFriendModal';
import MessagesModal from '../../../components/friends/MessagesModal';
import HandleClaimModal from '../../../components/friends/HandleClaimModal';
import { Avatar, Diamonds } from './DivisionTable';
import { ordinal } from './LeagueWidget';

/** Lucide message-circle, which the shared Icon set does not carry. */
export function MsgIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

export function seenLine(f) {
  if (f.online) return 'Online now';
  if (f.lastSeenDays == null) return f.handle ? `@${f.handle}` : '';
  if (f.lastSeenDays === 0) return 'Active today';
  if (f.lastSeenDays === 1) return 'Last on yesterday';
  return `Last on ${f.lastSeenDays} days ago`;
}

function FriendRow({ f, onOpen, selected = false }) {
  return (
    <li>
      <button type="button" className={`cx-hub-fr${selected ? ' is-on' : ''}`} onClick={() => onOpen(f.id)}
              aria-label={`${f.name}${f.unread ? `, ${f.unread} unread` : ''}, OVR ${f.ovr ?? 'unknown'}`}>
        <Avatar name={f.name} url={f.avatar_url} size={32} online={f.online} />
        <span className="cx-hub-fr-txt">
          <span className="cx-hub-fr-nm"><span className={`cx-hub-ell${f.unread ? ' is-strong' : ''}`}>{f.name}</span><Diamonds n={f.prestige} /></span>
          {f.lastText
            ? <span className="cx-hub-fr-st is-msg">“{f.lastText}”</span>
            : <span className="cx-hub-fr-st">{seenLine(f)}</span>}
        </span>
        {f.unread > 0 && <span className="cx-hub-pill cx-num">{f.unread}</span>}
        <span className={`cx-num cx-hub-fr-ovr ${bandClass(f.ovr)}`}>{f.ovr ?? '–'}</span>
      </button>
    </li>
  );
}

function Request({ p, hub }) {
  const busy = hub.busyId === p.id;
  const name = p.display_name || `@${p.handle}`;
  return (
    <div className="cx-hub-req">
      <Avatar name={name} url={p.avatar_url} size={28} />
      <span className="cx-hub-req-txt">
        <span className="cx-hub-req-nm">{name} wants to be friends</span>
        <span className="cx-hub-req-sub">@{p.handle}{p.via_invite ? ' · joined with your invite link' : ''}</span>
      </span>
      <button type="button" className="cx-hub-ibtn" disabled={busy} onClick={() => hub.decline(p.id)} aria-label={`Decline ${name}`}>
        <Icon name="x" size={16} strokeWidth={1.75} />
      </button>
      <button type="button" className="cx-hub-ibtn is-ok" disabled={busy} onClick={() => hub.accept(p.id)} aria-label={`Accept ${name}`}>
        <Icon name="check" size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function friendsMeta(hub) {
  if (!hub || hub.loading || hub.error) return '';
  const n = hub.rows.length;
  if (!n) return '';
  return <><span className="cx-hub-on" aria-hidden="true">●</span> {hub.onlineCount} online · {n} friend{n === 1 ? '' : 's'}</>;
}

export default function FriendsWidget({ hub, size, isMobile, navigate }) {
  if (!hub) return null;
  if (hub.loading) return <p className="cx-hub-empty">Loading friends…</p>;
  if (hub.error) return <p className="cx-hub-empty">Friends aren’t available right now.</p>;
  if (hub.needsHandle) {
    return (
      <div className="cx-hub-empty-cta">
        <p className="cx-hub-empty">Pick a handle so friends can find you.</p>
        <button type="button" className="cx-btn cx-btn--primary" onClick={() => hub.openHandle?.()}>Claim a handle</button>
      </div>
    );
  }
  const rowsMax = size === 'large' ? 8 : isMobile ? 3 : 4;
  const shown = hub.rows.slice(0, rowsMax);
  return (
    <div className="cx-hub-friends">
      {hub.pending.slice(0, 1).map(p => <Request key={p.id} p={p} hub={hub} />)}
      {hub.pending.length > 1 && (
        <button type="button" className="cx-hub-more" onClick={() => navigate?.('friends')}>
          {hub.pending.length - 1} more request{hub.pending.length > 2 ? 's' : ''} <Icon name="chevron-right" size={14} />
        </button>
      )}
      {shown.length ? (
        <ul className="cx-hub-list">{shown.map(f => <FriendRow key={f.id} f={f} onOpen={hub.openFriend} />)}</ul>
      ) : (
        <div className="cx-hub-empty-cta">
          <p className="cx-hub-pre"><b>No friends yet.</b> Add someone and you’ll see them here, and on the league table.</p>
        </div>
      )}
      <div className="cx-hub-friends-foot">
        <button type="button" className="cx-hub-link is-strong" onClick={() => navigate?.('friends')}>
          <MsgIcon size={15} /> Messages {hub.unreadTotal > 0 && <span className="cx-hub-pill cx-num">{hub.unreadTotal}</span>}
        </button>
        <button type="button" className="cx-hub-link" onClick={hub.openAdd}>
          <Icon name="user-plus" size={15} strokeWidth={1.75} /> Add a friend
        </button>
        <span className="cx-hub-sp" />
        {hub.rows.length > 0 && (
          <button type="button" className="cx-hub-link cx-accent is-strong" onClick={() => navigate?.('friends')}>
            All {hub.rows.length} <Icon name="chevron-right" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── The friend's card ─────────────────────────────────────────────── */

const CATS = [['brain', 'Brain'], ['finance', 'Finance'], ['fitness', 'Fitness'], ['social', 'Social']];

function Heat({ days = [] }) {
  const cols = [];
  for (let w = 0; w < 13; w++) cols.push(days.slice(w * 7, w * 7 + 7));
  const active = days.filter(d => d && d.intensity > 0).length;
  return (
    <div className="cx-hub-heat-wrap">
      <div className="cx-hub-heat-h"><span>Last 13 weeks</span><span className="cx-muted">{active} active days</span></div>
      <div className="cx-hub-heat" role="img" aria-label={`${active} active days in the last 13 weeks`}>
        {cols.map((c, i) => (
          <span key={i} className="cx-hub-heat-col">
            {c.map((d, j) => <i key={j} className={`l${Math.max(0, Math.min(3, d.intensity || 0))}`} title={d.ymd} />)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FriendCardCx({ f, hub, showMessage = true, inSheet = false }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key, true); };
  }, [menu]);
  if (!f) return null;
  const tier = f.ovr != null ? ovrTier(f.ovr) : null;
  return (
    <div className={`cx-hub-fc${inSheet ? ' is-sheet' : ''}`}>
      <div className="cx-hub-fc-head">
        <Avatar name={f.name} url={f.avatar_url} size={56} online={f.online} />
        <div className="cx-hub-fc-id">
          <span className="cx-hub-fc-nm"><span className="cx-hub-ell">{f.name}</span><Diamonds n={f.prestige} /></span>
          <span className="cx-hub-fc-sub">{f.handle ? `@${f.handle}` : ''}{f.online ? <> · <span className="cx-hub-onl">online now</span></> : f.lastSeenDays != null ? ` · ${seenLine(f).toLowerCase()}` : ''}</span>
        </div>
        <div className="cx-hub-fc-ovr">
          <span className={`cx-num ${bandClass(f.ovr)}`}>{f.ovr ?? '–'}</span>
          {tier && <span className={`cx-hub-tier ${bandClass(f.ovr)}`}>{tier.label}</span>}
        </div>
      </div>
      <div className="cx-hub-fc-cats">
        {CATS.map(([k, l]) => {
          const v = f.cats ? f.cats[k] : null;
          return (
            <div key={k} className="cx-hub-fc-cat">
              <span className="cx-muted">{l}</span>
              <span className={`cx-num ${bandClass(v)}`}>{v ?? '–'}</span>
              <span className="cx-hub-bar is-thin"><i style={{ width: `${v || 0}%`, background: bandVar(v) || undefined }} /></span>
            </div>
          );
        })}
      </div>
      <div className="cx-hub-fc-streak">
        <Icon name="flame" size={18} strokeWidth={1.75} />
        <span className="cx-hub-fc-st">
          <b><span className="cx-num">{f.streak || 0}</span>-day streak</b>
          <span className="cx-muted">{hub.statsLoading ? 'Loading…' : f.streakHabit || 'No streak running'}</span>
        </span>
        {f.rank && <span className="cx-muted cx-hub-nowrap">{ordinal(f.rank)} on your table</span>}
      </div>
      {hub.statsLoading
        ? <p className="cx-hub-empty">Loading activity…</p>
        : f.heatmap && f.heatmap.length ? <Heat days={f.heatmap} /> : <p className="cx-hub-empty">{f.name} hasn’t shared their activity.</p>}
      <div className="cx-hub-fc-wins">
        <span className="cx-hub-fc-h">Recent wins</span>
        {f.wins && f.wins.length
          ? f.wins.map((w, i) => <span key={i} className="cx-hub-row is-static"><span className="cx-gold" aria-hidden="true">◆</span><span className="cx-hub-ell">{w.name}</span></span>)
          : <span className="cx-muted">{hub.statsLoading ? 'Loading…' : 'None yet'}</span>}
      </div>
      <div className="cx-hub-fc-acts" ref={menuRef}>
        {showMessage && (
          <button type="button" className="cx-btn cx-btn--primary cx-hub-grow" onClick={() => hub.openThread(f)}>
            <MsgIcon size={16} /> Message {f.unread > 0 && <span className="cx-hub-pill is-on-fill cx-num">{f.unread}</span>}
          </button>
        )}
        <button type="button" className="cx-btn cx-btn--icon" aria-label={`More for ${f.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}>
          <Icon name="ellipsis" size={18} />
        </button>
        {menu && (
          <div className="cx-hub-menu is-up" role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); hub.openReport(f); }}>Report {f.name}</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); hub.unfriend(f); }}>Remove friend</button>
            <button type="button" role="menuitem" className="cx-danger" onClick={() => { setMenu(false); hub.block(f); }}>Block</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Desktop: the friend takes the widget area ─────────────────────── */

export function FriendTakeover({ hub }) {
  const ref = useRef(null);
  const f = hub.selected;
  // Esc, or a press anywhere outside the panel (and outside anything the
  // panel portalled — report modal, message menus), returns to the widgets.
  useEffect(() => {
    if (!f) return undefined;
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.modal-overlay.open, .msg-overlay, .cx-sheet-root, .cx-hub-menu')) hub.closeFriend(); };
    const onDown = e => {
      const t = e.target;
      if (!(t instanceof Node) || (ref.current && ref.current.contains(t))) return;
      if (t.closest && t.closest('.modal-overlay, .msg-overlay, .cx-hub-menu, .cx-sheet-root, .cx-hub-fr, .cx-dt-who')) return;
      hub.closeFriend();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [f, hub]);
  if (!f) return null;
  return (
    <section ref={ref} className="cx-panel cx-hub-take" aria-label={`${f.name}, friend`}>
      <div className="cx-hub-take-list">
        <div className="cx-hub-take-h">
          <span className="cx-hub-take-t">Friends</span>
          <span className="cx-muted">{friendsMeta(hub)}</span>
        </div>
        <ul className="cx-hub-list">{hub.rows.map(r => <FriendRow key={r.id} f={r} onOpen={hub.openFriend} selected={r.id === f.id} />)}</ul>
        <button type="button" className="cx-hub-link" onClick={hub.openAdd}><Icon name="user-plus" size={15} strokeWidth={1.75} /> Add a friend</button>
      </div>
      <div className="cx-hub-take-chat">
        <div className="cx-hub-take-h">
          <Avatar name={f.name} url={f.avatar_url} size={28} online={f.online} />
          <span className="cx-hub-take-t">{f.name}</span>
          <span className="cx-hub-sp" />
          <span className="cx-muted cx-hub-nowrap">Messages are only between friends</span>
          <button type="button" className="cx-btn cx-btn--icon cx-btn--ghost" onClick={hub.closeFriend} aria-label="Back to the widgets">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="cx-hub-take-thread">
          <MessagesModal
            key={f.id}
            inline
            open
            userId={hub.userId}
            friend={f}
            onClose={hub.closeFriend}
            onBlocked={hub.onBlocked}
            onActivity={hub.onThreadActivity}
            onRead={hub.onThreadRead}
          />
        </div>
      </div>
      <div className="cx-hub-take-card">
        <FriendCardCx f={f} hub={hub} showMessage={false} />
      </div>
    </section>
  );
}

/* ── Overlays (both widths) ────────────────────────────────────────── */

export function FriendsOverlays({ hub, isMobile, onUpgrade }) {
  return (
    <>
      {isMobile && hub.selected && !hub.thread && (
        <Sheet title="Friend" onClose={hub.closeFriend} className="cx-hub-fsheet" testId="cx-hub-friend-sheet">
          <FriendCardCx f={hub.selected} hub={hub} inSheet />
        </Sheet>
      )}
      {hub.thread && (
        <MessagesModal
          open
          userId={hub.userId}
          friend={hub.thread}
          onClose={hub.closeThread}
          onBlocked={hub.onBlocked}
          onActivity={hub.onThreadActivity}
          onRead={hub.onThreadRead}
        />
      )}
      <AddFriendModal
        open={hub.addOpen}
        atCap={hub.friends.atCap}
        pendingIds={hub.pendingIds}
        friendIds={hub.friendIds}
        onSearch={hub.friends.search}
        onSend={async to => { await hub.friends.send(to); }}
        onClose={hub.closeAdd}
        onUpgrade={onUpgrade}
      />
      <ReportFriendModal
        open={!!hub.reportTarget}
        friend={hub.reportTarget}
        onSubmit={hub.submitReport}
        onClose={hub.closeReport}
      />
      <HandleClaimModal
        open={hub.handleOpen}
        userId={hub.userId}
        suggested={(hub.friends.ownProfile?.display_name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)}
        onClaim={async updated => { hub.friends.setOwnProfile(updated); await hub.friends.refresh(); }}
        onClose={hub.closeHandle}
      />
    </>
  );
}

export { bandOf };
