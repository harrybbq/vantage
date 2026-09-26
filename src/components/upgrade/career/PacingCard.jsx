/**
 * Study pacing — the paced cert's remaining hours laid over the rotation
 * (lib/career/pacing), with the exam-ready date that falls out of it.
 *
 * Settings are stored on the cert itself in owner content:
 *   hoursLogged, pacing { perShift, days, nights }, examDate (when booked)
 * Study sits on shifts (day and night, each switchable); days off stay free.
 * so the plan survives a reload and the Brief reads the same numbers.
 * Slider moves save after a short pause rather than on every step.
 */
import { useEffect, useRef, useState } from 'react';
import { KEYS } from '../../../lib/career/schema';
import { usePacing } from './careerData';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = iso => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[(dt.getUTCDay() + 6) % 7]} ${d} ${MON[m - 1]}`;
};
const SHIFT = { day: 'D', night: 'N', off: '', leave: 'L', unknown: '' };

export default function PacingCard({ oc, S, certs }) {
  const [pick, setPick] = useState(null);
  const p = usePacing(S, certs, pick);
  const [draft, setDraft] = useState(null);           // live slider values before the save lands
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!p.cert) {
    return (
      <section className="cp-card cp-pace is-empty">
        <span className="cp-eyebrow">// study pacing</span>
        <p className="cp-muted">Set a cert to <b>Studying</b> or <b>Booked</b> with study hours and a target, and its sessions are laid over your rotation here.</p>
      </section>
    );
  }
  const { cert, plan, examIso, settings } = p;
  const s = { ...settings, ...(draft || {}) };

  function patchCert(patch, { debounce = false } = {}) {
    const run = () => {
      const next = certs.map(c => (c.id === cert.id ? { ...c, ...patch } : c));
      oc.save(KEYS.certs, next).then(() => setDraft(null));
    };
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(run, 500); else run();
  }
  const setPace = (k, v) => {
    setDraft(d => ({ ...(d || {}), [k]: v }));
    const pacing = { perShift: settings.perShift, days: settings.days, nights: settings.nights, [k]: v };
    patchCert({ pacing }, { debounce: k === 'perShift' });
  };
  const logHours = h => patchCert({ hoursLogged: Math.max(0, Math.round((settings.hoursLogged + h) * 10) / 10) });

  const total = Number(cert.studyHours) || 0;
  const pct = total ? Math.min(100, Math.round((settings.hoursLogged / total) * 100)) : 0;
  const cal = plan.cal.slice(0, 56);
  const headline = {
    ok: `Exam-ready ${pretty(plan.readyIso)}, ${plan.spare} days to spare`,
    tight: `Exam-ready ${pretty(plan.readyIso)} — only ${plan.spare} day${plan.spare === 1 ? '' : 's'} before the exam`,
    late: `At this pace you won't be ready for ${pretty(examIso)}`,
    done: 'All the planned hours are logged',
    'no-exam': plan.readyIso ? `Exam-ready ${pretty(plan.readyIso)}` : 'No exam date yet',
  }[plan.status];
  const flag = plan.status === 'late' ? '⚠ move the exam or add hours' : plan.status === 'tight' ? '⚠ no slack' : plan.status === 'done' ? '✓ ready' : `✓ ${plan.sessions} sessions left`;

  return (
    <section className="cp-pace">
      <div className="cp-sechead">
        <div>
          <span className="cp-eyebrow">// certs · study on shift, days off stay free</span>
          <h3 className="cp-title">{headline}</h3>
        </div>
        <span className={`cp-flag is-${plan.status}`}>{flag}</span>
      </div>
      <div className="cp-pace-grid">
        <div className="cp-card cp-pace-side">
          <div className="cp-pace-top">
            <span className="cp-eyebrow">// {cert.name}</span>
            {p.eligible.length > 1 && (
              <select className="cp-pace-pick" value={cert.id} onChange={e => setPick(e.target.value)} aria-label="Cert to pace">
                {p.eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div className="cp-pace-ring-row">
            <div className="cp-ring" style={{ '--p': `${pct}%` }} role="img" aria-label={`${settings.hoursLogged} of ${total} hours logged`}>
              <div><b>{settings.hoursLogged}</b><span>/ {total} h</span></div>
            </div>
            <dl className="cp-pace-dl">
              <dt>Exam-ready</dt><dd className={`is-${plan.status}`}>{plan.readyIso ? pretty(plan.readyIso) : plan.status === 'done' ? 'now' : 'not by the exam'}</dd>
              <dt>{cert.examDate ? 'Booked' : 'Exam by'}</dt><dd>{pretty(examIso)}</dd>
            </dl>
          </div>
          <div className="cp-log">
            <span>Log study</span>
            {[0.5, 1, 2].map(h => <button key={h} type="button" onClick={() => logHours(h)}>+{h} h</button>)}
            <button type="button" className="is-undo" onClick={() => logHours(-0.5)} aria-label="Remove half an hour">−</button>
          </div>
          <label className="cp-slider">
            <span>Hours per shift<b>{s.perShift} h</b></span>
            <input type="range" min="0.5" max="4" step="0.5" value={s.perShift}
                   onChange={e => setPace('perShift', Number(e.target.value))} />
          </label>
          <button type="button" role="switch" aria-checked={s.days} className="cp-switch"
                  onClick={() => setPace('days', !s.days)}>
            Study on day shifts <i className={s.days ? 'is-on' : ''} />
          </button>
          <button type="button" role="switch" aria-checked={s.nights} className="cp-switch"
                  onClick={() => setPace('nights', !s.nights)}>
            Study on night shifts <i className={s.nights ? 'is-on' : ''} />
          </button>
          <label className="cp-slider is-date">
            <span>Exam booked for</span>
            <input type="date" value={cert.examDate || ''} onChange={e => patchCert({ examDate: e.target.value || undefined, status: e.target.value ? 'booked' : cert.status })} />
          </label>
        </div>

        <div className="cp-card cp-pace-cal">
          <div className="cp-pace-calhead">
            <span className="cp-eyebrow">// next eight weeks</span>
            <span className="cp-key-sq is-study">study</span>
            <span className="cp-key-sq is-off">off</span>
            <span className="cp-key-sq is-ready">ready</span>
            <span className="cp-key-sq is-exam">exam</span>
          </div>
          <div className="cp-cal7">
            {DOW.map(d => <span key={d} className="cp-cal7-dow">{d}</span>)}
            {cal.map(d => {
              const [, m, dd] = d.iso.split('-').map(Number);
              const cls = ['cp-cal7-day', `is-${d.shift}`, d.hours ? 'has-study' : '', d.exam ? 'is-exam' : '',
                d.iso === plan.readyIso ? 'is-ready' : '', d.past ? 'is-past' : '', d.iso === p.today ? 'is-today' : '',
                d.holiday && !d.past ? 'is-holiday' : ''].filter(Boolean).join(' ');
              return (
                <div key={d.iso} className={cls}
                     title={`${pretty(d.iso)} · ${d.shift === 'off' ? 'off' : d.shift === 'day' ? 'day shift' : d.shift === 'night' ? 'night shift' : d.shift}${d.hours ? ` · study ${d.hours} h` : ''}${d.holiday && !d.past ? ' · holiday' : ''}`}>
                  <span className="cp-cal7-top"><span>{dd === 1 ? `${MON[m - 1]} 1` : dd}</span><span>{SHIFT[d.shift]}</span></span>
                  <span className="cp-cal7-h">{d.exam ? 'EXAM' : d.hours ? `${d.hours}h` : d.holiday && !d.past ? 'away' : ''}</span>
                </div>
              );
            })}
          </div>
          {plan.cal.length > 56 && <div className="upg-fine">The plan runs on past these eight weeks to the exam on {pretty(examIso)}.</div>}
        </div>
      </div>
    </section>
  );
}
