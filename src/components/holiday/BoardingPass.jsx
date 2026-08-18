/**
 * The selected trip, as a boarding pass.
 *
 * ── Why a pass and not a card ────────────────────────────────────────
 * The old card was a stack of labelled rows — flight, stay, budget,
 * notes — each as loud as the next. A trip does not feel like that. It
 * has one number you actually care about (how long until it), two dates,
 * and a handful of details you check once. The pass shape puts the
 * countdown at the size it deserves and lets the rest sit quietly around
 * it, which is a hierarchy the row list never had.
 *
 * The perforation and the notch are doing real work, not decoration:
 * they mark where "which trip and when" ends and "what still needs
 * doing" begins. Left stub is the fact of the trip; right is its state.
 *
 * Everything the old card could show is still here — flight, stay,
 * budget, savings, itinerary count, notes, and the travel-policy flag —
 * because removing a working feature to fit a layout is not a redesign.
 */
import { motion } from 'framer-motion';
import Icon from '../Icon';
import { COUNTRY_BY_ISO, countryForTrip } from '../../lib/holiday/destinations';
import { levelFor, POLICY_LEVELS } from '../../lib/holiday/policy';
import { tripSavings } from '../../lib/holiday/savings';
import { countdown, fmt, nightsOf, STATUS_LABEL, tripRef } from '../../lib/holiday/timeline';

const TONE_FOR_LEVEL = { restricted: 'red', notify: 'amber', cleared: 'green' };
const money = n => '£' + Math.round(n).toLocaleString();

export default function BoardingPass({ trip, S, policy, onCycleStatus, onEdit, onItinerary, now = new Date() }) {
  if (!trip) return null;

  const iso2 = countryForTrip(trip);
  const country = COUNTRY_BY_ISO[iso2]?.name || '';
  const level = levelFor(policy, iso2);
  const sav = tripSavings(S, trip);
  const c = countdown(trip, now);
  const nights = nightsOf(trip);
  const itin = (trip.items || []).length;
  const archived = c.tone === 'muted' && trip.from;

  return (
    <motion.div
      className="hol-pass"
      data-hub-module="holiday-pass"
      data-hub-module-label="Trip"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {/* ── Stub: which trip, and when ── */}
      <div className="hol-pass-stub">
        <div className="hol-pass-top">
          <div>
            <div className="hol-pass-eyebrow">{archived ? 'Archived trip' : 'Boarding pass'}</div>
            <div className="hol-pass-dest">{trip.dest || 'Untitled trip'}</div>
            {country && <div className="hol-pass-country">{country}</div>}
          </div>
          <button
            type="button"
            className={`hol-pass-status is-${trip.status}`}
            onClick={() => onCycleStatus(trip.id, trip.status)}
            title="Click to change status"
          >{STATUS_LABEL[trip.status] || trip.status}</button>
        </div>

        <div className="hol-pass-dates">
          <div>
            <div className="hol-pass-lbl">Depart</div>
            <div className="hol-pass-date">
              {trip.from ? fmt(trip.from, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : 'TBC'}
            </div>
          </div>
          <div className="hol-pass-flightline" aria-hidden="true">———✈———</div>
          <div>
            <div className="hol-pass-lbl">Return</div>
            <div className="hol-pass-date">
              {trip.to ? fmt(trip.to, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase() : 'TBC'}
            </div>
          </div>
          <div className="hol-pass-nights">
            <div className="hol-pass-lbl">Nights</div>
            <div className="hol-pass-date">{nights || '—'}</div>
          </div>
        </div>

        <span className="hol-pass-notch" aria-hidden="true" />
      </div>

      {/* ── Body: what state it is in ── */}
      <div className="hol-pass-body">
        <div className={`hol-count is-${c.tone}`}>
          <div className="hol-count-big">{c.big}</div>
          <div>
            <div className="hol-count-unit">{c.unit}</div>
            <div className="hol-count-note">{c.note}</div>
          </div>
        </div>

        {level && level !== 'cleared' && (
          <div className={`hol-flag hol-flag-${TONE_FOR_LEVEL[level]}`}>
            <Icon name={level === 'restricted' ? 'octagon-alert' : 'triangle-alert'} size={13} />
            {country || iso2} — {POLICY_LEVELS[level].short}
          </div>
        )}

        <div className="hol-tiles">
          <div className="hol-tile">
            <div className="hol-tile-lbl">✈ Flight</div>
            <div className="hol-tile-val">{trip.flight || 'Not booked'}</div>
          </div>
          <div className="hol-tile">
            <div className="hol-tile-lbl">🏨 Stay</div>
            <div className="hol-tile-val">{trip.accom || 'Not booked'}</div>
          </div>
        </div>

        {/* Savings when a goal is linked; otherwise the plain budget, so
            the row is never empty just because nothing is linked. */}
        <div className="hol-tile hol-money">
          <div className="hol-money-top">
            <span aria-hidden="true">💷</span>
            <span className="hol-money-name">{sav ? sav.goal.name : 'Budget'}</span>
            <span className="hol-money-num">
              {sav ? `${money(sav.current)} / ${money(sav.target)}` : (trip.budget || '—')}
            </span>
          </div>
          <div className="hol-money-bar">
            <i style={{ width: `${sav ? sav.pct : (trip.budget ? 100 : 0)}%` }} />
          </div>
          <div className="hol-money-note">
            {sav
              ? (sav.current >= sav.target
                ? 'Fully saved — nice.'
                : sav.perMonthNeeded != null
                  ? `${money(sav.perMonthNeeded)}/mo to hit it by departure`
                  : `${money(sav.target - sav.current)} still to go`)
              : 'No savings goal linked to this trip'}
          </div>
        </div>

        {trip.notes && (
          <div className="hol-tile">
            <div className="hol-tile-lbl">📝 Notes</div>
            <div className="hol-tile-val is-wrap">{trip.notes}</div>
          </div>
        )}

        <div className="hol-pass-foot">
          <span className="hol-pass-ref">{tripRef(trip, iso2)}</span>
          <button type="button" className="hol-btn" onClick={() => onEdit(trip.id)}>Edit trip</button>
          <button type="button" className="hol-btn is-go" onClick={() => onItinerary(trip.id)}>
            Itinerary{itin ? ` · ${itin}` : ''}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
