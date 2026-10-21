/**
 * What goes inside a console widget frame, by type.
 *
 * Classic bodies are REUSED (imported, never edited) and restyled from
 * outside in hub.css under the console scope. The few classic bodies that
 * are not exported (habits, holidays, recent wins, coin activity, the
 * link cards) get small console versions here. Every per-widget setting a
 * body changes (picks, count, prime blocks) is written to the S.hubGrid
 * item through `patch`, never to S.hubWidgets / S.mobileWidgets.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import Icon from '../../../components/Icon';
import WidgetBoundary from '../../../components/WidgetBoundary';
import { VitalsBody, BurnBody, MacrosBody } from '../../../components/mobile/MobileWidget';
import { BodyBody } from '../../../components/widgets/LifeWidgets';
import { GoalsBody, BodyGoalBody } from '../../../components/widgets/GoalsWidget';
import MarketBody from '../../../components/widgets/MarketWidget';
import NewsBody from '../../../components/widgets/NewsWidget';
import { PrimeFit } from '../../../components/widgets/prime/PrimeCard';
import { primeOf } from '../../../lib/hub/primeBlocks';
import { getAppPreset, RETIRED_PRESETS } from '../../../data/appPresets';
import { tradingWidgetAvailable, TRADING_WIDGET_BUILD_EXCLUDED } from '../../../lib/trading/enabled';
import { applyRelapse } from '../../../lib/habits/relapse';
import { strikeState } from '../../../lib/habits/strikes';
import { isCut, current as cutCurrent } from '../../../lib/habits/cutdown';
import { habitElapsed, cutHeadline } from '../../../lib/habits/progress';
import { timeAgo } from '../../../utils/helpers';
import TodayWidget from './TodayWidget';
import LeagueWidget from './LeagueWidget';
import UpNextWidget from './UpNextWidget';
import FriendsWidget from './FriendsWidget';

const TradingBody = TRADING_WIDGET_BUILD_EXCLUDED ? null : lazy(() => import('../../../components/widgets/TradingWidget'));

/**
 * ctx: { S, update, navigate, userId, hasPro, isMobile, size, patch,
 *        onOpenPaywall, onShowCoinToast, onOpenFriend, onPrimeAct, friendsHub }
 */
export function renderBody(item, ctx) {
  const { S, update, navigate, userId, hasPro, isMobile, size, patch } = ctx;
  const setPicks = picks => patch(w => ({ ...w, picks }));
  if (primeOf(item)) {
    return (
      <PrimeFit
        auto={isMobile}
        grow={!isMobile}
        head={false}
        widget={item}
        S={S}
        userId={userId}
        onAct={ctx.onPrimeAct}
      />
    );
  }
  const preset = getAppPreset(item.type);
  if (preset) return <PresetBody preset={preset} />;
  if (RETIRED_PRESETS[item.type]) {
    return <p className="cx-hub-empty">{RETIRED_PRESETS[item.type]} has been removed. Remove this widget from its menu.</p>;
  }
  switch (item.type) {
    case 'today':    return <TodayWidget S={S} update={update} navigate={navigate} size={size} isMobile={isMobile} onShowCoinToast={ctx.onShowCoinToast} />;
    case 'league':   return <LeagueWidget S={S} navigate={navigate} size={size} isMobile={isMobile} friendsHub={ctx.friendsHub} />;
    case 'friends':  return <FriendsWidget hub={ctx.friendsHub} size={size} isMobile={isMobile} navigate={navigate} />;
    case 'upnext':   return <UpNextWidget S={S} navigate={navigate} size={size} />;
    case 'coins':    return <CoinsBody S={S} navigate={navigate} size={size} />;
    case 'vitals':   return <VitalsBody S={S} update={update} picks={item.picks} onSetPicks={setPicks} />;
    case 'calories': return <BurnBody S={S} update={update} userId={userId} />;
    case 'macros':   return <MacrosBody S={S} userId={userId} navigate={navigate} />;
    case 'body':     return <BodyBody S={S} update={update} navigate={navigate} />;
    case 'goals':    return <GoalsBody S={S} picks={item.picks} onSetPicks={setPicks} compact={isMobile} navigate={navigate} hasPro={hasPro} />;
    case 'body-goal': return <BodyGoalBody S={S} update={update} navigate={navigate} userId={userId} hasPro={hasPro} onUpgrade={() => ctx.onOpenPaywall?.('generic')} />;
    case 'market':   return <MarketBody S={S} update={update} hasPro={hasPro} compact={isMobile} />;
    case 'news':     return <NewsBody S={S} update={update} hasPro={hasPro} compact={isMobile} />;
    case 'trading':  return (TradingBody && tradingWidgetAvailable())
      ? <Suspense fallback={null}><TradingBody compact={isMobile} /></Suspense> : null;
    case 'habits':   return <HabitsBody S={S} update={update} navigate={navigate} size={size} />;
    case 'holidays': return <HolidaysBody S={S} navigate={navigate} />;
    case 'recent-wins': return <RecentWinsBody S={S} />;
    case 'coin-history': return <CoinHistoryBody S={S} />;
    case 'github':   return <LinkCardBody S={S} kind="github" />;
    case 'linkedin': return <LinkCardBody S={S} kind="linkedin" />;
    default:         return <p className="cx-hub-empty">This widget isn’t available in the new design yet.</p>;
  }
}

