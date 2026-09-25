/**
 * How a block draws itself at each level of detail.
 *
 * ── The one rule ─────────────────────────────────────────────────────
 * A view renders whatever level it is handed and fills its slot. It NEVER
 * measures itself to decide which level to be — the packer decided that
 * already, from the whole card's geometry, and a view that second-guessed
 * it would fight the layout it sits in.
 *
 * ── Why these are shared ─────────────────────────────────────────────
 * Eighteen views, and every block in every prime is one of them at each
 * level. A new block is a data adapter plus a choice of two view ids; it
 * is not new markup. That is what keeps eight sections' worth of widget
 * from becoming eight sections' worth of CSS.
 *
 * Every view is pure presentation: it takes `d` (the data the adapter
 * built) and nothing else. No state reads, no handlers — so they render
 * identically on the desktop canvas and in a mobile card.
 */
import { memo, useEffect, useState } from 'react';
import { useSegTip } from '../../savings/SegTip';

/**
 * The one control a view may carry: an action on a row, asked twice.
 *
 * Views stay presentation — this only appears when the adapter put an
 * `act` on the row AND the host passed `onAct`, so a card rendered
 * somewhere that cannot write state shows no button at all.
 *
 * First tap arms ("Sure?"), second commits, four seconds disarms: a
 * relapse restarts a timer somebody may have watched for months, and
 * the standalone habit widget has always asked the same way.
 */
function ActButton({ act, onAct }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`pv-act${armed ? ' is-arming' : ''}`}
      onPointerDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        onAct(act);
      }}
      title="Log a relapse, now"
      aria-label={armed ? `Confirm relapse for ${act.name}` : `Log a relapse for ${act.name}`}
    >{armed ? 'Sure?' : '↻'}</button>
  );
}

/* ── hero: one big figure, the thing the card is about ─────────────── */
function HeroL({ d }) {
  return (
    <div className="pv pv-hero">
      <div className="pv-eyebrow">{d.label}</div>
      <div className="pv-hero-big">{d.big}</div>
      <div className="pv-hero-sub">
        {d.subA ? <b>{d.subA}</b> : null}{d.sub}
      </div>
    </div>
  );
}
function HeroM({ d }) {
  return (
    <div className="pv pv-heroM">
      <div className="pv-heroM-big">{d.big}</div>
      <div className="pv-heroM-side">
        <span>{d.r1A ? <b>{d.r1A}</b> : null}{d.r1}</span>
        <span className="pv-dim">{d.r2}</span>
      </div>
    </div>
  );
}

/* ── vessels: pots as filling containers. The one view people recognise
      the app by, so it survives at full detail longer than most. ───── */
