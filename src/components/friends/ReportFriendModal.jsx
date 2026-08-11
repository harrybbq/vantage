import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Overlay from '../ui/Overlay';

/**
 * Report flow — minimum viable moderation surface.
 *
 * Pre-filled reason chips for the most common motivations + a free-text
 * `context` field. Both end up in the `reports` table where service-role
 * triage picks them up. We deliberately don't promise a response time or
 * outcome — that's a manual moderation operation for now.
 *
 * Props:
 *   open
 *   friend       — { name, handle }
 *   onSubmit     — async (reason, context) => void
 *   onClose
 */
const REASONS = [
  'Harassment or bullying',
  'Inappropriate handle or display name',
  'Spam',
  'Impersonation',
  'Something else',
];

export default function ReportFriendModal({ open, friend, onSubmit, onClose }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Reset on open so re-opens don't show stale state from a prior report.
  useEffect(() => {
    if (open) {
      setReason(REASONS[0]);
      setContext('');
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

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
            className="modal handle-claim-modal"
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
                <p className="handle-claim-sub">
                  Thanks — we've logged your report. We review every report
                  manually and take action where needed. You can also block
                  this user to remove them from your friends and prevent
                  future requests.
                </p>
                <div className="handle-claim-actions">
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

                <div className="report-reason-chips">
                  {REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      className={`report-reason-chip${reason === r ? ' selected' : ''}`}
                      onClick={() => setReason(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                <textarea
                  className="report-context-input"
                  placeholder="Anything else we should know? (optional)"
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  rows={3}
                  maxLength={500}
                />

                {error && <div className="handle-claim-error">{error}</div>}

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
