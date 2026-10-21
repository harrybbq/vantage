/**
 * The console hub (desktop and phone) — mounted by App.jsx through the
 * ConsoleHub slot (hub/index.js) with the SectionProps bag.
 *
 *   1. Levelling first: the player strip (desktop) / compact card (phone).
 *   2. The widget grid: fixed size families, one shared order in S.hubGrid.
 *   3. The "Add widget" bar naming the three sizes.
 *
 * Desktop: opening a friend takes the widget area (FriendTakeover), as the
 * classic FriendPanel does; Esc or a press outside returns to the grid.
 *
 * Data safety: the only layout write is S.hubGrid (useHubGrid.commit).
 * Widget bodies write the same keys they write in classic (logs, habits,
 * vitalsLog …), always through functional `update`.
 */
import { useCallback, useMemo, useState } from 'react';
import Icon from '../../../components/Icon';
import { Sheet } from '../ui';
import RatingsPanel from '../../../components/RatingsPanel';
import { PrimeEditorSheet } from '../../../components/widgets/prime/PrimeEditor';
import QuickFoodMenu from '../../../components/widgets/prime/QuickFoodMenu';
import { PRIMES, primeOf, withBlocks, withBlockOpts } from '../../../lib/hub/primeBlocks';
import { applyRelapse } from '../../../lib/habits/relapse';
import { toggleTrackerToday } from '../../../lib/trackers/tickEffects';
import { isRetiredWidget } from '../../../lib/widgets/retired';
import { useHubGrid, makeId } from './useHubGrid';
import { useFriendsHub } from './useFriendsHub';
import { sizesFor, setItemSize, removeItem, addItem, patchItem, moveVisible } from './grid';
import { metaOf, allowType } from './catalogue';
import HubGrid from './HubGrid';
import WidgetBody from './WidgetBody';
import AddWidgetSheet from './AddWidgetSheet';
import { PlayerStrip, PlayerCard } from './PlayerStrip';
import { FriendTakeover, FriendsOverlays, friendsMeta } from './FriendsWidget';
import { leagueMeta } from './LeagueWidget';
import { todayMeta } from './TodayWidget';

/** Where a widget's title goes. */
const TITLE_ROUTE = {
  today: 'track', league: 'leaderboard', friends: 'friends', upnext: 'track', coins: 'shop',
  vitals: 'track', body: 'track', macros: 'diet', calories: 'diet', habits: 'habits', holidays: 'holiday',
  'recent-wins': 'achievements', 'coin-history': 'achievements', goals: 'achievements', 'body-goal': 'track',
};

