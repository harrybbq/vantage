import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon';
import SectionHelp from './SectionHelp';
import VisitedTab from './holiday/VisitedTab';
import DestinationPanel from './holiday/DestinationPanel';
import { tripSavings } from '../lib/holiday/savings';
import { countryForTrip, COUNTRY_BY_ISO } from '../lib/holiday/destinations';
import { getPolicy, levelFor, POLICY_LEVELS } from '../lib/holiday/policy';

const STATUS_ORDER = ['planning', 'booked', 'completed'];
const STATUS_LABEL = { planning: 'Planning', booked: 'Booked', completed: 'Completed' };
const TONE_FOR_LEVEL = { restricted: 'red', notify: 'amber', cleared: 'green' };

// ── Countdown helper ──────────────────────────────────────────────────────
function getCountdown(h) {
  if (!h.from) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dep = new Date(h.from); dep.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dep - today) / 86400000);

  if (h.status === 'completed') {
    if (h.from && h.to) {
      const nights = Math.round((new Date(h.to) - new Date(h.from)) / 86400000);
      return { label: `${nights} nights`, style: 'muted' };
    }
    return null;
  }

  if (diffDays < 0) return null;
  if (diffDays === 0) return { label: 'Today! ✈', style: 'today' };
  if (diffDays <= 7) return { label: `${diffDays} days to go`, style: 'amber' };
  if (diffDays <= 60) return { label: `${diffDays} days to go`, style: 'gold' };
  const months = Math.round(diffDays / 30);
  return { label: `${months} month${months !== 1 ? 's' : ''} to go`, style: 'muted' };
}

/** Trip card. Every field the card has always shown is still shown
 *  exactly as before; the new rows only appear when their data exists. */
