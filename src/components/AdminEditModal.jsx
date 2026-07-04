/**
 * AdminEditModal — owner-only quick-edit for ratings + coins.
 *
 * Right-clicking the OVR hero or the coin chip opens this with one of:
 *   target = 'rating'  → edit prestige (0-99), OVR (1-99), and the
 *                        four category ratings (1-99). Writes the
 *                        canonical profiles columns AND mirrors into
 *                        S.ratings / S.prestige so the UI updates now.
 *   target = 'coins'   → edit S.coins (clamps ≥ 0).
 *
 * Server side: profiles patches go straight via the JS client (RLS
 * already locks profiles writes to the owner of the row, i.e. you).
 * The ratings columns are normally written by recompute-ratings.js —
 * the owner override here is purely a debug/admin lever, not part of
 * the trust boundary docs/RANKING_SYSTEM.md cares about.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PRESTIGE_MAX } from '../lib/ratings/prestige';
import { backdropClose } from '../utils/backdropClose';

const CATEGORIES = ['brain', 'finance', 'fitness', 'social'];

export default function AdminEditModal({ open, target, userId, S, update, onClose }) {
  const isRating = target === 'rating';
  const isCoins  = target === 'coins';
  const cur = S?.ratings || {};

  const [form, setForm] = useState({
    prestige: String(S?.prestige || 0),
    ovr:      String(cur.ovr || 1),
    brain:    String(cur.brain || 1),
    finance:  String(cur.finance || 1),
    fitness:  String(cur.fitness || 1),
    social:   String(cur.social || 1),
    coins:    String(S?.coins || 0),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      prestige: String(S?.prestige || 0),
      ovr:      String(cur.ovr || 1),
      brain:    String(cur.brain || 1),
      finance:  String(cur.finance || 1),
      fitness:  String(cur.fitness || 1),
      social:   String(cur.social || 1),
      coins:    String(S?.coins || 0),
    });
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  if (!open) return null;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (isCoins) {
        const coins = Math.max(0, Math.round(Number(form.coins) || 0));
        update(prev => ({ ...prev, coins }));
      } else if (isRating) {
        const prestige = clamp(form.prestige, 0, PRESTIGE_MAX);
        const ratings = {
          brain:   clamp(form.brain,   1, 99),
          finance: clamp(form.finance, 1, 99),
          fitness: clamp(form.fitness, 1, 99),
          social:  clamp(form.social,  1, 99),
          ovr:     clamp(form.ovr,     1, 99),
          computedAt: new Date().toISOString(),
        };
        // Server canonical first — profiles patch (RLS lets you write
        // your own row). Failure surfaces; local mirror only on success.
        const { error: pErr } = await supabase
          .from('profiles')
          .update({
            prestige,
            ratings,
            ratings_ovr: ratings.ovr,
            ratings_computed_at: ratings.computedAt,
          })
          .eq('id', userId);
        if (pErr) throw new Error(pErr.message || 'Profile update failed.');
        update(prev => ({ ...prev, prestige, ratings }));
      }
      onClose();
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" {...backdropClose(() => onClose())}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.6,
          textTransform: 'uppercase', color: 'var(--gold, #c8970a)', fontWeight: 700,
          marginBottom: 4,
        }}>// ADMIN · OWNER ONLY</div>
        <h3 style={{ margin: '0 0 14px' }}>
          {isCoins ? 'Edit coins' : 'Edit rating & prestige'}
        </h3>

        {isCoins && (
          <div className="fg">
            <label>Coin balance</label>
            <input type="number" min="0" value={form.coins}
              onChange={e => setForm(f => ({ ...f, coins: e.target.value }))} />
          </div>
        )}

        {isRating && (
          <>
            <div className="fg">
              <label>Prestige (0–{PRESTIGE_MAX})</label>
              <input type="number" min="0" max={PRESTIGE_MAX} value={form.prestige}
                onChange={e => setForm(f => ({ ...f, prestige: e.target.value }))} />
            </div>
            <div className="fg">
              <label>OVR (1–99)</label>
              <input type="number" min="1" max="99" value={form.ovr}
                onChange={e => setForm(f => ({ ...f, ovr: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {CATEGORIES.map(c => (
                <div key={c} className="fg" style={{ marginBottom: 0 }}>
                  <label style={{ textTransform: 'capitalize' }}>{c}</label>
                  <input type="number" min="1" max="99" value={form[c]}
                    onChange={e => setForm(f => ({ ...f, [c]: e.target.value }))} />
                </div>
              ))}
            </div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
              Writes profiles.* directly. The next server recompute (≈30 s after a rating-relevant edit) will overwrite this with the derived value.
            </p>
          </>
        )}

        {error && <div style={{ color: 'rgb(220,60,60)', fontFamily: 'var(--mono)', fontSize: 11 }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
