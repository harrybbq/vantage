/**
 * Console Achievements: the classic goal board and savings, restyled
 * from outside (sweep.css token bridge), with the Honours button opening
 * the console trophy case instead of the classic list modal.
 *
 * The board is not rebuilt. It is a viewport-height canvas with its own
 * touch handling (pan, pinch, long-press) and every write the goals and
 * savings make; nothing is laid out above it.
 */
import { useState } from 'react';
import AchievementsSection from '../../../components/AchievementsSection';
import HonoursCase from './HonoursCase';

export default function ConsoleAchievements({ S, update, onOpenModal, onShowCoinToast }) {
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
      />
      {honours && <HonoursCase S={S} onClose={() => setHonours(false)} />}
    </div>
  );
}