export default function ConsoleHub(props) {
  const {
    S, update, userId, isMobile, isOwner, hasPro, visionState, navigate,
    onOpenPaywall, onShowCoinToast, onOpenVisions,
  } = props;
  const { grid, commit, presetIds } = useHubGrid(S, update, { isOwner });
  const hub = useFriendsHub({ userId, hasPro });
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [primeEdit, setPrimeEdit] = useState(null);   // item id
  const [foodMenu, setFoodMenu] = useState(null);     // { rect } | null

  const visible = useCallback(it => !!sizesFor(it.type, { presetIds }) && allowType(it.type, { isOwner }) && !isRetiredWidget(it.type), [presetIds, isOwner]);
  const items = useMemo(() => grid.items.filter(visible), [grid.items, visible]);

  const metaFor = useCallback(item => {
    const m = metaOf(item);
    let meta = null;
    if (item.type === 'today') meta = todayMeta(S);
    else if (item.type === 'league') meta = leagueMeta(hub);
    else if (item.type === 'friends') meta = friendsMeta(hub);
    else if (item.type === 'upnext') meta = 'Calendar';
    else if (item.type === 'coins') meta = 'Shop';
    return { ...m, meta };
  }, [S, hub]);

  const onPrimeAct = useCallback(act => {
    if (act?.kind === 'relapse') update(prev => applyRelapse(prev, act.id, Date.now()));
    if (act?.kind === 'tick') toggleTrackerToday(update, act.trackerId, onShowCoinToast);
    if (act?.kind === 'logfood') setFoodMenu(cur => (cur ? null : { rect: act.rect || null }));
  }, [update, onShowCoinToast]);

  const renderBody = (item, size) => (
    <WidgetBody
      item={item}
      ctx={{
        S, update, navigate, userId, hasPro, isMobile, size,
        patch: fn => commit(g => patchItem(g, item.id, fn)),
        onOpenPaywall, onShowCoinToast, onPrimeAct, friendsHub: hub,
      }}
    />
  );

  const editing = primeEdit && items.find(i => i.id === primeEdit);
  const patchEditing = fn => commit(g => patchItem(g, primeEdit, fn));
  const openRatings = () => setRatingsOpen(true);
  const takeover = !isMobile && hub.selected;

  return (
    <section className={`section active cx-page cx-hub-page${isMobile ? ' is-phone' : ' is-desk'}`} aria-label="Hub">
      <div className="cx-hub">
        {isMobile
          ? <PlayerCard S={S} visionState={visionState} hub={hub} navigate={navigate} onOpenVisions={onOpenVisions} onOpenRatings={openRatings} />
          : <PlayerStrip S={S} visionState={visionState} hub={hub} navigate={navigate} onOpenVisions={onOpenVisions} onOpenRatings={openRatings} />}

        {takeover ? (
          <FriendTakeover hub={hub} />
        ) : (
          <>
            {items.length ? (
              <HubGrid
                items={items}
                cols={isMobile ? 2 : 4}
                isMobile={isMobile}
                hasPro={hasPro}
                presetIds={presetIds}
                metaFor={metaFor}
                renderBody={renderBody}
                onTitle={item => {
                  const pk = primeOf(item);
                  const to = pk ? PRIMES[pk].section : TITLE_ROUTE[item.type];
                  if (to) navigate?.(to);
                }}
                onMove={(from, to) => commit(g => moveVisible(g, visible, from, to))}
                onSize={(id, size) => commit(g => setItemSize(g, id, size, { hasPro, presetIds }))}
                onRemove={id => commit(g => removeItem(g, id))}
                onEditBlocks={item => (primeOf(item) ? () => setPrimeEdit(item.id) : null)}
                onOpenPaywall={onOpenPaywall}
              />
            ) : (
              <div className="cx-panel cx-hub-first">
                <Icon name="layout-grid" size={22} strokeWidth={1.75} />
                <p className="cx-hub-first-t">Your hub is empty</p>
                <p className="cx-muted">Add the things you want to see first thing. Everything fills from data you already log.</p>
              </div>
            )}
            <button type="button" className="cx-hub-addbar" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={16} strokeWidth={1.75} />
              <span>Add widget</span>
              <span className="cx-hub-addbar-sizes" aria-hidden="true">
                <span className="cx-muted">·</span><span>Small 1×1</span><span>Medium 2×1</span><span>Large 2×2</span>
              </span>
            </button>
          </>
        )}
      </div>

      {ratingsOpen && (
        <Sheet title="Ratings" onClose={() => setRatingsOpen(false)} className="cx-hub-ratings" testId="cx-hub-ratings-sheet" width={520}>
          <RatingsPanel S={S} update={update} />
        </Sheet>
      )}
      {addOpen && (
        <AddWidgetSheet
          S={S}
          items={items}
          hasPro={hasPro}
          isOwner={isOwner}
          presetIds={presetIds}
          navigate={navigate}
          onOpenPaywall={onOpenPaywall}
          onClose={() => setAddOpen(false)}
          onAdd={spec => commit(g => addItem(g, spec, { makeId, presetIds }))}
        />
      )}
      {editing && (
        <PrimeEditorSheet
          widget={editing}
          pots={(S.savings || []).map(g => ({ id: g.id, name: g.name }))}
          onSet={ids => patchEditing(w => withBlocks(w, ids))}
          onOpts={(blockId, patch) => patchEditing(w => withBlockOpts(w, blockId, patch))}
          onTitle={t => patchEditing(w => ({ ...w, title: t }))}
          onClose={() => setPrimeEdit(null)}
        />
      )}
      {foodMenu && (
        <QuickFoodMenu
          anchorRect={foodMenu.rect}
          userId={userId}
          update={update}
          onClose={() => setFoodMenu(null)}
          onSearch={() => {
            setFoodMenu(null);
            try { sessionStorage.setItem('vb_quicklog_food', '1'); } catch { /* ignore */ }
            navigate?.('diet');
          }}
        />
      )}
      <FriendsOverlays hub={hub} isMobile={isMobile} onUpgrade={() => onOpenPaywall?.('friends')} />
    </section>
  );
}
