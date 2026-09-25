/**
 * Real numbers for prime blocks.
 *
 * Every block is a small function from the user's state to the payload
 * one of the shared views draws. Two payloads each: `d` for full and
 * compact, `s` for the one-line fact.
 *
 * ── Why the adapters live apart from the views ───────────────────────
 * The views are pure markup and know nothing about savings or habits;
 * the packer is pure geometry and knows nothing about either. This file
 * is the only place that reads `S`, which means a new block is a
 * function here plus two view ids in the registry — not new markup, not
 * new layout code.
 *
 * ── Empty is a real case ─────────────────────────────────────────────
 * A block whose store is empty still has to render: the user ticked it,
 * and a blank rectangle is the "500 apps in one" complaint in miniature.
 * Every adapter therefore returns something truthful when it has nothing
 * — "No pots yet", "—" — rather than crashing or drawing an empty frame.
 *
 * Pure apart from `Date.now()`. No React, no network.
 */
import {
  money, potTotals, flowTotals, flowSections, cashSeries,
  toMonthly, potColor, sectionColor,
} from '../savings/derive.js';
import { subsStats, daysUntil } from '../money/recurring.js';
import { balanceNow } from '../savings/interest.js';
import { livePots } from '../savings/completePot.js';
import { strikeState } from '../habits/strikes.js';
import { coinsToday } from '../coins/daily.js';
import { ledgerRows } from '../coins/ledger.js';
import { dayBurn } from '../burn.js';
import { planDayFor, planGoalFor } from '../plan/planDay.js';
import { VITAL_METRICS, fmtMetric } from '../vitals/metrics.js';

/* ── Small shared shapes ──────────────────────────────────────────── */

const PALETTE = ['#2fbf83', '#5b8cff', '#d0498f', '#d99114', '#12a5a5', '#7a4fd0', '#c0563f', '#4dc485'];
const GREEN = { col: '#1a7a4a', fillCol: 'rgba(26,122,74,.12)', lvc: 'var(--em)' };
const RED = { col: '#c0392b', fillCol: 'rgba(192,57,43,.10)', lvc: 'var(--danger)' };
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(t => ({ t }));

const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0);
const clampPct = v => Math.max(0, Math.min(100, Math.round(v)));

/** An SVG path pair for a sparkline, normalised into the 100×40 viewBox. */
export function series(values, pad = 2) {
  const v = (values || []).filter(x => Number.isFinite(x));
  if (v.length < 2) return { line: 'M0,20L100,20', area: 'M0,20L100,20L100,40L0,40Z' };
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => [
    (i / (v.length - 1)) * 100,
    40 - pad - ((x - lo) / span) * (38 - pad),
  ]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  return { line, area: line + 'L100,40L0,40Z' };
}

const bars = rows => rows.map(([n, p, col, r, cur]) => ({
  n, pct: clampPct(p), col, r, pctTxt: clampPct(p) + '%', fill: col + '55', cur: cur ?? r,
}));

const heatCell = v => ({
  bg: v === 2 ? '#2fbf83' : v === 1 ? 'rgba(47,191,131,.38)' : v === 0 ? 'rgba(192,57,43,.22)' : 'var(--well, rgba(128,128,128,.14))',
});

const ymd = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Elapsed time, in the shortest form that is still precise enough. */
function elapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const EMPTY_HERO = (label, why) => ({
  d: { label, big: '—', subA: '', sub: why, r1A: '', r1: '', r2: why },
  s: { fl: label.slice(0, 7), fv: '—' },
});
const EMPTY_LIST = (head, why) => ({
  d: { head, headR: '', headRs: '', rows: [{ n: why, m: '', mc: 'var(--text-muted)', v: '' }],
       big: '—', bigSub: '', line: why, tiles: [{ t: why, v: '—' }] },
  s: { fl: head.slice(0, 7), fv: '—' },
});

/* ── Savings ──────────────────────────────────────────────────────── */