function VesselsL({ d }) {
  return (
    <div className="pv pv-vessels">
      {d.items.map((p, i) => (
        <div className="pv-vessel" key={p.n + i}>
          <div className="pv-vessel-fill" style={{ height: `${p.pct}%`, background: p.fill }} />
          <div className="pv-vessel-body">
            <span className="pv-vessel-name">{p.n}</span>
            <span className="pv-vessel-foot">
              <span className="pv-vessel-pct">{p.pctTxt}</span>
              <span className="pv-vessel-cur">{p.cur}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── bars: the same items, flattened ───────────────────────────────── */
function BarsM({ d, onAct }) {
  return (
    <div className="pv pv-barsM">
      {d.items.map((p, i) => (
        <div className="pv-barM" key={p.n + i}>
          <span className="pv-barM-name">{p.n}</span>
          <span className="pv-track"><span className="pv-fill" style={{ width: `${p.pct}%`, background: p.col }} /></span>
          <span className="pv-barM-pct">{p.pctTxt}</span>
          {p.act && onAct ? <ActButton act={p.act} onAct={onAct} /> : null}
        </div>
      ))}
    </div>
  );
}
function BarsL({ d, onAct }) {
  return (
    <div className="pv pv-barsL">
      {d.items.map((p, i) => (
        <div className="pv-barL" key={p.n + i}>
          <div className="pv-barL-top">
            <span className="pv-barL-name">{p.n}</span>
            <span className="pv-barL-right">{p.r}</span>
            {p.act && onAct ? <ActButton act={p.act} onAct={onAct} /> : null}
          </div>
          <span className="pv-track"><span className="pv-fill" style={{ width: `${p.pct}%`, background: p.col }} /></span>
        </div>
      ))}
    </div>
  );
}

/* ── chart: a projection or a history ──────────────────────────────── */
function ChartL({ d }) {
  return (
    <div className="pv pv-chart">
      <div className="pv-chart-head">
        <div>
          <div className="pv-eyebrow">{d.ll}</div>
          <div className="pv-chart-v" style={{ color: d.lvc }}>{d.lv}</div>
        </div>
        <div className="pv-chart-head-r">
          <div className="pv-eyebrow">{d.rl}</div>
          <div className="pv-chart-v">{d.rv}</div>
        </div>
      </div>
      <div className="pv-chart-plot">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <path d={d.area} fill={d.fillCol} />
          <path d={d.line} fill="none" stroke={d.col} strokeWidth="1.8"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {d.mx >= 0 && (
            <line x1={d.mx} x2={d.mx} y1="0" y2="40" stroke="var(--gold)" strokeWidth="1"
                  strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <div className="pv-chart-axis"><span>{d.ax0}</span><span>{d.ax1}</span><span>{d.ax2}</span></div>
      </div>
    </div>
  );
}
function SparkM({ d }) {
  return (
    <div className="pv pv-spark">
      <div className="pv-spark-l">
        <div className="pv-spark-v" style={{ color: d.lvc }}>{d.v1}</div>
        <div className="pv-spark-s">{d.v2}</div>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path d={d.area} fill={d.fillCol} />
        <path d={d.line} fill="none" stroke={d.col} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/* ── lists ─────────────────────────────────────────────────────────── */
function ListL({ d }) {
  return (
    <div className="pv pv-list">
      <div className="pv-list-head">
        <span className="pv-eyebrow">{d.head}</span>
        <span className="pv-list-headR">{d.headR}<span className="pv-dim">{d.headRs}</span></span>
      </div>
      {d.rows.map((r, i) => (
        <div className="pv-row" key={r.n + i}>
          <span className="pv-row-n">{r.n}</span>
          <span className="pv-row-m" style={{ color: r.mc }}>{r.m}</span>
          <span className="pv-row-v">{r.v}</span>
        </div>
      ))}
    </div>
  );
}
function ChecksL({ d }) {
  return (
    <div className="pv pv-list">
      <div className="pv-list-head">
        <span className="pv-eyebrow">{d.head}</span>
        <span className="pv-list-headR">{d.headR}</span>
      </div>
      {d.rows.map((r, i) => (
        <div className="pv-row pv-check" key={r.n + i}>
          <span className="pv-tick" style={{ background: r.bg, borderColor: r.bd }}>{r.ck}</span>
          <span className="pv-row-n" style={{ color: r.fg }}>{r.n}</span>
          <span className="pv-row-m">{r.v}</span>
        </div>
      ))}
    </div>
  );
}
function HeatL({ d }) {
  return (
    <div className="pv pv-list">
      <div className="pv-heat-head">
        <span className="pv-eyebrow pv-grow">{d.head}</span>
        {d.days.map((dy, i) => <span className="pv-heat-day" key={i}>{dy.t}</span>)}
      </div>
      {d.rows.map((r, i) => (
        <div className="pv-row pv-heat-row" key={r.n + i}>
          <span className="pv-row-n">{r.n}</span>
          {r.cells.map((q, k) => (
            <span className="pv-heat-cell" key={k}><i style={{ background: q.bg }} /></span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── compact summaries ─────────────────────────────────────────────── */
function DotsM({ d }) {
  return (
    <div className="pv pv-dots">
      <div className="pv-dots-row">
        {d.dots.map((o, i) => <i key={i} style={{ background: o.bg, borderColor: o.bd }} />)}
      </div>
      <div className="pv-dots-text">
        <div className="pv-dots-t">{d.txt}</div>
        <div className="pv-dots-s">{d.sub}</div>
      </div>
    </div>
  );
}
function TilesM({ d }) {
  return (
    <div className="pv pv-tiles">
      {d.tiles.map((a, i) => (
        <div className="pv-tile" key={a.t + i}>
          <span className="pv-tile-t">{a.t}</span>
          <span className="pv-tile-v">{a.v}</span>
        </div>
      ))}
    </div>
  );
}
function StatM({ d }) {
  return (
    <div className="pv pv-stat">
      <span className="pv-stat-big">{d.big} <span className="pv-stat-sub">{d.bigSub}</span></span>
      <span className="pv-stat-line">{d.line}</span>
    </div>
  );
}

/* ── segmented bar: where a total goes ─────────────────────────────── */
/* The bands answer "how much?" in a small popup — hover, tap or focus.
   See savings/SegTip for why it is portalled rather than in the slot. */
const segData = m => ({ label: m.n, value: m.v || `${m.pct}%`, sub: m.v ? m.sub : null, col: m.col });

function SegL({ d }) {
  const tip = useSegTip();
  return (
    <div className="pv pv-seg">
      <div className="pv-seg-head"><span>{d.head}</span><span>{d.headR}</span></div>
      <div className="pv-seg-bar">
        {d.segs.map((m, i) => (
          <span key={m.n + i} style={{ width: `${m.pct}%`, background: m.col }} {...tip.bind(segData(m))} />
        ))}
      </div>
      {tip.node}
      <div className="pv-seg-key">
        {d.segs.map((m, i) => (
          <span key={m.n + i}><i style={{ background: m.col }} />{m.n} {m.pct}%</span>
        ))}
      </div>
    </div>
  );
}
function SegM({ d }) {
  const tip = useSegTip();
  return (
    <div className="pv pv-segM">
      <div className="pv-segM-head"><span>{d.l}</span><span><b>{d.rA}</b>{d.r}</span></div>
      <div className="pv-seg-bar pv-seg-bar-sm">
        {d.segs.map((m, i) => (
          <span key={i} style={{ width: `${m.pct}%`, background: m.col }} {...tip.bind(segData(m))} />
        ))}
      </div>
      {tip.node}
    </div>
  );
}

/* ── a proposal card: the one block that asks for a decision ───────── */
function CardL({ d }) {
  return (
    <div className="pv pv-card">
      <div className="pv-card-top">
        <span className="pv-card-eyebrow">{d.eyebrow}</span>
        <span className="pv-card-right">{d.right}</span>
      </div>
      <div className="pv-card-title">{d.title}</div>
      <div className="pv-card-chips">
        {d.chips.map((k, i) => (
          <span key={k.t + i} className={`pv-card-chip${k.ghost ? ' is-ghost' : ''}`}>{k.t}</span>
        ))}
      </div>
    </div>
  );
}
function CardM({ d }) {
  return (
    <div className="pv pv-cardM">
      <span className="pv-cardM-t">{d.t}</span>
      <span className="pv-cardM-r">{d.r}</span>
    </div>
  );
}

/* ── fact: one line, fixed height, always available ────────────────────
   This is the level that makes the whole system honest. Because every
   block can become one of these, a block the user ticked is never
   dropped for want of room — it just gets quieter. ─────────────────── */
function Fact({ s }) {
  return (
    <div className="pv pv-fact">
      <span className="pv-fact-l">{s.fl}</span>
      <span className="pv-fact-v">{s.fvA ? <b>{s.fvA}</b> : null}{s.fv}</span>
    </div>
  );
}

const VIEWS = {
  heroL: HeroL, heroM: HeroM,
  vesselsL: VesselsL, barsM: BarsM, barsL: BarsL,
  chartL: ChartL, sparkM: SparkM,
  listL: ListL, checksL: ChecksL, heatL: HeatL,
  dotsM: DotsM, tilesM: TilesM, statM: StatM,
  segL: SegL, segM: SegM,
  cardL: CardL, cardM: CardM,
  fact: Fact,
};

/**
 * Render one block at one level.
 *
 * Memoised on the payload: a resize that does not change a block's level
 * re-positions its slot without re-rendering what is inside it, which is
 * what keeps a drag smooth with six blocks on screen.
 */
export const BlockView = memo(function BlockView({ view, d, s, onAct }) {
  const Cmp = VIEWS[view];
  if (!Cmp) return null;
  return <Cmp d={d} s={s} onAct={onAct} />;
});

export default VIEWS;