export default function WidgetBody(props) {
  return <WidgetBoundary name={props.item.type}>{renderBody(props.item, props.ctx)}</WidgetBoundary>;
}

/* ── Console bodies ────────────────────────────────────────────────── */

const fmt = n => Number(n || 0).toLocaleString('en-GB');

function CoinsBody({ S, navigate, size }) {
  const coins = S.coins || 0;
  const hist = Array.isArray(S.coinHistory) ? S.coinHistory : [];
  const now = Date.now();
  const sumSince = ms => hist.reduce((a, h) => a + ((h.ts || 0) >= ms && h.amount > 0 && h.type !== 'spend' ? h.amount : 0), 0);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const week = sumSince(now - 7 * 86400000);
  const today = sumSince(d0.getTime());
  const next = (S.shopItems || []).filter(i => i && Number(i.cost) > coins).sort((a, b) => a.cost - b.cost)[0]
    || (S.shopItems || []).filter(i => i && Number(i.cost) > 0).sort((a, b) => b.cost - a.cost)[0];
  return (
    <div className="cx-hub-kpi-wrap">
      <div className="cx-hub-kpi">
        <span className="cx-num cx-hub-kpi-v">{fmt(coins)}</span>
        <span className="cx-hub-kpi-l">
          <span className="cx-num cx-accent">+{fmt(week)}</span> this week · <span className="cx-num">+{fmt(today)}</span> today
        </span>
      </div>
      {next && (
        <button type="button" className="cx-hub-foot-row" onClick={() => navigate?.('shop')}>
          <span className="cx-muted">Next reward</span>
          <span className="cx-hub-sp" />
          <span className="cx-mid cx-hub-ell">{next.name} · <span className="cx-num">{fmt(next.cost)}</span></span>
        </button>
      )}
      {size !== 'small' && next && (
        <div className="cx-hub-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round((coins / next.cost) * 100))}%` }} /></div>
      )}
    </div>
  );
}