function TripCard({ h, index, S, onOpenModal, cycleStatus, policy }) {
  const dateRange = h.from && h.to
    ? `${new Date(h.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} → ${new Date(h.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : h.from ? `From ${new Date(h.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Dates TBC';
  const nights = h.from && h.to
    ? Math.round((new Date(h.to) - new Date(h.from)) / (1000 * 60 * 60 * 24)) + ' nights'
    : '';
  const countdown = getCountdown(h);
  const sav = tripSavings(S, h);
  const iso2 = countryForTrip(h);
  const level = levelFor(policy, iso2);
  const itinCount = (h.items || []).length;

  return (
    <motion.div
      className="holiday-card"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: '0 16px 48px rgba(0,0,0,0.22)' }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: 'easeOut' }}
    >
      <div className="holiday-card-hero">
        {h.imageUrl && <img src={h.imageUrl} alt={h.dest} onError={e => { e.target.style.display = 'none'; }} />}
        <div className="holiday-card-hero-overlay"></div>
        {/* Pencil edit button */}
        <button
          className="holiday-edit-btn"
          onClick={() => onOpenModal('editHolidayModal:' + h.id)}
          title="Edit trip"
        ><Icon name="pencil" size={13} /></button>
        <div className="holiday-card-hero-info">
          {countdown && (
            <div className={`holiday-countdown holiday-countdown-${countdown.style}`}>
              {countdown.label}
            </div>
          )}
          <div className="holiday-dest">{h.dest}</div>
          <div className="holiday-dates">{dateRange}{nights ? ' · ' + nights : ''}</div>
        </div>
      </div>
      <div className="holiday-card-body">
        {level && level !== 'cleared' && (
          <div className={`hol-flag hol-flag-${TONE_FOR_LEVEL[level]} hol-flag-card`}>
            <Icon name={level === 'restricted' ? 'octagon-alert' : 'triangle-alert'} size={13} />
            {COUNTRY_BY_ISO[iso2]?.name || iso2} — {POLICY_LEVELS[level].short}
          </div>
        )}
        {h.flight && (
          <div className="holiday-row">
            <div className="holiday-row-icon">✈</div>
            <div className="holiday-row-label">Flight</div>
            <div className="holiday-row-value">{h.flight}</div>
          </div>
        )}
        {h.accom && (
          <div className="holiday-row">
            <div className="holiday-row-icon">🏨</div>
            <div className="holiday-row-label">Stay</div>
            <div className="holiday-row-value">{h.accom}</div>
          </div>
        )}
        {h.budget && (
          <div className="holiday-row">
            <div className="holiday-row-icon">💷</div>
            <div className="holiday-row-label">Budget</div>
            <div className="holiday-row-value cost">{h.budget}</div>
          </div>
        )}
        {sav && (
          <div className="holiday-savings">
            <div className="holiday-savings-top">
              <Icon name="piggy-bank" size={13} />
              <span className="holiday-savings-name">{sav.goal.name}</span>
              <span className="holiday-savings-num">
                £{Math.round(sav.current).toLocaleString()} / £{Math.round(sav.target).toLocaleString()}
              </span>
            </div>
            <div className="holiday-savings-bar"><div style={{ width: `${sav.pct}%` }} /></div>
            {sav.perMonthNeeded != null && (
              <div className="holiday-savings-note">
                £{sav.perMonthNeeded.toLocaleString()}/mo to hit it by departure
              </div>
            )}
          </div>
        )}
        {itinCount > 0 && (
          <div className="holiday-row">
            <div className="holiday-row-icon">🗒</div>
            <div className="holiday-row-label">Itinerary</div>
            <div className="holiday-row-value">{itinCount} item{itinCount > 1 ? 's' : ''}</div>
          </div>
        )}
        {h.notes && (
          <div className="holiday-row">
            <div className="holiday-row-icon">📝</div>
            <div className="holiday-row-label">Notes</div>
            <div className="holiday-row-value">{h.notes}</div>
          </div>
        )}
        {h.status !== 'completed' && <DestinationPanel dest={h.dest} from={h.from} compact />}
      </div>
      <div className="holiday-card-footer">
        <motion.span
          className={`holiday-status ${h.status}`}
          onClick={() => cycleStatus(h.id, h.status)}
          style={{ cursor: 'pointer' }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.93 }}
          title="Click to change status"
        >
          {STATUS_LABEL[h.status] || h.status}
        </motion.span>
      </div>
    </motion.div>
  );
}

export default function HolidaySection({ S, update, active, onOpenModal }) {
  const { holidays } = S;
  const [tab, setTab] = useState('trips');
  const policy = useMemo(() => getPolicy(S), [S]);

  function cycleStatus(id, current) {
    const idx = STATUS_ORDER.indexOf(current);
    const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    update(prev => ({
      ...prev,
      holidays: (prev.holidays || []).map(h => h.id === id ? { ...h, status: next } : h),
    }));
  }

  return (
    <section id="holiday" className={`section${active ? ' active' : ''}`}>
      <div className="holiday-layout">
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
                { term: 'Trips', def: 'Dates, flights, budget and a countdown. Link one to a savings goal.' },
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
          {/* Interrail retired 2026-08 — a route planner nobody used, and a
              static European rail graph to maintain for it. S.railTrips is
              left in state so any saved route survives. */}
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
          <div className="holiday-grid" id="holidayGrid">
            {(!holidays || holidays.length === 0) ? (
              <div className="holiday-empty">
                <div className="holiday-empty-icon"><Icon name="plane" size={30} strokeWidth={1.5} /></div>
                No trips planned yet.<br />Hit <strong>+ Plan Trip</strong> to add your first holiday!
              </div>
            ) : (
              holidays.map((h, index) => (
                <TripCard
                  key={h.id}
                  h={h}
                  index={index}
                  S={S}
                  onOpenModal={onOpenModal}
                  cycleStatus={cycleStatus}
                  policy={policy}
                />
              ))
            )}
          </div>
        )}

        {tab === 'visited' && <VisitedTab S={S} update={update} />}
      </div>
    </section>
  );
}
