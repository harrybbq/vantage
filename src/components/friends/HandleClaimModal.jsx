import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { setHandle, validateHandle } from '../../lib/friends/queries';
import Overlay from '../ui/Overlay';

/**
 * Modal shown the first time a user opens the Friends rail without a
 * claimed handle. Lazy claim — we deliberately don't ask for one at
 * signup so the auth flow stays minimal.
 *
 * Props:
 *   open       — boolean
 *   userId     — current auth uid
 *   suggested  — optional starting value (we feed it the user's
 *                display name lowercased + stripped)
 *   onClaim    — async (handle) => void; called with the saved
 *                handle so the parent can refresh.
 *   onClose
 */
export default function HandleClaimModal({ open, userId, suggested = '', onClaim, onClose }) {
  const [value, setValue] = useState(suggested);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Surface the same validation as the SQL check constraint so
  // submit only blocks on inputs the server would also reject.
  const localError = error || (value && validateHandle(value));

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const err = validateHandle(value);
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await setHandle(userId, value.trim());
      await onClaim?.(updated);
      onClose?.();
    } catch (e) {
      setError(e.message || 'Could not save handle.');
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
            aria-labelledby="handle-claim-title"
          >
            <div className="handle-claim-eyebrow">Friends</div>
            <h3 className="handle-claim-title" id="handle-claim-title">Pick a handle</h3>
            <p className="handle-claim-sub">
              Friends will use this to add you. Letters, numbers, and underscores —
              between 3 and 20 characters. You can change it later.
            </p>

            <form onSubmit={handleSubmit} className="handle-claim-form">
              <div className="handle-claim-input-wrap">
                <span className="handle-claim-prefix">@</span>
                <input
                  className="handle-claim-input"
                  autoFocus
                  value={value}
                  onChange={e => { setValue(e.target.value); setError(null); }}
                  placeholder="yourhandle"
                  maxLength={20}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
              {localError && <div className="handle-claim-error">{localError}</div>}

              <div className="handle-claim-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Not now
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || !value || !!validateHandle(value)}
                >
                  {submitting ? 'Saving…' : 'Claim handle'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Overlay>
  );
}
