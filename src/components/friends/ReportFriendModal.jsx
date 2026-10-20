import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Overlay from '../ui/Overlay';
import { REASONS, reasonInfo } from '../../lib/moderation/reasons';
import './friends-dm.css';

/**
 * Report flow (Apple 1.2; Online Safety Act reporting duties, item 110).
 *
 * Reason chips + a free-text `context`, into the `reports` table. The
 * reasons live in lib/moderation/reasons.js: what's stored is the label,
 * so reports filed before the new reasons still read the same. Picking
 * self-harm, a child's safety or threats shows who to call straight
 * away — before the report is even sent — and those reach the top of
 * the owner's queue.
 *
 * After sending, the sheet confirms the report arrived and says what
 * happens next (the same promise the Terms make): looked at within 24
 * hours, the outcome told in-app (a safety notice — the database files
 * a "we got your report" notice too), the other person never told who.
 *
 * Props:
 *   open
 *   friend       — { name, handle }
 *   onSubmit     — async (reason, context) => void
 *   onBlock      — optional async () => void. When given, the sheet also
 *                  offers Block, so a surface with room for one control
 *                  (a leaderboard or group row) still gets both actions.
 *   onClose
 */
export default function ReportFriendModal({ open, friend, onSubmit, onBlock, onClose }) {
  const [reason, setReason] = useState(REASONS[0].label);
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Reset on open so re-opens don't show stale state from a prior report.
  useEffect(() => {
    if (open) {
      setReason(REASONS[0].label);
      setContext('');
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

  const info = reasonInfo(reason);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason, context.trim() || null);
      setSubmitted(true);
    } catch (e) {
      setError(e.message || 'Could not submit report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Overlay>
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay open"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
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
            aria-labelledby="report-modal-title"
          >
            <div className="handle-claim-eyebrow">Report</div>
            <h3 className="handle-claim-title" id="report-modal-title">
              Report {friend?.name || 'this user'}
            </h3>

            {submitted ? (
              <>
                <div className="report-ack" role="status">
                  <div className="report-ack-title">Report received</div>
                  <p>
                    Thanks for telling us. A person looks at every report, aiming
                    for within 24 hours — sooner for a child&apos;s safety, threats or
                    self-harm. We&apos;ll let you know the outcome in the app, under
                    Friends. {friend?.name || 'They'} won&apos;t be told who reported them.
                  </p>
                </div>
                {info.signpost && <p className="report-signpost">{info.signpost}</p>}
                {onBlock && (
                  <p className="handle-claim-sub">
                    You can also block them, so they can&apos;t message you or send you requests.
                  </p>
                )}
                <div className="handle-claim-actions">
                  {onBlock && (
                    <button type="button" className="btn btn-ghost" onClick={onBlock}>
                      Block
                    </button>
                  )}
                  <button type="button" className="btn btn-primary" onClick={onClose}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleSubmit} className="handle-claim-form">
                <p className="handle-claim-sub" style={{ margin: 0 }}>
                  What's the issue? We review every report and won't tell
                  the other user you reported them.
                </p>

                <div className="report-reason-chips" role="radiogroup" aria-label="Reason">
                  {REASONS.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={reason === r.label}
                      className={`report-reason-chip${reason === r.label ? ' selected' : ''}${r.priority === 0 ? ' is-urgent' : ''}`}
                      onClick={() => setReason(r.label)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                {info.hint && <p className="report-hint">{info.hint}</p>}
                {info.signpost && <p className="report-signpost" role="note">{info.signpost}</p>}

                <textarea
                  className="report-context-input"
                  placeholder="Anything else we should know? (optional)"
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  rows={3}
                  maxLength={500}
                />

                {error && <div className="handle-claim-error">{error}</div>}

                {onBlock && (
                  <button type="button" className="report-block-link" onClick={onBlock} disabled={submitting}>
                    Block without reporting
                  </button>
                )}

                <div className="handle-claim-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onClose}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting…' : 'Submit report'}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Overlay>
  );
}
