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
 *
 * Tabs mirror AchievementsSection's goals/savings pair, down to the
 * class names, so the two owner-facing multi-tab pages behave
 * identically rather than each inventing a convention.
 *
 * Gating: entry points only render for the owner and this re-checks
 * isOwner, so a deep link shows nothing for anyone else. Owner identity
 * is a UI gate (VITE_OWNER_EMAIL) — everything here is personal
 * planning data in the user's own state, so there is nothing to
 * server-side authorise, but do not put secrets in it.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useIsMobile } from '../../hooks/useIsMobile';
import SectionHelp from '../SectionHelp';
import RotationTab from './RotationTab';
import DietTab from './DietTab';
import CareerTab from './CareerTab';
import './Upgrade.css';

const TABS = [
  { id: 'rotation', label: 'Rotation' },
  { id: 'diet', label: 'Diet' },
  { id: 'career', label: 'Career' },
];

export default function UpgradeSection({ S, update, active, isOwner, userId }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState('rotation');

  if (!isOwner) {
    return (
      <section id="upgrade" className={`section${active ? ' active' : ''}`}>
        <div className="settings-empty">This page isn&apos;t available.</div>
      </section>
    );
  }

  return (
    <section id="upgrade" className={`section${active ? ' active' : ''}`}>
      <motion.div
        style={{ marginBottom: isMobile ? '10px' : '16px' }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="eyebrow">Owner</div>
        <div className="sec-title">
          Upgrade
          <SectionHelp text="Rotation: the 16-day shift cycle with training mapped onto it — tap any day to swap the session or book it as leave. Diet: the macro targets and the build they're aimed at. Career: certifications, CV, and deliberate practice for LeetCode and KQL." />
        </div>
      </motion.div>

      <div className="ach-tabs-row upg-tabs-row">
        <div className="ach-tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`ach-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'rotation' && <RotationTab S={S} update={update} isMobile={isMobile} />}
      {tab === 'diet' && <DietTab S={S} update={update} isMobile={isMobile} />}
      {tab === 'career' && <CareerTab S={S} update={update} userId={userId} isMobile={isMobile} />}
    </section>
  );
}