const savingsBlocks = {
  total(S) {
    const goals = livePots(S.savings);
    if (!goals.length) return EMPTY_HERO('TOTAL SAVED', 'No pots yet');
    const t = potTotals(goals, S.projection?.items || [], S.savingsAccounts || []);
    const monthly = t.routed;
    return {
      d: {
        label: 'TOTAL SAVED',
        big: money(t.saved),
        subA: monthly > 0 ? `+${money(monthly)}` : '',
        sub: monthly > 0
          ? ` a month · ${Math.round(t.pct * 100)}% of ${money(t.target)}`
          : `${Math.round(t.pct * 100)}% of ${money(t.target)}`,
        r1A: monthly > 0 ? `+${money(monthly)}` : '',
        r1: monthly > 0 ? ' /mo' : '',
        r2: `${Math.round(t.pct * 100)}% of goal`,
      },
      s: { fl: 'SAVED', fv: money(t.saved) },
    };
  },

  pots(S, opts) {
    let goals = livePots(S.savings);
    if (opts?.picks?.length) goals = goals.filter(g => opts.picks.includes(g.id));
    if (opts?.count) goals = goals.slice(0, Math.max(1, opts.count));
    if (!goals.length) {
      return { d: { items: bars([['No pots yet', 0, PALETTE[0], '', 'Add one in Savings']]) },
               s: { fl: 'POTS', fv: 'none yet' } };
    }
    const items = bars(goals.slice(0, 6).map((g, i) => {
      const cur = Number(g.current) || 0;
      const tgt = Number(g.target) || 0;
      return [g.name || 'Pot', pct(cur, tgt), potColor(g, i), '', money(cur)];
    }));
    const best = items.reduce((a, b) => (b.pct > a.pct ? b : a), items[0]);
    return { d: { items }, s: { fl: 'POTS', fv: `${best.n} ${best.pct}% · ${goals.length}` } };
  },

  projection(S) {
    const items = S.projection?.items || [];
    const goals = livePots(S.savings);
    const { monthly: bills } = subsStats({ subscriptions: S.subscriptions });
    const flow = flowTotals(items, goals, S.savingsAccounts || [], new Date(), bills);
    const t = potTotals(goals, items, S.savingsAccounts || []);
    const horizon = 24;
    const cash = cashSeries(t.saved, items, horizon, new Date(), bills);
    const end = cash[cash.length - 1];
    return {
      d: {
        ll: 'NET / MONTH',
        lv: (flow.net >= 0 ? '+' : '') + money(flow.net),
        rl: 'IN 2Y',
        rv: money(end),
        mx: -1,
        ax0: 'now', ax1: '1y', ax2: '2y',
        v1: (flow.net >= 0 ? '+' : '') + money(flow.net) + '/mo',
        v2: money(end) + ' in 2y',
        ...(flow.net >= 0 ? GREEN : RED),
        ...series(cash),
      },
      s: { fl: 'RUNWAY', fvA: (flow.net >= 0 ? '+' : '') + money(flow.net), fv: ` → ${money(end)}` },
    };
  },

  accounts(S) {
    const list = S.savingsAccounts || [];
    if (!list.length) return EMPTY_LIST('ACCOUNTS', 'No accounts added');
    const rows = list.slice(0, 6).map(a => ({
      n: a.name || 'Account',
      m: a.apy ? `${a.apy}%` : '',
      mc: 'var(--em)',
      v: money(balanceNow(a)),
    }));
    const best = list.reduce((b, a) => Math.max(b, parseFloat(a.apy) || 0), 0);
    return {
      d: {
        head: 'ACCOUNTS', headR: '', headRs: '', rows,
        tiles: rows.slice(0, 2).map(r => ({ t: `${r.n}${r.m ? ' · ' + r.m : ''}`, v: r.v })),
        big: `${list.length}`, bigSub: list.length === 1 ? 'account' : 'accounts',
        line: best ? `Best rate ${best}%` : 'No rates set',
      },
      s: { fl: 'ACCTS', fv: `${list.length}${best ? ` · best ${best}%` : ''}` },
    };
  },

  bills(S) {
    const { subs, monthly, upcoming, all } = subsStats(S);
    if (!subs.length) return EMPTY_LIST('BILLS · NEXT UP', 'No bills tracked');
    // Dated ones first, soonest first; a bill with no renewal date still
    // lists (it still costs money), it just has no countdown.
    const rows = all.slice(0, 6).map(x => {
      const n = x.due ? daysUntil(x.due) : null;
      return {
        n: x.name || 'Bill',
        m: n == null ? '' : n === 0 ? 'today' : n === 1 ? '1d' : `${n}d`,
        mc: n != null && n <= 3 ? 'var(--gold)' : 'var(--text-muted)',
        v: money(toMonthly(x.amount, x.freq)),
      };
    });
    const next = upcoming[0];
    return {
      d: {
        head: 'BILLS · NEXT UP',
        headR: money(monthly), headRs: '/mo',
        rows,
        big: money(monthly), bigSub: 'a month in bills',
        line: next ? `Next: ${next.name} in ${daysUntil(next.due)} days` : `${subs.length} tracked`,
      },
      s: { fl: 'BILLS', fv: `${money(monthly)}/mo${next ? ` · ${daysUntil(next.due)}d` : ''}` },
    };
  },

  month(S) {
    const items = S.projection?.items || [];
    const { monthly: bills, subs } = subsStats({ subscriptions: S.subscriptions });
    const flow = flowTotals(items, S.savings || [], S.savingsAccounts || [], new Date(), bills);
    const secs = flowSections(items, S.projection?.groups || [], new Date(), { amount: bills, count: subs.length });
    if (!flow.income) {
      return { d: { head: 'WHERE THE MONTH GOES', headR: 'NO INCOME SET',
                    segs: [{ n: 'Add income', pct: 100, col: 'var(--border)' }],
                    l: 'This month', rA: '', r: 'no income set' },
               s: { fl: 'MONTH', fv: 'no income set' } };
    }
    // `v` and `sub` are what the band's popup says when hovered/tapped.
    const segs = secs.slice(0, 4).map((sec, i) => ({
      n: sec.label, pct: clampPct(sec.share * 100), col: sectionColor(sec, i),
      v: `${money(sec.amount)}/mo`,
      sub: `${Math.round(sec.share * 100)}% of income${sec.count > 1 ? ` · ${sec.count} items` : ''}`,
    }));
    /* A fifth section and beyond folds into one band rather than being
       dropped: the bar has to add up to the income it claims to split. */
    const rest = secs.slice(4);
    if (rest.length) {
      const amt = rest.reduce((a, x) => a + x.amount, 0);
      segs.push({ n: 'Other', pct: clampPct((amt / flow.income) * 100), col: '#8a8f98',
                  v: `${money(amt)}/mo`, sub: `${Math.round((amt / flow.income) * 100)}% of income · ${rest.length} more` });
    }
    const left = clampPct((Math.max(0, flow.net) / flow.income) * 100);
    segs.push({ n: 'Left over', pct: left, col: '#2fbf83',
                v: `${money(Math.max(0, flow.net))}/mo`, sub: `${left}% of income` });
    const month = new Date().toLocaleDateString('en-GB', { month: 'long' }).toUpperCase();
    return {
      d: {
        head: `WHERE ${month} GOES`, headR: `${money(flow.income)} IN`, segs,
        l: new Date().toLocaleDateString('en-GB', { month: 'long' }),
        rA: `${left}%`, r: ' left over',
      },
      s: { fl: 'MONTH', fv: `${left}% left over` },
    };
  },

  plan(S) {
    const items = S.projection?.items || [];
    const goals = livePots(S.savings);
    const routed = items.filter(i => i.kind === 'expense' && (i.goalId || i.accountId));
    if (!routed.length) {
      return { d: { eyebrow: 'MONTHLY PLAN', right: '', title: 'Nothing routed yet',
                    chips: [{ t: 'Set a standing amount in Savings', ghost: true }],
                    t: 'No plan set', r: '—' },
               s: { fl: 'PLAN', fv: 'none set' } };
    }
    const total = routed.reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
    const chips = routed.slice(0, 3).map(i => {
      const g = goals.find(x => x.id === i.goalId);
      return { t: `${g ? g.name : i.label || 'Routed'} +${money(toMonthly(i.amount, i.freq))}`, ghost: false };
    });
    const month = new Date().toLocaleDateString('en-GB', { month: 'short' });
    return {
      d: {
        eyebrow: `${month.toUpperCase()} PLAN`,
        right: `${routed.length} routed`,
        title: `${money(total)} into ${routed.length} ${routed.length === 1 ? 'pot' : 'pots'}`,
        chips,
        t: `${month} · ${money(total)} routed`, r: `${routed.length}`,
      },
      s: { fl: 'PLAN', fv: `${money(total)}/mo` },
    };
  },
};

