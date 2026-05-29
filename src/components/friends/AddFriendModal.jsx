import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Search-by-handle + send-request UI. The whole search runs through
 * the SECURITY DEFINER RPC (`search_profiles_by_handle`) so block
 * lists are honoured server-side without leaking blocker identity.
 *
 * Props:
 *   open
 *   atCap            — disables the Send button + shows upsell copy
 *   pendingIds       — Set of user IDs we've already requested or
 *                      who've requested us; their button reads "Pending"
 *   friendIds        — Set of user IDs we're already friends with;
 *                      their button reads "Friends"
 *   onSearch(q)      — async (string) => Profile[]
 *   onSend(toUserId) — async; resolves on successful insert
 *   onClose
 *   onUpgrade        — optional; opens the paywall when at cap
 */
export default function AddFriendModal({
  open, atCap, pendingIds, friendIds,
  onSearch, onSend, onClose, onUpgrade,
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(new Set()); // local-only, optimistic
  const [sendingFor, setSendingFor] = useState(null);
  const debounceRef = useRef(null);

  // Reset state when the modal closes — opening it fresh shouldn't
  // show stale results from the previous open.
  useEffect(() => {
    if (!open) {
      setQ(''); setResults([]); setError(null); setSentTo(new Set());
    }
  }, [open]);

  // Debounced search. 280 ms feels right: type → tiny pause → list
  // appears. Shorter and the server handles double the queries; longer
  // and the UI feels laggy.
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    const trimmed = q.trim().replace(/^@/, '');
    if (trimmed.length < 2) { setResults([]); setError(null); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const r = await onSearch(trimmed);
        setResults(r || []);
      } catch (e) {
        setError(e.message || 'Search failed.');
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(debounceRef.current);
  }, [q, open, onSearch]);

  async function handleSend(profile) {
    if (atCap) { onUpgrade?.(); return; }
    setSendingFor(profile.id);
    setError(null);
    try {
      await onSend(profile.id);
      setSentTo(prev => new Set(prev).add(profile.id));
    } catch (e) {
      setError(e.message || 'Could not send request.');
    } finally {
      setSendingFor(null);
    }
  }

  function statusFor(profile) {
    if (friendIds?.has(profile.id))  return 'Friends';
    if (pendingIds?.has(profile.id)) return 'Pending';
    if (sentTo.has(profile.id))      return 'Sent';
    return null;
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-bg"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{ display: 'flex' }}
        >
          <motion.div
            className="modal add-friend-modal"
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-friend-title"
          >
            <div className="handle-claim-eyebrow">Add a friend</div>
            <h3 className="handle-claim-title" id="add-friend-title">Search by handle</h3>

            {atCap && (
              <div className="add-friend-cap-banner">
                You've reached your free-tier friend cap.{' '}
                <button className="link-btn" type="button" onClick={onUpgrade}>
                  Upgrade to Pro
                </button>{' '}for unlimited friends.
              </div>
            )}

            <div className="handle-claim-input-wrap">
              <span className="handle-claim-prefix">@</span>
              <input
                className="handle-claim-input"
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="handle"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            {error && <div className="handle-claim-error">{error}</div>}

            <div className="add-friend-results">
              {q.trim().replace(/^@/, '').length < 2 ? (
                <div className="add-friend-hint">Type at least 2 characters to search.</div>
              ) : searching ? (
                <div className="add-friend-hint">Searching…</div>
              ) : results.length === 0 ? (
                <div className="add-friend-hint">No matching handles.</div>
              ) : results.map(profile => {
                const status = statusFor(profile);
                return (
                  <div key={profile.id} className="add-friend-result">
                    <div className="add-friend-result-info">
                      <div className="add-friend-result-name">
                        {profile.display_name || `@${profile.handle}`}
                      </div>
                      <div className="add-friend-result-meta">
                        @{profile.handle} · OVR {profile.ratings_ovr || 1}
                      </div>
                    </div>
                    {status ? (
                      <span className="add-friend-result-status">{status}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSend(profile)}
                        disabled={sendingFor === profile.id}
                      >
                        {sendingFor === profile.id ? 'Sending…' : 'Send'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="handle-claim-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
