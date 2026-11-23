/**
 * Console Achievements: the classic goal board and savings, restyled
 * from outside (sweep.css token bridge), with the Honours button opening
 * the console trophy case instead of the classic list modal.
 *
 * Two views of one route since the three sections (shell/nav.js): the
 * goal board is Track › Goals and savings is Track › Money. The view
 * arrives as `activeSub.achievements`, so the section's own Goals /
 * Savings switch is hidden here.
 *
 * On a phone the goals are the "Next up" list (GoalsPhone.jsx), which
 * the section mounts in place of its path player and feeds the same
 * handlers. The desktop board below is unchanged.
 *
 * The board is not rebuilt. It is a viewport-height canvas with its own
 * touch handling (pan, pinch, long-press) and every write the goals and
 * savings make; nothing is laid out above it.
 */
import { useState } from 'react';
import AchievementsSection from '../../../components/AchievementsSection';
import HonoursCase from './HonoursCase';
import GoalsPhone from './GoalsPhone';

export default function ConsoleAchievements({ S, update, onOpenModal, onShowCoinToast, activeSub = null }) {
  const [honours, setHonours] = useState(false);
  return (
    <div className="cx-sweep-scope cx-sweep-achievements">
      <AchievementsSection
        S={S}
        update={update}
        active
        onOpenModal={onOpenModal}
        onShowCoinToast={onShowCoinToast}
        onOpenVisions={() => setHonours(true)}
        tab={activeSub && activeSub.achievements === 'savings' ? 'savings' : 'goals'}
        hideTabs
        phoneGoals={GoalsPhone}
      />
      {honours && <HonoursCase S={S} onClose={() => setHonours(false)} />}
    </div>
  );
}