/* ── Trackers ─────────────────────────────────────────────────────── */

const trackerBlocks = {
  today(S) {
    const list = S.trackers || [];
    if (!list.length) return { d: { head: 'TODAY', headR: '0 / 0',
      rows: [{ n: 'No trackers yet', v: '', ck: '', bg: 'transparent', bd: 'var(--border)', fg: 'var(--text-mid)' }],
      dots: [], txt: 'No trackers yet', sub: 'Add one in Track' }, s: { fl: 'TODAY', fv: 'none yet' } };
    const today = (S.logs || {})[ymd(Date.now())] || {};
    /* A number tracker's `goal` is its MONTHLY target (the add form
       labels it so), so one day's entry is never measured against it —
       any amount logged today is today done. */
    const done = t => {
      const v = today[t.id];
      return t.type === 'boolean' ? !!v : (Number(v) || 0) > 0;
    };
    const hit = list.filter(done).length;
    const rows = list.slice(0, 8).map(t => {
      const d = done(t);
      const v = t.type === 'boolean' ? '' : `${t.unit === '£' ? '£' : ''}${Number(today[t.id]) || 0}${t.unit && t.unit !== '£' ? t.unit : ''}`;
      return { n: t.name || 'Tracker', v, ck: d ? '✓' : '',
               bg: d ? '#2fbf83' : 'transparent', bd: d ? '#2fbf83' : 'var(--border)',
               fg: d ? 'var(--text-mid)' : 'var(--text)' };
    });
    const left = list.filter(t => !done(t)).slice(0, 2).map(t => t.name).join(', ');
    return {
      d: { head: 'TODAY', headR: `${hit} / ${list.length}`, rows,
           dots: list.slice(0, 8).map(t => ({ bg: done(t) ? '#2fbf83' : 'transparent', bd: done(t) ? '#2fbf83' : 'var(--border)' })),
           txt: `${hit} of ${list.length} done`, sub: left ? `${left} left` : 'All done' },
      s: { fl: 'TODAY', fv: `${hit}/${list.length} done` },
    };
  },

  streaks(S) {
    const streaks = S.streaks || {};
    const list = S.trackers || [];
    const entries = list
      .map(t => ({ name: t.name || 'Tracker', cur: streaks[t.id]?.current || 0 }))
      .sort((a, b) => b.cur - a.cur);
    const best = entries[0];
    if (!best || !best.cur) return EMPTY_HERO('LONGEST ACTIVE STREAK', 'No streaks running');
    const onStreak = entries.filter(e => e.cur > 0).length;
    return {
      d: { label: 'LONGEST ACTIVE STREAK', big: `${best.cur} ${best.cur === 1 ? 'day' : 'days'}`,
           subA: best.name, sub: ` · ${onStreak} of ${list.length} on a streak`,
           r1A: best.name, r1: '', r2: `${onStreak} on streaks` },
      s: { fl: 'STREAK', fv: `${best.cur}d · ${best.name}` },
    };
  },

  targets(S) {
    const list = (S.trackers || []).filter(t => Number(t.weeklyTarget) > 0);
    if (!list.length) {
      return { d: { items: bars([['No weekly targets', 0, PALETTE[1], 'set one in Track']]) },
               s: { fl: 'WEEK', fv: 'none set' } };
    }
    const logs = S.logs || {};
    const now = Date.now();
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const items = bars(list.slice(0, 5).map((t, i) => {
      let hits = 0;
      for (let d = new Date(monday); d <= new Date(now); d.setDate(d.getDate() + 1)) {
        const v = logs[ymd(d)]?.[t.id];
        if (t.type === 'boolean' ? !!v : (Number(v) || 0) > 0) hits++;
      }
      const target = Number(t.weeklyTarget) || 1;
      return [`${t.name} · ${target}×`, pct(hits, target), potColor(t, i), `${hits} / ${target}`];
    }));
    const avg = Math.round(items.reduce((s, i) => s + i.pct, 0) / items.length);
    return { d: { items }, s: { fl: 'WEEK', fv: `${avg}% of targets` } };
  },

  nodes(S) {
    const list = (S.trackers || []).slice(0, 7);
    if (!list.length) {
      return { d: { head: 'THIS WEEK', days: DAYS, rows: [{ n: 'No trackers yet', cells: DAYS.map(() => heatCell(-1)) }],
                    dots: [], txt: 'No trackers yet', sub: 'Add one in Track' },
               s: { fl: 'NODES', fv: 'none yet' } };
    }
    const logs = S.logs || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return d;
    });
    const cellFor = (t, d) => {
      if (d > today) return -1;                      // hasn't happened yet
      const v = logs[ymd(d)]?.[t.id];
      if (t.type === 'boolean') return v ? 2 : 0;
      const num = Number(v) || 0;
      if (!num) return 0;
      return num >= (Number(t.goal) || 1) ? 2 : 1;
    };
    const rows = list.map(t => ({ n: t.name || 'Tracker', cells: week.map(d => heatCell(cellFor(t, d))) }));
    const perfect = week.filter(d => d <= today && list.every(t => cellFor(t, d) === 2));
    const names = perfect.map(d => d.toLocaleDateString('en-GB', { weekday: 'short' }));
    const left = week.filter(d => d > today).length;
    return {
      d: { head: 'THIS WEEK', days: DAYS, rows,
           dots: week.map(d => {
             if (d > today) return { bg: 'transparent', bd: 'var(--border)' };
             const all = list.every(t => cellFor(t, d) === 2);
             const some = list.some(t => cellFor(t, d) >= 1);
             return { bg: all ? '#2fbf83' : some ? 'rgba(47,191,131,.38)' : 'transparent',
                      bd: some ? '#2fbf83' : 'var(--border)' };
           }),
           txt: `${perfect.length} perfect ${perfect.length === 1 ? 'day' : 'days'}`,
           sub: names.length ? `${names.join(', ')} · ${left} to go` : `${left} days to go` },
      s: { fl: 'NODES', fv: `${perfect.length} perfect` },
    };
  },
};

