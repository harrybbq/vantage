/**
 * UpgradeSection — owner-only. Formerly "Rotation".
 *
 * The rotation calendar was a static HTML file in an iframe: it could
 * show the pattern and nothing else, because there was no state behind
 * it and no way to reach the app's from inside a frame. Renaming it to
 * Upgrade is not cosmetic — the page is now the place for the things
 * being deliberately worked on, of which the shift pattern is one:
 *
 *   Rotation — the pattern, now editable (sessions, leave)
 *   Diet     — the macro plan and the physique it is aimed at
 *   Career   — certifications, CV, and deliberate practice
 *   Security — the owner's console: DB, Netlify, moderation, tickets
 *              (formerly "Review"; the old id still opens it)
 *
 * It opens on a home menu (UpgradeHome): a large title and one card per
 * section with a live line, rather than a tab strip — Upgrade is a small
 * app of its own inside Vantage. A card opens its section full-width with
 * a slim "‹ Upgrade" header; the browser's or phone's back gesture also
 * returns to the menu (one history entry per opened section). Which
 * section is open is not stored anywhere: the menu always comes first —
 * except for a Security deep link (/?upgrade=security&ticket=<id>, what
 * a phone alert opens), which lands on that ticket.
 *
 * Gating: entry points only render for the owner and this re-checks
 * isOwner, so a deep link shows nothing for anyone else. Owner identity
 * is a UI gate (useIsOwner → is_app_owner()) — everything here is personal
 * planning data in the user's own state, so there is nothing to
 * server-side authorise, but do not put secrets in it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import Icon from '../Icon';
import RotationTab from './RotationTab';
import DietTab from './DietTab';
import CareerTab from './CareerTab';
import SecurityTab from './security/SecurityTab';
import UpgradeHome, { SECTIONS, resolveSection } from './UpgradeHome';
import { parseSecurityLink, stripSecurityParams } from '../../lib/security/deepLink';
import './Upgrade.css';

export default function UpgradeSection({ S, update, active, isOwner, userId }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState(null);           // null = the home menu
  const [origin, setOrigin] = useState('50% 30%');
  const pushed = useRef(false);
  const root = useRef(null);
  // A phone alert opens /?upgrade=security&ticket=<id>: straight to that
  // ticket. Read once; consumed (and dropped from the URL) as soon as the
  // owner check passes, so a reload doesn't re-open it.
  const [deep, setDeep] = useState(() => (typeof window !== 'undefined' ? parseSecurityLink(window.location.search) : null));
  const [secInit, setSecInit] = useState(null);
  useEffect(() => {
    if (!deep || !isOwner) return;
    setSecInit(deep);
    setTab('security');
    setDeep(null);
    try {
      const clean = stripSecurityParams(window.location.href);
      if (clean) window.history.replaceState(window.history.state, '', clean);
    } catch { /* sandboxed */ }
  }, [deep, isOwner]);

  // Back (browser or phone gesture) closes the open section.
  useEffect(() => {
    const onPop = () => { if (pushed.current) { pushed.current = false; setTab(null); } };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((id, rect) => {
    const box = root.current && root.current.getBoundingClientRect();
    if (rect && box) {
      const x = ((rect.left + rect.width / 2 - box.left) / Math.max(1, box.width)) * 100;
      const y = rect.top + rect.height / 2 - box.top;
      setOrigin(`${x.toFixed(1)}% ${Math.max(0, y).toFixed(0)}px`);
    }
    const next = resolveSection(id);
    setTab(next);
    try { window.history.pushState({ upgrade: next }, ''); pushed.current = true; } catch { /* sandboxed */ }
    window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => {
    if (pushed.current) window.history.back();   // popstate closes it
    else setTab(null);
  }, []);

  if (!isOwner) {
    return (
      <section id="upgrade" className={`section${active ? ' active' : ''}`}>
        <div className="settings-empty">This page isn&apos;t available.</div>
      </section>
    );
  }

  const cur = SECTIONS.find(x => x.id === resolveSection(tab)) || null;

  return (
    <section id="upgrade" ref={root} className={`section upg-app${active ? ' active' : ''}${cur ? ' is-open' : ''}`}>
      {!cur && <UpgradeHome S={S} userId={userId} onOpen={open} />}
      {cur && (
        <div className="uh-open" style={{ transformOrigin: origin }}>
          <div className="uh-open-head">
            <button type="button" className="uh-back" onClick={back} aria-label="Back to Upgrade">
              <Icon name="chevron-left" size={16} /> Upgrade
            </button>
            <span className="uh-open-sep" aria-hidden="true" />
            <span className={`uh-open-icon tone-${cur.tone}`}><Icon name={cur.icon} size={15} /></span>
            <h2 className="uh-open-name">{cur.name}</h2>
          </div>
          {tab === 'rotation' && <RotationTab S={S} update={update} isMobile={isMobile} />}
          {tab === 'diet' && <DietTab S={S} update={update} userId={userId} isMobile={isMobile} />}
          {tab === 'career' && <CareerTab S={S} update={update} userId={userId} isMobile={isMobile} />}
          {cur.id === 'security' && <SecurityTab initialTab={secInit && secInit.tab} initialFocus={secInit && secInit.focus} />}
        </div>
      )}
    </section>
  );
}