function fmtElapsed(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function nextMilestone(h, elapsed) {
  const ms = (h.milestones || []).slice().sort((a, b) => a.duration - b.duration);
  if (!ms.length) return { pct: 0, label: null };
  const next = ms.find(m => m.duration > elapsed);
  const target = next ? next.duration : ms[ms.length - 1].duration;
  return { pct: Math.max(0, Math.min(100, target ? (elapsed / target) * 100 : 100)), label: next ? `next ${next.label}` : 'All milestones hit' };
}

/** Standalone Habits: live timers, two-tap relapse, tap a row for the page. */
function HabitsBody({ S, update, navigate, size }) {
  const [, setTick] = useState(0);
  const [arming, setArming] = useState(null);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!arming) return undefined;
    const id = setTimeout(() => setArming(null), 4000);
    return () => clearTimeout(id);
  }, [arming]);
  const habits = (S.habits || []).filter(h => h && h.startTime).slice()
    .sort((a, b) => a.startTime - b.startTime).slice(0, size === 'large' ? 8 : 4);
  if (!habits.length) return <p className="cx-hub-empty">No habits running.</p>;
  const now = Date.now();
  return (
    <ul className="cx-hub-list">
      {habits.map(h => {
        const elapsed = habitElapsed(h, now);
        const cut = isCut(h);
        const { pct, label } = nextMilestone(h, elapsed);
        const st = cut ? (cutCurrent(h, now).state === 'over' ? 'is-warn' : '') : strikeState(h, now).state === 'struck' ? 'is-warn' : '';
        return (
          <li key={h.id} className="cx-hub-habit">
            <button type="button" className="cx-hub-habit-main" onClick={() => navigate?.('habits')}>
              <span className="cx-hub-habit-top">
                <span className="cx-hub-ell">{h.name}</span>
                <span className={`cx-num cx-hub-habit-t ${st}`}>{cut ? cutHeadline(h, now) : fmtElapsed(elapsed)}</span>
              </span>
              <span className="cx-hub-bar"><i className={st} style={{ width: `${pct}%` }} /></span>
              {label && <span className="cx-hub-sub">{label}</span>}
            </button>
            <button
              type="button"
              className={`cx-hub-mini${arming === h.id ? ' is-arming' : ''}`}
              onClick={() => {
                if (arming !== h.id) { setArming(h.id); return; }
                setArming(null);
                update(prev => applyRelapse(prev, h.id, Date.now()));
              }}
              aria-label={arming === h.id ? `Confirm for ${h.name}` : cut ? `Log today for ${h.name}` : `Log a relapse for ${h.name}`}
              title={arming === h.id ? 'Tap again to log it' : cut ? 'Log today against the budget' : 'Log a relapse, now'}
            >
              {arming === h.id ? 'Sure?' : <Icon name={cut ? 'plus' : 'rotate-ccw'} size={14} strokeWidth={1.75} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HolidaysBody({ S, navigate }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trips = (S.holidays || []).filter(h => h && h.status !== 'completed').map(h => {
    let dep = null;
    if (h.from) { dep = new Date(h.from); dep.setHours(0, 0, 0, 0); }
    return { h, dep };
  }).filter(x => !x.dep || x.dep >= today)
    .sort((a, b) => (!a.dep ? 1 : !b.dep ? -1 : a.dep - b.dep)).slice(0, 4);
  if (!trips.length) return <p className="cx-hub-empty">No upcoming trips.</p>;
  return (
    <ul className="cx-hub-list">
      {trips.map(({ h, dep }) => {
        const days = dep ? Math.round((dep - today) / 86400000) : null;
        return (
          <li key={h.id}>
            <button type="button" className="cx-hub-row" onClick={() => navigate?.('holiday')}>
              <Icon name="plane" size={14} strokeWidth={1.75} />
              <span className="cx-hub-ell">{h.name || h.destination || 'Trip'}</span>
              <span className="cx-hub-sp" />
              <span className="cx-num cx-muted">{days == null ? 'TBC' : days === 0 ? 'Today' : `${days}d`}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RecentWinsBody({ S }) {
  const wins = (S.achievements || []).filter(a => a && a.completed)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 3);
  if (!wins.length) return <p className="cx-hub-empty">No completed achievements yet.</p>;
  return (
    <ul className="cx-hub-list">
      {wins.map(a => (
        <li key={a.id} className="cx-hub-row is-static">
          <span className="cx-gold" aria-hidden="true">◆</span>
          <span className="cx-hub-ell">{a.name}</span>
          <span className="cx-hub-sp" />
          {a.coins > 0 && <span className="cx-num cx-muted">+{a.coins}</span>}
        </li>
      ))}
    </ul>
  );
}

function CoinHistoryBody({ S }) {
  const hist = (Array.isArray(S.coinHistory) ? S.coinHistory : []).slice(0, 5);
  return (
    <div className="cx-hub-kpi-wrap">
      <span className="cx-num cx-hub-kpi-v">{fmt(S.coins || 0)}</span>
      <ul className="cx-hub-list">
        {hist.map((h, i) => {
          const neg = h.type === 'spend' || h.type === 'refund' || h.amount < 0;
          return (
            <li key={i} className="cx-hub-row is-static">
              <span className={`cx-num ${neg ? 'cx-danger' : 'cx-accent'}`}>{neg ? '−' : '+'}{fmt(Math.abs(h.amount))}</span>
              <span className="cx-hub-ell">{h.label}</span>
              <span className="cx-hub-sp" />
              {h.ts && <span className="cx-muted cx-hub-nowrap">{timeAgo(new Date(h.ts))}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LinkCardBody({ S, kind }) {
  const link = kind === 'github'
    ? (S.links || []).find(l => l && l.ghUser)
    : (S.links || []).find(l => l && /linkedin\.com/i.test(l.url || ''));
  if (!link) return <p className="cx-hub-empty">Add a {kind === 'github' ? 'GitHub' : 'LinkedIn'} link first.</p>;
  const cached = kind === 'github' ? (S.ghCache || {})[link.ghUser] : null;
  const host = String(link.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const safe = /^https?:\/\//i.test(link.url || '') ? link.url : null;
  return (
    <div className="cx-hub-kpi-wrap">
      <span className="cx-hub-ell cx-mid">{host}</span>
      {cached?.user && (
        <div className="cx-hub-stats">
          <span><b className="cx-num">{cached.user.public_repos}</b> repos</span>
          <span><b className="cx-num">{cached.user.followers}</b> followers</span>
        </div>
      )}
      {safe && <a className="cx-btn cx-btn--ghost cx-hub-open" href={safe} target="_blank" rel="noreferrer">Open <Icon name="external-link" size={14} /></a>}
    </div>
  );
}

function PresetBody({ preset }) {
  const host = preset.url ? preset.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  return (
    <div className="cx-hub-kpi-wrap">
      <span className="cx-mid">{preset.tagline}</span>
      <span className="cx-muted cx-hub-ell">{host}</span>
      {preset.url && <a className="cx-btn cx-btn--ghost cx-hub-open" href={preset.url} target="_blank" rel="noreferrer">Open <Icon name="external-link" size={14} /></a>}
    </div>
  );
}