/* ── Achievements ─────────────────────────────────────────────────── */

const achievementBlocks = {
  next(S) {
    const open = (S.achievements || []).filter(a => !a.completed);
    if (!open.length) {
      return { d: { items: bars([['Nothing open', 0, PALETTE[3], 'all done']]) },
               s: { fl: 'NEXT UP', fv: 'nothing open' } };
    }
    const items = bars(open.slice(0, 5).map((a, i) => {
      const cur = Number(a.progress) || 0;
      const tgt = Number(a.target) || 0;
      return [a.name || 'Goal', tgt ? pct(cur, tgt) : 0, potColor(a, i), tgt ? `${cur} / ${tgt}` : 'open'];
    }));
    const lead = items.reduce((a, b) => (b.pct > a.pct ? b : a), items[0]);
    return { d: { items }, s: { fl: 'NEXT UP', fv: `${lead.n} ${lead.pct}%` } };
  },

  coins(S) {
    const bal = Number(S.coins) || 0;
    const week = (S.coinHistory || []).filter(e => {
      const ts = Number(e?.ts);
      return Number.isFinite(ts) && ts > Date.now() - 7 * 86400000;
    }).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const today = coinsToday(S.coinHistory);
    return {
      d: { label: 'COIN BALANCE', big: `${bal.toLocaleString('en-GB')} ⬡`,
           subA: week ? `${week > 0 ? '+' : ''}${week}` : '',
           sub: week ? ' this week' : ` · ${(S.coinHistory || []).length} ledger entries`,
           r1A: week ? `${week > 0 ? '+' : ''}${week}` : '', r1: week ? ' this week' : '',
           r2: today ? `${today > 0 ? '+' : ''}${today} today` : `${(S.coinHistory || []).length} entries` },
      s: { fl: 'COINS', fv: `${bal.toLocaleString('en-GB')} ⬡` },
    };
  },

  recent(S) {
    const rows = ledgerRows(S.coinHistory, new Date(), 6);
    if (!rows.length) return EMPTY_LIST('RECENT WINS', 'Nothing earned yet');
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = (S.coinHistory || []).filter(e => Number(e?.ts) >= monthStart.getTime() && Number(e?.amount) > 0).length;
    return {
      d: { head: 'RECENT WINS', headR: `${thisMonth}`, headRs: ' this month',
           rows: rows.map(r => ({ n: r.label, m: r.when, mc: 'var(--text-muted)', v: `${r.amountLabel} ⬡` })),
           big: `${thisMonth}`, bigSub: thisMonth === 1 ? 'win this month' : 'wins this month',
           line: `Latest: ${rows[0].label} · ${rows[0].amountLabel} ⬡` },
      s: { fl: 'WINS', fv: `${thisMonth} this month` },
    };
  },

  visions(S) {
    const stamped = Object.keys(S.visions || {});
    if (!stamped.length) {
      return { d: { items: bars([['No visions yet', 0, PALETTE[2], '', 'keep logging']]) },
               s: { fl: 'VISIONS', fv: 'none yet' } };
    }
    const cats = ['brain', 'finance', 'fitness', 'social'];
    const r = S.ratings || {};
    const items = bars(cats.map((c, i) => [
      c.charAt(0).toUpperCase() + c.slice(1),
      clampPct(((r[c] || 1) / 99) * 100),
      PALETTE[i],
      '',
      `${r[c] || 1}`,
    ]));
    const top = items.reduce((a, b) => (b.pct > a.pct ? b : a), items[0]);
    return { d: { items }, s: { fl: 'VISIONS', fv: `${top.n} ${top.cur}` } };
  },
};

/* ── Holidays ─────────────────────────────────────────────────────── */

