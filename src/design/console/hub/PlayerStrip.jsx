/**
 * The player at the top of the hub (DIRECTIONS.md §A, the strip that
 * used to carry Level/XP — Level was retired 2026-10).
 *
 * Desktop strip: identity (avatar in its prestige frame, today's events
 * in time order, the coins chip) | Prestige: OVR to the next prestige, a bar of OVR/99 and
 * the next reward, then the league position | OVR donut with the four
 * category bars | Honours with the latest two and the next one. Phone:
 * one compact card with the donut, the prestige bar, the four
 * categories in a row and an honours / league line.
 *
 * Every rating number is drawn in its tier-band colour (lib/ratings/
 * bands.js). Sources — all existing, nothing derived twice:
 *   visionState (lib/visions useVisions) honours count
 *   S.ratings / S.prestige                OVR, categories, prestige
 *   lib/ratings/prestigeRewards           progress to the next prestige,
 *                                         the next reward, the frame
 *   S.visions + VISIONS_BY_ID             latest honours, the next one
 *   friends board (useFriendsHub)         league position
 * While S is the local backup (`__slim`) the ratings show a dash, as
 * RatingsPanel does, rather than a number that corrects itself.
 *
 * Taps: the donut and categories open the full Ratings panel (classic
 * RatingsPanel in a sheet), the prestige block and chip the Prestige
 * rewards sheet, honours the Honours catalogue, the league line the
 * leaderboard, coins the shop.
 */
import { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/Icon';
import { bandClass, bandVar } from '../../../lib/ratings/bands';
import { prestigeProgress, prestigeName } from '../../../lib/ratings/prestigeRewards';
import { RATING_COLOURS, ratingShares } from '../../../lib/ratings/palette';
import { donutSegments } from '../../../components/ratings/RatingsDonut';
import { useDarkSurface } from '../../../hooks/useDarkSurface';
import { VISIONS, VISIONS_BY_ID } from '../../../lib/visions/definitions';
import { timeAgo } from '../../../utils/helpers';
import { eventColour, eventWhen, todayAgenda } from '../../../lib/calendar/events';
import { Avatar, Diamonds } from './DivisionTable';
import { boardRows, gapNote, ordinal } from './LeagueWidget';

const CATS = [{ id: 'brain', label: 'Brain' }, { id: 'finance', label: 'Finance' }, { id: 'fitness', label: 'Fitness' }, { id: 'social', label: 'Social' }];
const CAT_LABEL = { brain: 'Brain', finance: 'Finance', fitness: 'Fitness', social: 'Social' };
const fmt = n => Number(n || 0).toLocaleString('en-GB');

/** Today's events shown under the name; the rest are "+N more". */
const AGENDA_MAX = 4;

/** The time now, once a minute, so an event dims the minute it ends. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Today's events under the name (owner, Oct 2026: "if a user has events
 * the day of viewing, they should show here in chronological order").
 * lib/calendar/events todayAgenda: trips and multi-day events first (they
 * frame the day), then by start time, untimed last; one that is over dims
 * but stays. Nothing on today → nothing drawn. Opens Track, where the
 * calendar is.
 */
function TodayEvents({ S, navigate }) {
  const now = useMinute();
  const agenda = todayAgenda(S, now);
  if (!agenda.length) return null;
  // What's still to come gets the rows; finished events fill whatever is
  // left, latest first, so a busy morning doesn't push the afternoon into
  // "+N more". Still in time order.
  const left = agenda.filter(e => !e.past).length;
  const pastRoom = Math.max(0, AGENDA_MAX - left);
  const past = agenda.filter(e => e.past);
  const pastKept = new Set(pastRoom > 0 ? past.slice(-pastRoom) : []);
  const shown = agenda.filter(e => !e.past || pastKept.has(e)).slice(0, AGENDA_MAX);
  const more = agenda.length - shown.length;
  const allDay = ev => ev.source === 'span' || ev.source === 'holiday';
  return (
    <button type="button" className="cx-hub-pl-agenda" onClick={() => navigate?.('track')}
            aria-label={`Today: ${agenda.map(ev => [eventWhen(ev) || (allDay(ev) ? 'all day' : ''), ev.label].filter(Boolean).join(' ')).join('; ')}. Open your calendar`}>
      <span className="cx-hub-pl-h">
        <span className="cx-hub-pl-t">Today</span><span className="cx-hub-sp" />
        <span className="cx-muted">{left ? `${left} to go` : 'All done'}</span>
      </span>
      {shown.map(ev => (
        <span key={ev.id} className={`cx-hub-pl-ev${ev.past ? ' is-past' : ''}`} title={[eventWhen(ev), ev.label, ev.location].filter(Boolean).join(' · ')}>
          <span className="cx-hub-dot" style={{ background: eventColour(ev) }} aria-hidden="true" />
          <span className="cx-num cx-hub-pl-at">{ev.time || (allDay(ev) ? 'All day' : '')}</span>
          <span className="cx-hub-ell">{ev.label}</span>
        </span>
      ))}
      {more > 0 && <span className="cx-muted cx-hub-pl-more">+{more} more</span>}
    </button>
  );
}

function usePlayer(S, visionState, hub) {
  return useMemo(() => {
    const settling = !!S.__slim;
    const r = S.ratings || {};
    const ovr = settling ? null : (r.ovr || null);
    const cats = CATS.map(c => ({ ...c, v: settling ? null : (r[c.id] ?? null) }));
    const vs = visionState || {};
    const p = Math.max(0, Math.floor(Number(S.prestige) || 0));
    const pg = prestigeProgress(ovr, p);
    const stamped = S.visions || {};
    const recent = Object.entries(stamped)
      .filter(([id]) => VISIONS_BY_ID[id])
      .sort((a, b) => String(b[1]?.unlockedAt || '').localeCompare(String(a[1]?.unlockedAt || '')))
      .slice(0, 2)
      .map(([id, v]) => ({ id, title: VISIONS_BY_ID[id].title, when: v?.unlockedAt ? timeAgo(new Date(v.unlockedAt)) : '' }));
    const nextHonour = VISIONS.filter(v => !stamped[v.id]).sort((a, b) => a.xp - b.xp)[0] || null;
    const rows = boardRows(hub?.board);
    const me = rows.find(x => x.isSelf);
    return {
      settling, ovr, cats, pg,
      honours: { have: vs.unlockedCount || 0, total: vs.totalCount || VISIONS.length, recent, next: nextHonour },
      league: me && rows.length > 1 ? { pos: me.pos, of: rows.length, note: gapNote(rows) } : null,
      // Four rows for the strip's friends column: the top four, or the
      // top three and you when you are further down.
      board: rows.length > 1 ? (rows.slice(0, 4).some(x => x.isSelf) || !me ? rows.slice(0, 4) : [...rows.slice(0, 3), me]) : [],
      prestige: p ? { text: prestigeName(p), n: p } : null,
    };
  }, [S.__slim, S.ratings, S.prestige, S.visions, visionState, hub?.board]);
}

/** The OVR ring. `halo` (0‥1) draws a thin gold arc round the outside —
 *  the climb to the next prestige — and `prestige` names the level in
 *  the hole under OVR, or `medal` puts a "P1" medal on top of the ring
 *  (2026-10-21: prestige lives on the number it counts, not in a column
 *  of its own). */
function Donut({ cats, ovr, size, stroke, dark, halo = null, prestige = '', medal = '' }) {
  const colours = RATING_COLOURS[dark ? 'dark' : 'light'];
  const ratings = Object.fromEntries(cats.map(c => [c.id, c.v || 0]));
  const segs = donutSegments(ratingShares(ratings, cats));
  // donutSegments works on a 132-unit box with r=52; scale to ours.
  const k = size / 132;
  const R = 52, C = 2 * Math.PI * R;
  return (
    <span className="cx-hub-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={R} fill="none" stroke="var(--cx-track)" strokeWidth={stroke / k} />
        {ovr != null && segs.map(s => (
          <circle key={s.id} cx="66" cy="66" r={R} fill="none" stroke={colours[s.id]} strokeWidth={stroke / k}
                  strokeDasharray={`${s.length.toFixed(2)} ${(C - s.length).toFixed(2)}`}
                  strokeDashoffset={(-s.offset + C / 4).toFixed(2)} />
        ))}
        {halo != null && <>
          <circle cx="66" cy="66" r={HALO_R} fill="none" stroke="var(--cx-track)" strokeWidth={HALO_W} />
          {halo > 0 && (
            <circle className="cx-hub-halo" cx="66" cy="66" r={HALO_R} fill="none" stroke="var(--cx-gold)" strokeWidth={HALO_W} strokeLinecap="round"
                    strokeDasharray={`${(HALO_C * Math.min(1, halo)).toFixed(2)} ${HALO_C.toFixed(2)}`}
                    strokeDashoffset={(HALO_C / 4).toFixed(2)} />
          )}
        </>}
      </svg>
      {medal && <span className="cx-hub-medal cx-num" aria-hidden="true">{medal}</span>}
      <span className="cx-hub-donut-c">
        <span className={`cx-num ${bandClass(ovr)}`}>{ovr ?? '–'}</span>
        <span className="cx-muted">OVR</span>
        {prestige && <span className="cx-gold cx-hub-donut-p"><span aria-hidden="true">◆</span> {prestige}</span>}
      </span>
    </span>
  );
}

// The halo sits outside the category ring (r 52, ~9 wide) in the same 132 box.
const HALO_R = 63, HALO_W = 2.5, HALO_C = 2 * Math.PI * HALO_R;
const haloOf = pg => (pg.ready ? 1 : Math.max(0, Math.min(1, (pg.pct || 0) / 100)));

function CatBar({ c }) {
  return (
    <div className="cx-hub-catrow">
      <span className="cx-mid">{c.label}</span>
      <span className="cx-hub-bar is-thin"><i style={{ width: `${c.v || 0}%`, background: bandVar(c.v) || undefined }} /></span>
      <span className={`cx-num ${bandClass(c.v)}`}>{c.v ?? '–'}</span>
    </div>
  );
}

/** "25 OVR left until Prestige 2" / "Ready to prestige" / "–" while loading.
 *  "left until", not "to": beside a big number, "30 OVR to Prestige II"
 *  was read as "Prestige 30". */
function toGoText(pg) {
  if (pg.ready) return 'Ready to prestige';
  if (!pg.next) return 'Every prestige reached';
  return `${pg.toGo == null ? '–' : pg.toGo} OVR left until ${pg.nextName}`;
}

export function PlayerStrip({ S, visionState, hub, navigate, onOpenVisions, onOpenRatings, onOpenRewards }) {
  const L = usePlayer(S, visionState, hub);
  const pg = L.pg;
  const dark = useDarkSurface();
  const name = (S.profile?.name || '').trim() || 'You';
  const handle = hub?.friends?.ownProfile?.handle;
  return (
    <section className="cx-panel cx-hub-player" aria-label="Your prestige and ratings" data-cx-tour="hub">
      <div className="cx-hub-pl-id">
        <button type="button" className="cx-hub-pl-who" onClick={() => navigate?.('settings')} aria-label="Your profile, in Settings">
          <Avatar name={name} url={S.profile?.photo || null} size={44} self prestige={L.prestige ? L.prestige.n : 0} />
          <span className="cx-hub-pl-nm">
            <span className="cx-hub-ell cx-hub-pl-name">{name}</span>
            {handle && <span className="cx-muted cx-hub-ell">@{handle}</span>}
          </span>
        </button>
        {S.profile?.tagline && <p className="cx-hub-pl-tag">{S.profile.tagline}</p>}
        <TodayEvents S={S} navigate={navigate} />
        <div className="cx-hub-pl-chips">
          <button type="button" className="cx-chip" onClick={() => navigate?.('shop')} aria-label={`${fmt(S.coins)} coins, open the shop`}>
            <Icon name="coin" size={14} strokeWidth={1.75} /> <span className="cx-num">{fmt(S.coins)}</span>
          </button>
        </div>
      </div>

      {/* OVR and prestige together (2026-10-21). Prestige is how many
          times OVR has filled, so it sits on the ring: a "P1" medal on top,
          and the gold arc round the outside is the climb to the next one.
          Two controls: the ring and categories open the ratings, the
          prestige line under them opens the rewards. */}
      <div className="cx-hub-pl-ovr">
        <button type="button" className="cx-hub-pl-rate" onClick={onOpenRatings}
                aria-label={`OVR ${L.ovr ?? 'loading'}${L.prestige ? `, ${L.prestige.text}` : ''}. Open your ratings`}>
          <Donut cats={L.cats} ovr={L.ovr} size={132} stroke={10} dark={dark} halo={L.settling ? null : haloOf(pg)} medal={L.prestige ? `P${L.prestige.n}` : ''} />
          <span className="cx-hub-pl-cats">
            <span className="cx-hub-pl-h">
              <span className="cx-hub-pl-t">Categories</span>
              <span className="cx-hub-sp" />
            </span>
            {L.cats.map(c => <CatBar key={c.id} c={c} />)}
          </span>
        </button>
        <button type="button" className="cx-hub-pl-prog" onClick={onOpenRewards}
                aria-label={`${L.prestige ? L.prestige.text : 'No prestige yet'}. ${toGoText(pg)}.${pg.reward ? ` Next unlock: ${pg.reward.name}.` : ''} Open prestige rewards`}>
          <span className="cx-hub-pl-h">
            <span className="cx-gold cx-hub-nowrap"><span aria-hidden="true">◆</span> {L.prestige ? L.prestige.text : 'Prestige 0'}</span>
            <span className="cx-muted" aria-hidden="true">·</span>
            {pg.ready
              ? <span className="cx-hub-pl-ready">Ready to prestige</span>
              : <span className="cx-mid">{toGoText(pg)}</span>}
            {pg.reward && <span className="cx-muted cx-hub-ell">· next unlock: <span className="cx-text">{pg.reward.name}</span></span>}
          </span>
        </button>
      </div>

      {/* Friends this week — the column prestige used to take. Opens the
          leaderboard. */}
      <button type="button" className="cx-hub-pl-fr" onClick={() => navigate?.('leaderboard')}
              aria-label={L.league ? `Friends league: ${ordinal(L.league.pos)} of ${L.league.of}${L.league.note ? `, ${L.league.note}` : ''}. Open the leaderboard` : 'Friends league. Open the leaderboard'}>
        <span className="cx-hub-pl-h">
          <span className="cx-hub-pl-t">Friends</span><span className="cx-hub-sp" />
          <span className="cx-muted">{L.league ? <><b className="cx-text">{ordinal(L.league.pos)}</b> of {L.league.of}</> : 'Pre-season'}</span>
        </span>
        {L.board.length ? L.board.map(f => (
          <span key={f.id} className={`cx-hub-pl-frow${f.isSelf ? ' is-self' : ''}`}>
            <span className="cx-num cx-muted">{f.pos}</span>
            <span className="cx-hub-pl-fnm"><span className="cx-hub-ell">{f.isSelf ? 'You' : f.name}</span><Diamonds n={f.prestige} /></span>
            <span className="cx-num cx-muted">{f.weekly != null ? `${f.weekly > 0 ? '+' : ''}${f.weekly}` : ''}</span>
            <span className={`cx-num ${bandClass(f.ovr)}`}>{f.ovr ?? '–'}</span>
          </span>
        )) : <span className="cx-muted">Add a friend to start a league.</span>}
        {L.league?.note && <span className="cx-mid cx-hub-pl-fnote">{L.league.note}</span>}
      </button>

      <button type="button" className="cx-hub-pl-hon" onClick={onOpenVisions} aria-label={`Honours, ${L.honours.have} of ${L.honours.total}. Open Honours`}>
        <span className="cx-hub-pl-h"><span className="cx-hub-pl-t">Honours</span><span className="cx-hub-sp" /><span className="cx-muted"><span className="cx-num">{L.honours.have}</span> of <span className="cx-num">{L.honours.total}</span></span></span>
        {L.honours.recent.map(h => (
          <span key={h.id} className="cx-hub-row is-static"><span className="cx-gold" aria-hidden="true">◆</span><span className="cx-hub-ell">{h.title}</span><span className="cx-hub-sp" /><span className="cx-muted cx-hub-nowrap">{h.when}</span></span>
        ))}
        {L.honours.next && (
          <span className="cx-hub-pl-next">
            <span className="cx-hub-row is-static"><span className="cx-muted" aria-hidden="true">◇</span><span className="cx-mid cx-hub-ell">Next: {L.honours.next.title}</span><span className="cx-hub-sp" /><span className="cx-muted cx-hub-nowrap">{CAT_LABEL[L.honours.next.category] || 'All round'}</span></span>
            <span className="cx-hub-bar is-gold"><i style={{ width: `${Math.round((L.honours.have / Math.max(1, L.honours.total)) * 100)}%` }} /></span>
          </span>
        )}
      </button>
    </section>
  );
}

export function PlayerCard({ S, visionState, hub, navigate, onOpenVisions, onOpenRatings, onOpenRewards }) {
  const L = usePlayer(S, visionState, hub);
  const pg = L.pg;
  const dark = useDarkSurface();
  return (
    <section className="cx-panel cx-hub-pcard" aria-label="Your prestige and ratings">
      <div className="cx-hub-pc-top">
        <button type="button" className="cx-hub-pc-donut" onClick={onOpenRatings} aria-label={`OVR ${L.ovr ?? 'loading'}. Open your ratings`}>
          <Donut cats={L.cats} ovr={L.ovr} size={84} stroke={8} dark={dark} halo={L.settling ? null : haloOf(pg)} />
        </button>
        <button type="button" className="cx-hub-pc-lvl" onClick={onOpenRewards} aria-label={`${L.prestige ? L.prestige.text : 'No prestige yet'}. ${toGoText(pg)}. Open prestige rewards`}>
          <span className="cx-hub-pl-h">
            <span className="cx-hub-pc-t">{L.prestige ? <><span className="cx-gold" aria-hidden="true">◆</span> {L.prestige.text}</> : 'Prestige'}</span>
          </span>
          <span className="cx-hub-pl-h cx-mid"><span className="cx-hub-ell">{toGoText(pg)}</span></span>
          {pg.reward && <span className="cx-hub-pl-h cx-muted"><span className="cx-hub-ell">Next unlock: {pg.reward.name}</span></span>}
        </button>
      </div>
      <button type="button" className="cx-hub-pc-cats" onClick={onOpenRatings} aria-label="Category ratings. Open your ratings">
        {L.cats.map(c => (
          <span key={c.id} className="cx-hub-pc-cat">
            <span className="cx-muted">{c.label}</span>
            <span className={`cx-num cx-hub-pc-v ${bandClass(c.v)}`}>{c.v ?? '–'}</span>
            <span className="cx-hub-bar is-thin"><i style={{ width: `${c.v || 0}%`, background: bandVar(c.v) || undefined }} /></span>
          </span>
        ))}
      </button>
      <div className="cx-hub-pc-foot">
        <button type="button" className="cx-hub-link" onClick={onOpenVisions}>
          <span className="cx-gold" aria-hidden="true">◆</span> <b className="cx-num">{L.honours.have}</b><span className="cx-muted">/{L.honours.total} honours</span>
        </button>
        <button type="button" className="cx-hub-link" onClick={() => navigate?.('leaderboard')}>
          <Icon name="trophy" size={14} strokeWidth={1.75} />
          {L.league ? <><b>{ordinal(L.league.pos)}</b><span className="cx-muted">of {L.league.of}</span></> : <span className="cx-muted">Pre-season</span>}
        </button>
        <span className="cx-hub-sp" />
        <button type="button" className="cx-hub-link cx-muted" onClick={onOpenRatings}>Ratings <Icon name="chevron-right" size={16} /></button>
      </div>
    </section>
  );
}
