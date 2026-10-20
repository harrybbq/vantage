/**
 * Levelling at the top of the hub (DIRECTIONS.md §A "Levelling").
 *
 * Desktop strip: identity + prestige / coins chips | Level, XP bar and
 * league position | OVR donut with the four category bars | Honours with
 * the latest two and the next one. Phone: one compact card with the
 * donut, the level bar, the four categories in a row and an honours /
 * league line.
 *
 * Every rating number is drawn in its tier-band colour (lib/ratings/
 * bands.js). Sources — all existing, nothing derived twice:
 *   visionState (lib/visions useVisions) level, XP, honours count
 *   S.ratings / S.prestige                OVR, categories, prestige
 *   S.visions + VISIONS_BY_ID             latest honours, the next one
 *   friends board (useFriendsHub)         league position
 * While S is the local backup (`__slim`) the ratings show a dash, as
 * RatingsPanel does, rather than a number that corrects itself.
 *
 * Taps go where they go today: the donut and categories open the full
 * Ratings panel (classic RatingsPanel in a sheet), level and honours the
 * Honours catalogue, the league line the leaderboard, coins the shop.
 */
import { useMemo } from 'react';
import Icon from '../../../components/Icon';
import { bandClass, bandVar } from '../../../lib/ratings/bands';
import { ovrTier, OVR_TIERS } from '../../../lib/ratings/tiers';
import { prestigeBadge } from '../../../lib/ratings/prestige';
import { RATING_COLOURS, ratingShares } from '../../../lib/ratings/palette';
import { donutSegments } from '../../../components/ratings/RatingsDonut';
import { useDarkSurface } from '../../../hooks/useDarkSurface';
import { VISIONS, VISIONS_BY_ID } from '../../../lib/visions/definitions';
import { timeAgo } from '../../../utils/helpers';
import { Avatar } from './DivisionTable';
import { boardRows, gapNote, ordinal } from './LeagueWidget';

const CATS = [{ id: 'brain', label: 'Brain' }, { id: 'finance', label: 'Finance' }, { id: 'fitness', label: 'Fitness' }, { id: 'social', label: 'Social' }];
const fmt = n => Number(n || 0).toLocaleString('en-GB');

function useLevelling(S, visionState, hub) {
  return useMemo(() => {
    const settling = !!S.__slim;
    const r = S.ratings || {};
    const ovr = settling ? null : (r.ovr || null);
    const tier = ovr != null ? ovrTier(ovr) : null;
    const nextTier = tier ? OVR_TIERS.find(t => t.min > tier.max) : null;
    const cats = CATS.map(c => ({ ...c, v: settling ? null : (r[c.id] ?? null) }));
    const vs = visionState || {};
    const lvl = vs.level || 1;
    const next = vs.nextLevelAt || 0;
    const span = vs.spanThisLevel || 0;
    const xp = vs.xp || 0;
    const from = next - span;
    const pct = Math.max(0, Math.min(100, vs.pctToNext ?? 0)); // already 0-100
    const stamped = S.visions || {};
    const recent = Object.entries(stamped)
      .filter(([id]) => VISIONS_BY_ID[id])
      .sort((a, b) => String(b[1]?.unlockedAt || '').localeCompare(String(a[1]?.unlockedAt || '')))
      .slice(0, 2)
      .map(([id, v]) => ({ id, title: VISIONS_BY_ID[id].title, when: v?.unlockedAt ? timeAgo(new Date(v.unlockedAt)) : '' }));
    const nextHonour = VISIONS.filter(v => !stamped[v.id]).sort((a, b) => a.xp - b.xp)[0] || null;
    const rows = boardRows(hub?.board);
    const me = rows.find(x => x.isSelf);
    const badge = prestigeBadge(S.prestige || 0);
    return {
      settling, ovr, tier, nextTier, cats, lvl, xp, next, from, pct, toGo: Math.max(0, next - xp),
      honours: { have: vs.unlockedCount || 0, total: vs.totalCount || VISIONS.length, recent, next: nextHonour },
      league: me && rows.length > 1 ? { pos: me.pos, of: rows.length, note: gapNote(rows) } : null,
      prestige: badge ? { text: `${badge.band.label} ${badge.numeral}`, n: S.prestige } : null,
    };
  }, [S.__slim, S.ratings, S.prestige, S.visions, visionState, hub?.board]);
}

