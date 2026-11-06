import { useState } from 'react';
import { createPortal } from 'react-dom';
import { backdropClose } from '../../utils/backdropClose';
import PayDayFields from './PayDayFields';
import { payOf, setPayDay, clearPayDay } from '../../lib/money/payday';

/**
 * Classic Track: mark a pay day (from the calendar's day menu, or the
 * pay indicator's "Set" / "Change"). One schedule; saving replaces it.
 * Writes only S.pay (lib/money/payday).
 */
export default function PayDayModal({ S, date, update, onClose }) {
  const current = payOf(S);
  const [day, setDay] = useState(date || current?.anchor || '');
  const [freq, setFreq] = useState(current?.freq || 'month');
  const [weekendEarly, setWeekendEarly] = useState(current ? current.weekendEarly || current.freq !== 'month' : true);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(day);

  // Portalled like EventModal: inside Track's card, Cream re-points the
  // text tokens to light-on-dark, which would wash out a light modal.
  return createPortal(
    <div className="modal-overlay open" {...backdropClose(onClose)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="payday-title" style={{ maxWidth: 420 }}>
        <h3 id="payday-title" style={{ margin: '0 0 14px' }}>{current ? 'Your pay day' : 'Mark your pay day'}</h3>
        <PayDayFields date={day} onDate={setDay} freq={freq} onFreq={setFreq}
                      weekendEarly={weekendEarly} onWeekendEarly={setWeekendEarly} />
        <div className="modal-actions">
          {current && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }}
                    onClick={() => { update(prev => clearPayDay(prev)); onClose(); }}>Remove pay day</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!ok}
                  onClick={() => { update(prev => setPayDay(prev, day, freq, { weekendEarly })); onClose(); }}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
