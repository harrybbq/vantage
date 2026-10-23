import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Overlay from '../ui/Overlay';
import { supportLines, BLOCKED_BODY, SUPPORT_TITLE } from '../../lib/safety/support';
import './friends-dm.css';

/**
 * Supportive information (item 113; ABUSE_HANDLING G-2; OSA draft ICU
 * F2 / G5): who to talk to and where to report, shown at the moments the
 * Codes name — after a report, after a block — and in Settings.
 *
 *   SupportLines       the lines themselves, numbers and sites as real
 *                      tel: / https links. `already` is text the sheet
 *                      already shows (a reason's signpost), so a number
 *                      is never printed twice.
 *   BlockedNoticeHost  one per app (App's Board). Every block, from any
 *                      surface, calls announceBlocked() once it has
 *                      succeeded; the host shows "Blocked" with the lines.
 *                      An event rather than a prop because block is done
 *                      in four places (friend rail, conversation, the
 *                      leaderboard/group/request rows, the console hub)
 *                      and each already closes its own sheet on success —
 *                      the same arrangement as `vantage:dm-unread`.
 *
 * Shown to everyone: there is no age signal (item 114). Calm on purpose —
 * the report sheet's own colours, no red, Done is the only button.
 */

const BLOCKED_EVENT = 'vantage:blocked';

/** Call after a block has succeeded. `target`: { name?, handle? }. */
export function announceBlocked(target) {
  const name = target?.name || (target?.handle ? `@${target.handle}` : null);
  try { window.dispatchEvent(new CustomEvent(BLOCKED_EVENT, { detail: { name } })); } catch { /* old browsers */ }
}

export function SupportLines({ full = false, already = '', title = SUPPORT_TITLE, className = '' }) {
  const lines = supportLines({ full, already });
  if (!lines.length) return null;
  return (
    <div className={`safe-lines${className ? ` ${className}` : ''}`} role="note" aria-label={title || undefined}>
      {title && <div className="safe-lines-title">{title}</div>}
      <ul>
        {lines.map(l => (
          <li key={l.id}>
            {l.parts.map((p, i) => (typeof p === 'string' ? p : (
              <a
                key={i}
                href={p.href}
                {...(p.href.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >{p.text}</a>
            )))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BlockedNoticeHost() {
  const [shown, setShown] = useState(null); // { name } while open

  useEffect(() => {
    const on = e => setShown({ name: e?.detail?.name || null });
    window.addEventListener(BLOCKED_EVENT, on);
    return () => window.removeEventListener(BLOCKED_EVENT, on);
  }, []);

  useEffect(() => {
    if (!shown) return undefined;
    const onKey = e => { if (e.key === 'Escape') setShown(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown]);

  const close = () => setShown(null);

  return (
    <Overlay>
    <AnimatePresence>
      {shown && (
        <motion.div
          className="modal-overlay open"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={close}
          style={{ display: 'flex' }}
        >
          <motion.div
            className="modal handle-claim-modal report-modal"
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="blocked-notice-title"
          >
            <div className="handle-claim-eyebrow">Block</div>
            <h3 className="handle-claim-title" id="blocked-notice-title">
              {shown.name ? `${shown.name} is blocked` : 'Blocked'}
            </h3>
            <div className="report-ack" role="status">
              <p>{BLOCKED_BODY(shown.name)}</p>
            </div>
            <SupportLines />
            <div className="handle-claim-actions">
              <button type="button" className="btn btn-primary" onClick={close} autoFocus>
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Overlay>
  );
}
