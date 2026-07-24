import { motion } from 'framer-motion';
import Icon from './Icon';
import SectionHelp from './SectionHelp';

const STATUS_ORDER = ['planning', 'booked', 'completed'];
const STATUS_LABEL = { planning: 'Planning', booked: 'Booked', completed: 'Completed' };

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

export default function HolidaySection({ S, update, active, onOpenModal }) {
  const { holidays } = S;

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
            <div className="sec-title">Holiday Planner <SectionHelp text="Plan upcoming trips — dates, flights, accommodation, budget, and a cover photo, with a live countdown to departure. Status badges track each trip from planning to completed, and the Holidays hub widget keeps your next trips a glance away." /></div>
          </motion.div>
          <motion.button className="btn btn-primary" onClick={() => onOpenModal('addHolidayModal')}
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}>+ Plan Trip</motion.button>
        </div>
        <div className="holiday-grid" id="holidayGrid">
          {(!holidays || holidays.length === 0) ? (
            <div className="holiday-empty">
              <div className="holiday-empty-icon"><Icon name="plane" size={30} strokeWidth={1.5} /></div>
              No trips planned yet.<br />Hit <strong>+ Plan Trip</strong> to add your first holiday!
            </div>
          ) : (
            holidays.map((h, index) => {
              const dateRange = h.from && h.to
                ? `${new Date(h.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} → ${new Date(h.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : h.from ? `From ${new Date(h.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Dates TBC';
              const nights = h.from && h.to
                ? Math.round((new Date(h.to) - new Date(h.from)) / (1000 * 60 * 60 * 24)) + ' nights'
                : '';
              const countdown = getCountdown(h);

              return (
                <motion.div
                  key={h.id}
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
                    {h.notes && (
                      <div className="holiday-row">
                        <div className="holiday-row-icon">📝</div>
                        <div className="holiday-row-label">Notes</div>
                        <div className="holiday-row-value">{h.notes}</div>
                      </div>
                    )}
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
            })
          )}
        </div>
      </div>
    </section>
  );
}
