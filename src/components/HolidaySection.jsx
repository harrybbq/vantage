/**
 * Holiday planner.
 *
 * ── What changed, and why ────────────────────────────────────────────
 * This was a grid of trip cards, newest first. A card grid answers "what
 * trips do I have" and nothing else — it cannot show how long until the
 * next one, or that there is a nine-month gap after it, which are the
 * questions you actually open a holiday planner with.
 *
 * So: a timeline you pick from, and one trip shown properly. Stops are
 * spaced by real elapsed days, so a fortnight and three years look
 * different. The selected trip renders as a boarding pass, which puts
 * the countdown at the size it earns instead of as one labelled row
 * among six equal ones.
 *
 * Nothing was dropped to fit the layout. Flight, stay, budget, savings,
 * itinerary, notes, the travel-policy flag, status cycling, the edit
 * modal and the destination brief are all still here — see BoardingPass.
 *
 * Trips also appear on the Track calendar now, for every day they cover.
 * That is derived from this same list rather than copied into the
 * calendar's store; lib/calendar/holidayEvents.js has the reasoning.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon';
import SectionHelp from './SectionHelp';
import VisitedTab from './holiday/VisitedTab';
import DestinationPanel from './holiday/DestinationPanel';
import TripRail from './holiday/TripRail';
import BoardingPass from './holiday/BoardingPass';
import { useHubModuleMenu } from './HubModuleMenu';
import { getPolicy } from '../lib/holiday/policy';
import { defaultTrip, orderedTrips, STATUS_ORDER } from '../lib/holiday/timeline';

export default function HolidaySection({ S, update, active, onOpenModal }) {
  const [tab, setTab] = useState('trips');
  const [selectedId, setSelectedId] = useState(null);
  const policy = useMemo(() => getPolicy(S), [S]);
  const trips = useMemo(() => orderedTrips(S.holidays), [S.holidays]);

  // Same right-click transparency as the hub, Track and Shopping.
  const moduleMenu = useHubModuleMenu({ S, update });

  // The chosen trip, or the next one that has not left. Falling back
  // rather than clearing matters: deleting the selected trip should show
  // you the next one, not an empty page.
  const selected = useMemo(
    () => trips.find(t => t.id === selectedId) || defaultTrip(trips, new Date()),
    [trips, selectedId],
  );

  // Keep the pointer honest when the selected trip disappears.
  useEffect(() => {
    if (selectedId && !trips.some(t => t.id === selectedId)) setSelectedId(null);
  }, [trips, selectedId]);

  function cycleStatus(id, current) {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
    update(prev => ({
      ...prev,
      holidays: (prev.holidays || []).map(h => (h.id === id ? { ...h, status: next } : h)),
    }));
  }

  return (
    <section id="holiday" className={`section${active ? ' active' : ''}`}>
      <div className="holiday-layout" ref={moduleMenu.rootRef} onContextMenu={moduleMenu.onContextMenu}>
        <div className="holiday-toolbar">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div className="eyebrow">Adventures</div>
            <div className="sec-title">Holiday Planner <SectionHelp
              title="Holiday planner"
              rows={[
                { term: 'Timeline', def: 'Spaced by real dates — the gap between two trips is the wait.' },
                { term: 'Trips', def: 'Dates, flights, budget and a countdown. Link one to a savings goal.' },
                { term: 'Calendar', def: 'Every day of a trip shows on the Track calendar automatically.' },
                { term: 'Visited', def: 'Fills itself in as trips finish.' },
              ]}
            /></div>
          </motion.div>
          {tab === 'trips' && (
            <motion.button className="btn btn-primary" onClick={() => onOpenModal('addHolidayModal')}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>+ Plan Trip</motion.button>
          )}
        </div>

        <div className="holiday-tabs" role="tablist">
          {[['trips', 'Trips'], ['visited', 'Visited']].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`holiday-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >{label}</button>
          ))}
        </div>

        {tab === 'trips' && (
          trips.length === 0 ? (
            <div className="holiday-empty">
              <div className="holiday-empty-icon"><Icon name="plane" size={30} strokeWidth={1.5} /></div>
              No trips planned yet.<br />Hit <strong>+ Plan Trip</strong> to add your first holiday!
            </div>
          ) : (
            <div className="hol-planner">
              <TripRail trips={trips} selectedId={selected?.id} onSelect={setSelectedId} />
              <BoardingPass
                trip={selected}
                S={S}
                policy={policy}
                onCycleStatus={cycleStatus}
                onEdit={id => onOpenModal('editHolidayModal:' + id)}
                onItinerary={id => onOpenModal('editHolidayModal:' + id + ':itinerary')}
              />
              {/* The destination brief — weather, currency, time — for
                  the trip you are looking at. It used to sit on every
                  card at once, which meant N requests for N cards. */}
              {selected && selected.status !== 'completed' && (
                <DestinationPanel dest={selected.dest} from={selected.from} />
              )}
            </div>
          )
        )}

        {tab === 'visited' && <VisitedTab S={S} update={update} />}
      </div>
      {/* Outside .holiday-layout: the panels carry backdrop-filter, which
          makes them the containing block for position:fixed children. */}
      {moduleMenu.menuNode}
    </section>
  );
}