function Donut({ cats, ovr, size, stroke, dark }) {
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
      </svg>
      <span className="cx-hub-donut-c">
        <span className={`cx-num ${bandClass(ovr)}`}>{ovr ?? '–'}</span>
        <span className="cx-muted">OVR</span>
      </span>
    </span>
  );
}

function CatBar({ c }) {
  return (
    <div className="cx-hub-catrow">
      <span className="cx-mid">{c.label}</span>
      <span className="cx-hub-bar is-thin"><i style={{ width: `${c.v || 0}%`, background: bandVar(c.v) || undefined }} /></span>
      <span className={`cx-num ${bandClass(c.v)}`}>{c.v ?? '–'}</span>
    </div>
  );
}

export function PlayerStrip({ S, visionState, hub, navigate, onOpenVisions, onOpenRatings }) {
  const L = useLevelling(S, visionState, hub);
  const dark = useDarkSurface();
  const name = (S.profile?.name || '').trim() || 'You';
  const handle = hub?.friends?.ownProfile?.handle;
  return (
    <section className="cx-panel cx-hub-player" aria-label="Your level and ratings" data-cx-tour="hub">
      <div className="cx-hub-pl-id">
        <button type="button" className="cx-hub-pl-who" onClick={() => navigate?.('settings')} aria-label="Your profile, in Settings">
          <Avatar name={name} url={S.profile?.photo || null} size={44} self />
          <span className="cx-hub-pl-nm">
            <span className="cx-hub-ell cx-hub-pl-name">{name}</span>
            {handle && <span className="cx-muted cx-hub-ell">@{handle}</span>}
          </span>
        </button>
        {S.profile?.tagline && <p className="cx-hub-pl-tag">{S.profile.tagline}</p>}
        <div className="cx-hub-pl-chips">
          {L.prestige && (
            <button type="button" className="cx-chip" onClick={onOpenRatings} title={`Prestige ${L.prestige.n}`}>
              <span className="cx-gold" aria-hidden="true">◆</span> {L.prestige.text}
            </button>
          )}
          <button type="button" className="cx-chip" onClick={() => navigate?.('shop')} aria-label={`${fmt(S.coins)} coins, open the shop`}>
            <Icon name="coin" size={14} strokeWidth={1.75} /> <span className="cx-num">{fmt(S.coins)}</span>
          </button>
        </div>
      </div>

      <div className="cx-hub-pl-lvl">
        <button type="button" className="cx-hub-pl-hit" onClick={onOpenVisions} aria-label={`Level ${L.lvl}, ${fmt(L.toGo)} XP to level ${L.lvl + 1}. Open Honours`}>
          <span className="cx-hub-pl-h"><span className="cx-hub-pl-t">Level</span><span className="cx-hub-sp" /><span className="cx-muted">{fmt(L.toGo)} XP to level {L.lvl + 1}</span></span>
          <span className="cx-hub-pl-big"><span className="cx-num cx-t40">{L.lvl}</span><span className="cx-num cx-muted">{fmt(L.xp)} / {fmt(L.next)} XP</span></span>
          <span className="cx-hub-bar is-thick"><i style={{ width: `${L.pct}%` }} /></span>
          <span className="cx-hub-pl-ends cx-num cx-muted"><span>{fmt(L.from)}</span><span>{fmt(L.next)}</span></span>
        </button>
        <button type="button" className="cx-hub-pl-league" onClick={() => navigate?.('leaderboard')}>
          <Icon name="trophy" size={14} strokeWidth={1.75} />
          {L.league
            ? <><b>{ordinal(L.league.pos)}</b><span className="cx-muted">of {L.league.of} friends</span>{L.league.note && <><span className="cx-hub-sp" /><span className="cx-mid">{L.league.note}</span></>}</>
            : <span className="cx-muted">League: pre-season</span>}
        </button>
      </div>

      <button type="button" className="cx-hub-pl-rate" onClick={onOpenRatings} aria-label={`OVR ${L.ovr ?? 'loading'}. Open your ratings`}>
        <Donut cats={L.cats} ovr={L.ovr} size={112} stroke={10} dark={dark} />
        <span className="cx-hub-pl-cats">
          <span className="cx-hub-pl-h">
            <span className="cx-hub-pl-t">Rating</span>
            {L.tier && <span className={`cx-hub-tier ${bandClass(L.ovr)}`}>{L.tier.label}</span>}
            <span className="cx-hub-sp" />
            {L.nextTier && <span className="cx-muted cx-hub-nowrap">{L.nextTier.label} at {L.nextTier.min}</span>}
          </span>
          {L.cats.map(c => <CatBar key={c.id} c={c} />)}
        </span>
      </button>

      <button type="button" className="cx-hub-pl-hon" onClick={onOpenVisions} aria-label={`Honours, ${L.honours.have} of ${L.honours.total}. Open Honours`}>
        <span className="cx-hub-pl-h"><span className="cx-hub-pl-t">Honours</span><span className="cx-hub-sp" /><span className="cx-muted"><span className="cx-num">{L.honours.have}</span> of <span className="cx-num">{L.honours.total}</span></span></span>
        {L.honours.recent.map(h => (
          <span key={h.id} className="cx-hub-row is-static"><span className="cx-gold" aria-hidden="true">◆</span><span className="cx-hub-ell">{h.title}</span><span className="cx-hub-sp" /><span className="cx-muted cx-hub-nowrap">{h.when}</span></span>
        ))}
        {L.honours.next && (
          <span className="cx-hub-pl-next">
            <span className="cx-hub-row is-static"><span className="cx-muted" aria-hidden="true">◇</span><span className="cx-mid cx-hub-ell">Next: {L.honours.next.title}</span><span className="cx-hub-sp" /><span className="cx-num cx-muted">+{L.honours.next.xp} XP</span></span>
            <span className="cx-hub-bar is-gold"><i style={{ width: `${Math.round((L.honours.have / Math.max(1, L.honours.total)) * 100)}%` }} /></span>
          </span>
        )}
      </button>
    </section>
  );
}