const holidayBlocks = {
  countdown(S) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const trips = (S.holidays || [])
      .filter(h => h.status !== 'completed' && h.from)
      .map(h => ({ h, dep: new Date(h.from) }))
      .filter(x => !isNaN(x.dep) && x.dep >= today)
      .sort((a, b) => a.dep - b.dep);
    if (!trips.length) return EMPTY_HERO('NEXT TRIP', 'Nothing booked');
    const { h, dep } = trips[0];
    const days = Math.round((dep - today) / 86400000);
    const nights = h.to ? Math.max(0, Math.round((new Date(h.to) - dep) / 86400000)) : null;
    return {
      d: { label: `NEXT TRIP · ${(h.dest || 'TRIP').toUpperCase()}`,
           big: days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`,
           subA: dep.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
           sub: nights ? ` · ${nights} nights` : '',
           r1A: h.dest || 'Trip', r1: ` · ${dep.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
           r2: nights ? `${nights} nights` : '' },
      s: { fl: 'NEXT', fv: `${h.dest || 'Trip'} · ${days}d` },
    };
  },

  itinerary(S) {
    const trip = (S.holidays || []).find(h => h.status !== 'completed' && (h.items || []).length);
    if (!trip) return EMPTY_LIST('ITINERARY', 'Nothing planned yet');
    const rows = (trip.items || []).slice(0, 6).map(it => ({
      n: it.title || it.name || 'Item',
      m: it.date ? new Date(it.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '',
      mc: 'var(--text-muted)',
      v: it.time || '',
    }));
    return {
      d: { head: `${(trip.dest || 'TRIP').toUpperCase()} · ITINERARY`,
           headR: `${(trip.items || []).length}`,
           headRs: (trip.items || []).length === 1 ? ' item' : ' items', rows,
           big: rows[0]?.n || '—', bigSub: 'first up',
           line: rows[0] ? `${rows[0].n}${rows[0].m ? ' · ' + rows[0].m : ''}` : 'Nothing planned' },
      s: { fl: 'LEGS', fv: `${(trip.items || []).length} ${(trip.items || []).length === 1 ? 'item' : 'items'}` },
    };
  },

  budget(S) {
    const trips = (S.holidays || []).filter(h => h.status !== 'completed' && Number(h.budget) > 0);
    if (!trips.length) {
      return { d: { items: bars([['No budgets set', 0, PALETTE[4], 'add one in Holidays']]) },
               s: { fl: 'BUDGET', fv: 'none set' } };
    }
    const goals = livePots(S.savings);
    const items = bars(trips.slice(0, 5).map((h, i) => {
      const budget = Number(h.budget) || 0;
      const pot = goals.find(g => g.id === h.savingsGoalId);
      const saved = pot ? Number(pot.current) || 0 : 0;
      return [h.dest || 'Trip', pct(saved, budget), PALETTE[i % PALETTE.length],
              `${money(saved)} / ${money(budget)}`];
    }));
    const totalB = trips.reduce((s, h) => s + (Number(h.budget) || 0), 0);
    const totalS = trips.reduce((s, h) => {
      const pot = goals.find(g => g.id === h.savingsGoalId);
      return s + (pot ? Number(pot.current) || 0 : 0);
    }, 0);
    return { d: { items }, s: { fl: 'BUDGET', fv: `${money(totalS)} / ${money(totalB)}` } };
  },

  trips(S) {
    const list = S.holidays || [];
    if (!list.length) return EMPTY_LIST('ALL TRIPS', 'No trips yet');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = list.slice(0, 6).map(h => {
      const dep = h.from ? new Date(h.from) : null;
      const days = dep && !isNaN(dep) ? Math.round((dep - today) / 86400000) : null;
      return {
        n: h.dest || 'Trip',
        m: dep && !isNaN(dep) ? dep.toLocaleDateString('en-GB', { month: 'short' }) : '—',
        mc: 'var(--text-muted)',
        v: days == null ? (h.status || 'planning') : days < 0 ? 'past' : days > 60 ? `${Math.round(days / 30)} mo` : `${days}d`,
      };
    });
    const next = rows.find(r => /\d+d$/.test(r.v));
    return {
      d: { head: 'ALL TRIPS', headR: `${list.length}`, headRs: '', rows,
           big: `${list.length}`, bigSub: list.length === 1 ? 'trip' : 'trips',
           line: next ? `Next: ${next.n} in ${next.v}` : `${list.length} on the board` },
      s: { fl: 'TRIPS', fv: `${list.length}${next ? ` · ${next.n}` : ''}` },
    };
  },
};

/* ── Habits ───────────────────────────────────────────────────────── */

function nextMilestone(h, now) {
  const ms = (h.milestones || []).slice().sort((a, b) => a.duration - b.duration);
  const el = now - (h.startTime || now);
  return { next: ms.find(m => m.duration > el) || null, elapsed: el, last: ms[ms.length - 1] || null };
}

/** Walk under a day, brisk to 4, jog to 7, run after — the Habits page
 *  runner's stage ladder (habits/HabitRunner), reduced to four paces. */
function paceFor(days) {
  if (days >= 7) return 'run';
  if (days >= 4) return 'jog';
  if (days >= 1) return 'brisk';
  return 'walk';
}

const habitBlocks = {
  timers(S) {
    const list = (S.habits || []).filter(h => h.startTime);
    if (!list.length) {
      return { d: { items: bars([['No habits yet', 0, PALETTE[2], 'add one in Habits']]) },
               s: { fl: 'LONGEST', fv: 'none yet' } };
    }
    const now = Date.now();
    const shown = list.slice(0, 5);
    const items = bars(shown.map((h, i) => {
      const { next, elapsed: el, last } = nextMilestone(h, now);
      const target = next ? next.duration : last ? last.duration : el || 1;
      return [`${h.name || 'Habit'}${next ? ` → ${next.label}` : ''}`,
              pct(el, target), potColor(h, i), elapsed(el)];
    }))
      // The relapse button, same as the standalone widget's: the card
      // host decides whether to honour it (it needs `update`).
      .map((it, i) => ({
        ...it,
        act: { kind: 'relapse', id: shown[i].id, name: shown[i].name || 'Habit' },
        // The little runner at the tip of the bar; its pace follows the
        // same ladder as the Habits page runner (walk → jog → run).
        runner: { pace: paceFor((now - shown[i].startTime) / 86400000) },
      }));
    const longest = list.reduce((a, b) => ((now - a.startTime) > (now - b.startTime) ? a : b));
    return { d: { items }, s: { fl: 'LONGEST', fv: `${longest.name} ${elapsed(now - longest.startTime)}` } };
  },

  next(S) {
    const list = (S.habits || []).filter(h => h.startTime);
    const now = Date.now();
    const soonest = list
      .map(h => ({ h, ...nextMilestone(h, now) }))
      .filter(x => x.next)
      .sort((a, b) => (a.next.duration - a.elapsed) - (b.next.duration - b.elapsed))[0];
    if (!soonest) return EMPTY_HERO('NEXT MILESTONE', 'No milestones left');
    const left = soonest.next.duration - soonest.elapsed;
    const days = Math.max(0, Math.ceil(left / 86400000));
    return {
      d: { label: 'NEXT MILESTONE', big: days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`,
           subA: soonest.h.name, sub: ` reaches ${soonest.next.label}${soonest.next.coins ? ` · +${soonest.next.coins} ⬡` : ''}`,
           r1A: soonest.h.name, r1: ` → ${soonest.next.label}`,
           r2: soonest.next.coins ? `+${soonest.next.coins} ⬡` : '' },
      s: { fl: 'NEXT', fv: `${soonest.next.label} in ${days}d` },
    };
  },

  strikes(S) {
    const list = (S.habits || []).filter(h => Number(h.strikesAllowed) > 0);
    if (!list.length) return EMPTY_LIST('STRIKES', 'No allowances set');
    const now = Date.now();
    const rows = list.slice(0, 6).map(h => {
      const st = strikeState(h, now);
      const used = st.used || 0;
      const allowed = st.allowed || 0;
      const left = Math.max(0, allowed - used);
      return { n: h.name || 'Habit',
               m: '●'.repeat(used) + '○'.repeat(left),
               mc: left === 0 ? 'var(--danger)' : 'var(--text-muted)',
               v: `${left} left` };
    });
    const tightest = rows.reduce((a, b) => (parseInt(b.v, 10) < parseInt(a.v, 10) ? b : a), rows[0]);
    return {
      d: { head: 'STRIKES THIS PERIOD', headR: '', headRs: '', rows,
           big: tightest.v, bigSub: `on ${tightest.n}`,
           line: `${list.length} ${list.length === 1 ? 'habit has' : 'habits have'} an allowance` },
      s: { fl: 'STRIKES', fv: `${tightest.n} ${tightest.v}` },
    };
  },

  relapses(S) {
    const list = S.habits || [];
    if (!list.length) {
      return { d: { ll: 'RELAPSES', lv: '—', rl: 'BEST GAP', rv: '—', mx: -1,
                    ax0: '', ax1: '', ax2: '', v1: '—', v2: 'no habits', ...RED, ...series([0, 0]) },
               s: { fl: 'RELAPSES', fv: '—' } };
    }
    // Relapses per week over the last 13, from every habit's strike log.
    const now = Date.now();
    const weeks = 13;
    const buckets = new Array(weeks).fill(0);
    list.forEach(h => (h.strikeTimes || []).forEach(t => {
      const age = now - Number(t);
      const w = Math.floor(age / (7 * 86400000));
      if (w >= 0 && w < weeks) buckets[weeks - 1 - w] += 1;
    }));
    const total = buckets.reduce((s, v) => s + v, 0);
    const longest = list.reduce((a, h) => Math.max(a, now - (h.startTime || now)), 0);
    return {
      d: { ll: `RELAPSES · ${weeks} WK`, lv: `${total}`, rl: 'LONGEST RUN', rv: elapsed(longest),
           mx: -1, ax0: `${weeks}w ago`, ax1: '', ax2: 'now',
           v1: `${total} in ${weeks} wk`, v2: `longest ${elapsed(longest)}`,
           ...RED, ...series(buckets) },
      s: { fl: 'RELAPSES', fvA: `${total}`, fv: ` in ${weeks} wk` },
    };
  },
};


/* ── Nutrition ─────────────────────────────────────────────────────
   `ext` is { macros, summary, loaded } from lib/diet/daySummary: the
   user's macro goals and today's totals from the nutrition tables. The
   history is S.macroHistory — { 'YYYY-MM-DD': { cal, pro, carb, fat } }
   as % of that day's goal, written by the Track page. */

const ORANGE = { col: '#e07a2f', fillCol: 'rgba(224,122,47,.12)', lvc: 'var(--text)' };
const BURN_COL = '#12a5a5';
const MACRO_ROWS = [
  ['Protein', 'protein_g', 'pro', '#5b8cff'],
  ['Carbs', 'carbs_g', 'carb', '#d99114'],
  ['Fat', 'fat_g', 'fat', '#d0498f'],
];
const kcal = n => `${Math.round(n).toLocaleString('en-GB')}`;

/** Today's figures, from the fetch when there is one, else from the
 *  history entry the Track page wrote (percentages only). */
function today(S, ext) {
  const day = ymd(Date.now());
  const hist = (S.macroHistory || {})[day] || null;
  const { activity, whoopTotal } = dayBurn(S, day);
  // Same burn figure the Calories Burned widget shows, so they agree.
  const burned = whoopTotal != null ? whoopTotal : activity;
  const fromWhoop = whoopTotal != null;
  const macros = (ext && ext.macros) || [];
  const live = !!(ext && ext.loaded && macros.length);
  if (live) {
    const plan = planDayFor(day, S);
    const goalOf = name => {
      const m = macros.find(x => x.name === name);
      return m ? (planGoalFor(plan, name) ?? m.daily_goal) || 0 : 0;
    };
    const sum = ext.summary || {};
    const calGoal = goalOf('Calories') || 2000;
    const eaten = Number(sum.calories) || 0;
    const rings = MACRO_ROWS
      .filter(([name]) => macros.some(m => m.name === name))
      .map(([name, field, , col]) => {
        const goal = goalOf(name);
        const got = Number(sum[field]) || 0;
        const m = macros.find(x => x.name === name);
        return { n: name, pct: goal > 0 ? Math.round((got / goal) * 100) : null, v: `${Math.round(got)}g`, col: (m && m.color) || col };
      });
    return { live, day, eaten, calGoal, burned, fromWhoop, net: Math.round(eaten - burned), rings,
             calPct: calGoal > 0 ? Math.round((eaten / calGoal) * 100) : 0 };
  }
  // Fallback: percentages from today's history entry, or nothing yet.
  const rings = MACRO_ROWS.map(([name, , key, col]) => ({
    n: name, pct: hist && hist[key] != null ? hist[key] : null, v: '', col,
  }));
  return { live: false, day, eaten: null, calGoal: null, burned, fromWhoop, net: null, rings,
           calPct: hist && hist.cal != null ? hist.cal : null };
}

const nutritionBlocks = {
  rings(S, _o, ext) {
    const t = today(S, ext);
    const burnPct = t.live && t.calGoal ? Math.round((t.burned / t.calGoal) * 100) : 0;
    const any = t.calPct != null || t.rings.some(r => r.pct != null);
    return {
      d: {
        cal: { pct: t.calPct, burnPct, net: t.net, eaten: t.eaten, burned: t.burned, goal: t.calGoal, burnCol: BURN_COL },
        rings: t.rings,
        empty: !any,
        act: { kind: 'logfood', name: 'food' },
      },
      s: { fl: 'MACROS', fv: t.calPct != null ? `${t.calPct}% kcal${t.rings[0] && t.rings[0].pct != null ? ` · P ${t.rings[0].pct}%` : ''}` : 'nothing logged' },
    };
  },

  net(S, _o, ext) {
    const t = today(S, ext);
    if (!t.live) {
      return {
        d: { label: 'NET CALORIES', big: t.calPct != null ? `${t.calPct}%` : '—',
             subA: '', sub: t.calPct != null ? ' of your calorie goal today' : ' nothing logged yet today',
             r1A: '', r1: t.calPct != null ? 'of goal' : 'nothing logged', r2: '' },
        s: { fl: 'NET', fv: t.calPct != null ? `${t.calPct}% of goal` : '—' },
      };
    }
    const left = t.calGoal - t.eaten;
    return {
      d: { label: 'NET CALORIES', big: kcal(t.net),
           subA: `${kcal(t.eaten)} eaten`, sub: ` · ${kcal(t.burned)} burned · goal ${kcal(t.calGoal)}`,
           r1A: kcal(t.eaten), r1: ` eaten · ${kcal(t.burned)} burned`,
           r2: left >= 0 ? `${kcal(left)} kcal left` : `${kcal(-left)} kcal over` },
      s: { fl: 'NET', fvA: kcal(t.net), fv: ' kcal' },
    };
  },

  burned(S) {
    const day = ymd(Date.now());
    const { bmr, activity, whoopTotal } = dayBurn(S, day);
    const fromWhoop = whoopTotal != null;
    const burned = fromWhoop ? whoopTotal : activity;
    const acts = (S.burnLog && S.burnLog[day]) || [];
    const rows = fromWhoop
      ? [{ n: 'WHOOP, all day', m: 'measured', mc: BURN_COL, v: `${kcal(whoopTotal)} kcal` }]
      : acts.slice(0, 6).map(a => ({ n: a.label || 'Activity', m: '', mc: 'var(--text-muted)', v: `${kcal(a.kcal || 0)} kcal` }));
    if (!rows.length) rows.push({ n: 'No activity logged today', m: '', mc: 'var(--text-muted)', v: '' });
    return {
      d: {
        head: 'BURNED TODAY', headR: kcal(burned), headRs: ' kcal', rows,
        big: kcal(burned), bigSub: 'kcal burned',
        line: fromWhoop ? 'Measured by WHOOP, all day' : bmr ? `Plus ~${kcal(bmr)} resting (not counted)` : 'Activity only',
      },
      s: { fl: 'BURNED', fvA: kcal(burned), fv: ' kcal' },
    };
  },

  weight(S) {
    const log = S.vitalsLog || {};
    const days = 30;
    const pts = [];
    for (let i = days - 1; i >= 0; i--) {
      const v = log[ymd(Date.now() - i * 86400000)]?.weight;
      if (v != null && Number.isFinite(Number(v))) pts.push(Number(v));
    }
    if (pts.length < 2) {
      const last = pts[0];
      return { d: { ll: 'WEIGHT · 30 DAYS', lv: last != null ? `${last.toFixed(1)} kg` : '—', rl: 'CHANGE', rv: '—', mx: -1,
                    ax0: '30d ago', ax1: '', ax2: 'today', v1: last != null ? `${last.toFixed(1)} kg` : '—',
                    v2: 'log weight a few times to see a trend', ...GREEN, ...series([0, 0]) },
               s: { fl: 'WEIGHT', fv: last != null ? `${last.toFixed(1)} kg` : 'none logged' } };
    }
    const first = pts[0], last = pts[pts.length - 1];
    const ch = last - first;
    const chTxt = `${ch > 0 ? '+' : ch < 0 ? '−' : ''}${Math.abs(ch).toFixed(1)} kg`;
    return {
      d: { ll: 'WEIGHT · 30 DAYS', lv: `${last.toFixed(1)} kg`, rl: 'CHANGE', rv: chTxt,
           mx: -1, ax0: '30d ago', ax1: `${pts.length} readings`, ax2: 'today',
           v1: `${last.toFixed(1)} kg`, v2: `${chTxt} in 30 days`, ...GREEN, lvc: 'var(--text)', ...series(pts) },
      s: { fl: 'WEIGHT', fvA: `${last.toFixed(1)} kg`, fv: ` · ${chTxt}` },
    };
  },

  vitals(S) {
    const log = S.vitalsLog || {};
    const keys = Object.keys(log).sort();
    const latest = key => {
      for (let i = keys.length - 1; i >= 0; i--) {
        const v = log[keys[i]] && log[keys[i]][key];
        if (v != null && Number.isFinite(Number(v))) return { v: Number(v), day: keys[i] };
      }
      return null;
    };
    const avg7 = key => {
      const vals = [];
      for (let i = 0; i < 7; i++) {
        const v = log[ymd(Date.now() - i * 86400000)]?.[key];
        if (v != null && Number.isFinite(Number(v))) vals.push(Number(v));
      }
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const shown = VITAL_METRICS
      .filter(m => ['weight', 'sleep', 'rhr', 'recovery', 'hrv', 'strain'].includes(m.key))
      .map(m => ({ m, last: latest(m.key) }))
      .filter(x => x.last)
      .slice(0, 5);
    if (!shown.length) {
      return { d: { head: 'VITALS', headR: '', headRs: '', rows: [{ n: 'Nothing logged yet', m: '', mc: 'var(--text-muted)', v: 'Track → Vitals' }],
                    tiles: [{ t: 'VITALS', v: '—' }] },
               s: { fl: 'VITALS', fv: 'none logged' } };
    }
    const unit = m => (m.unit ? (m.unit === '%' ? '%' : ` ${m.unit}`) : '');
    const today = ymd(Date.now());
    const rows = shown.map(({ m, last }) => {
      const a = avg7(m.key);
      return {
        n: m.label,
        m: a != null ? `7d ${fmtMetric(a, m)}` : '',
        mc: 'var(--text-muted)',
        v: `${fmtMetric(last.v, m)}${unit(m)}${last.day === today ? '' : ' ·'}`,
      };
    });
    return {
      d: { head: 'VITALS', headR: '', headRs: 'latest · 7-day avg', rows,
           tiles: shown.slice(0, 3).map(({ m, last }) => ({ t: m.label.toUpperCase(), v: `${fmtMetric(last.v, m)}${unit(m)}` })) },
      s: { fl: 'VITALS', fv: shown.slice(0, 2).map(({ m, last }) => `${fmtMetric(last.v, m)}${unit(m)}`).join(' · ') },
    };
  },

  week(S) {
    const hist = S.macroHistory || {};
    const days = 14;
    const vals = [];
    const pro = [];
    for (let i = days - 1; i >= 0; i--) {
      const h = hist[ymd(Date.now() - i * 86400000)];
      vals.push(h && h.cal != null ? Number(h.cal) : null);
      pro.push(h && h.pro != null ? Number(h.pro) : null);
    }
    const logged = vals.filter(v => v != null);
    if (logged.length < 2) {
      return { d: { ll: 'CALORIES · 14 DAYS', lv: '—', rl: 'PROTEIN AVG', rv: '—', mx: -1,
                    ax0: '14d ago', ax1: '', ax2: 'today', v1: '—', v2: 'log a few days to see a trend',
                    ...ORANGE, ...series([0, 0]) },
               s: { fl: '14 DAYS', fv: 'not enough logged' } };
    }
    const avg = Math.round(logged.reduce((a, b) => a + b, 0) / logged.length);
    const pl = pro.filter(v => v != null);
    const pAvg = pl.length ? Math.round(pl.reduce((a, b) => a + b, 0) / pl.length) : null;
    const onTarget = logged.filter(v => v >= 85 && v <= 110).length;
    // Unlogged days are drawn at the average rather than as zero: a day
    // you did not log is not a day you ate nothing.
    const filled = vals.map(v => (v == null ? avg : v));
    return {
      d: { ll: 'CALORIES · 14 DAYS', lv: `${avg}%`, rl: 'PROTEIN AVG', rv: pAvg != null ? `${pAvg}%` : '—',
           mx: -1, ax0: '14d ago', ax1: `${onTarget} of ${logged.length} on target`, ax2: 'today',
           v1: `${avg}% avg`, v2: `${onTarget}/${logged.length} days on target`,
           ...ORANGE, ...series(filled) },
      s: { fl: '14 DAYS', fvA: `${avg}%`, fv: ' of goal, avg' },
    };
  },
};

const ADAPTERS = {
  savings: savingsBlocks,
  trackers: trackerBlocks,
  achievements: achievementBlocks,
  holidays: holidayBlocks,
  habits: habitBlocks,
  nutrition: nutritionBlocks,
};

/**
 * Build one block's payload.
 *
 * Wrapped so a single bad record — a holiday with a malformed date, a
 * habit with no milestones — degrades that ONE block to a dash instead
 * of blanking the whole card and taking the hub with it.
 */
export function blockData(prime, id, S, opts, ext) {
  const fn = ADAPTERS[prime]?.[id];
  if (!fn) return { d: {}, s: { fl: id.slice(0, 7).toUpperCase(), fv: '—' } };
  try {
    return fn(S || {}, opts || {}, ext || null);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn(`[prime] ${prime}.${id} failed`, e);
    return { d: {}, s: { fl: id.slice(0, 7).toUpperCase(), fv: '—' } };
  }
}

export { ADAPTERS };
