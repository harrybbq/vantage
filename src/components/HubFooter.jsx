import { useState, useEffect } from 'react';

export default function HubFooter({ visible, onOpenLegal }) {
  const [countdown, setCountdown] = useState({ days: '--', hours: '--', mins: '--', secs: '--', pct: 0, year: new Date().getFullYear() });

  useEffect(() => {
    function update() {
      const now = new Date();
      const year = now.getFullYear();
      const yearEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0);
      const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
      const totalMs = yearEnd - yearStart;
      const remainMs = yearEnd - now;
      const pct = Math.min(100, ((totalMs - remainMs) / totalMs * 100));
      const days = Math.floor(remainMs / (1000 * 60 * 60 * 24));
      const hrs = Math.floor((remainMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((remainMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((remainMs % (1000 * 60)) / 1000);
      const pad = n => String(n).padStart(2, '0');
      setCountdown({ days: pad(days), hours: pad(hrs), mins: pad(mins), secs: pad(secs), pct: pct.toFixed(2), year, pctStr: pct.toFixed(1) });
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`hub-footer${visible ? ' visible' : ''}`} id="hubFooter">
      <div>
        <div className="hub-footer-label">Time remaining in <span id="footerYear">{countdown.year}</span></div>
      </div>
      <div className="year-countdown">
        <div className="yc-block"><div className="yc-val">{countdown.days}</div><div className="yc-lbl">Days</div></div>
        <div className="yc-sep">:</div>
        <div className="yc-block"><div className="yc-val">{countdown.hours}</div><div className="yc-lbl">Hrs</div></div>
        <div className="yc-sep">:</div>
        <div className="yc-block"><div className="yc-val">{countdown.mins}</div><div className="yc-lbl">Min</div></div>
        <div className="yc-sep">:</div>
        <div className="yc-block"><div className="yc-val">{countdown.secs}</div><div className="yc-lbl">Sec</div></div>
      </div>
      <div className="year-progress-wrap">
        <div className="year-progress-bar">
          <div className="year-progress-fill" style={{ width: countdown.pct + '%' }}></div>
        </div>
        <div className="year-progress-pct">{countdown.pctStr}% of {countdown.year} gone</div>
      </div>

      {/* Legal footer links */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
        {[['privacy', 'Privacy Policy'], ['terms', 'Terms of Service']].map(([page, label]) => (
          <button
            key={page}
            onClick={() => onOpenLegal?.(page)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--mono, DM Mono, monospace)',
              fontSize: 'var(--fs-floor)', letterSpacing: '0.5px',
              color: 'rgba(255,255,255,.3)',
              textDecoration: 'underline', padding: 0,
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