export function PlayerCard({ S, visionState, hub, navigate, onOpenVisions, onOpenRatings }) {
  const L = useLevelling(S, visionState, hub);
  const dark = useDarkSurface();
  return (
    <section className="cx-panel cx-hub-pcard" aria-label="Your level and ratings">
      <div className="cx-hub-pc-top">
        <button type="button" className="cx-hub-pc-donut" onClick={onOpenRatings} aria-label={`OVR ${L.ovr ?? 'loading'}. Open your ratings`}>
          <Donut cats={L.cats} ovr={L.ovr} size={84} stroke={8} dark={dark} />
        </button>
        <button type="button" className="cx-hub-pc-lvl" onClick={onOpenVisions} aria-label={`Level ${L.lvl}. Open Honours`}>
          <span className="cx-hub-pl-h">
            <span className="cx-hub-pc-t">Level {L.lvl}</span>
            {L.tier && <span className={`cx-hub-tier ${bandClass(L.ovr)}`}>{L.tier.label}</span>}
            <span className="cx-hub-sp" />
            {L.prestige && <span className="cx-gold cx-hub-nowrap" title={`Prestige ${L.prestige.n}`}>◆ {L.prestige.text.split(' ').pop()}</span>}
          </span>
          <span className="cx-hub-bar"><i style={{ width: `${L.pct}%` }} /></span>
          <span className="cx-hub-pl-h cx-muted"><span className="cx-num">{fmt(L.xp)} / {fmt(L.next)} XP</span><span className="cx-hub-sp" /><span>{fmt(L.toGo)} to go</span></span>
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
