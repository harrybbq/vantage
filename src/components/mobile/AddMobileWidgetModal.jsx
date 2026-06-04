/**
 * Picker modal for adding a widget to the mobile hub stack.
 *
 * Opened via openId === 'addMobileWidgetModal'. Selecting a type
 * fires onAdd with the new widget descriptor and closes itself.
 *
 * Listed widgets are stubbed when their data source isn't wired
 * yet (Vitals / Calories / Mail); they still get added to the
 * stack so the user can see the slot exist — the body renders a
 * "Coming soon" stub from MobileWidget.
 */
import { WIDGET_META } from './MobileWidget';
import { APP_PRESETS } from '../../data/appPresets';

const PICKER_ORDER = [
  'notepad',
  'recent-wins',
  'coin-history',
  // F4 Sprint 4 — mobile parity for the desktop hub widgets.
  'github',
  'linkedin',
  'youtube',
  // User app presets (FloorplanStudio / TubeLube / …) from shared config.
  ...APP_PRESETS.map(p => p.id),
  'vitals',
  'calories',
  'mail',
];

export default function AddMobileWidgetModal({ openId, onClose, existingTypes, onAdd }) {
  const isOpen = openId === 'addMobileWidgetModal';
  if (!isOpen) return null;
  const existing = new Set(existingTypes || []);

  function pick(type) {
    onAdd({ id: 'w' + Date.now(), type });
    onClose('addMobileWidgetModal');
  }

  return (
    <div
      className="modal-overlay open"
      onClick={e => { if (e.target === e.currentTarget) onClose('addMobileWidgetModal'); }}
    >
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3>Add Widget</h3>
        <p style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
          margin: '0 0 16px', lineHeight: 1.65,
        }}>
          Widgets stack below AI Coach. Pick one to add — you can remove
          any with the × in its top-right corner.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PICKER_ORDER.map(type => {
            const meta = WIDGET_META[type];
            if (!meta) return null;
            const alreadyAdded = existing.has(type);
            const stub = !!meta.requires;
            return (
              <button
                key={type}
                type="button"
                onClick={() => !alreadyAdded && pick(type)}
                disabled={alreadyAdded}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: alreadyAdded ? 'transparent' : 'var(--card, rgba(255,255,255,0.04))',
                  color: 'var(--text)', textAlign: 'left',
                  cursor: alreadyAdded ? 'not-allowed' : 'pointer',
                  opacity: alreadyAdded ? 0.5 : 1,
                  transition: 'all .15s',
                }}
              >
                <span
                  style={{
                    width: 28, height: 28, borderRadius: 7,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, lineHeight: 1, flexShrink: 0,
                    background: meta.accent ? meta.accent + '1a' : 'rgba(var(--em-rgb),0.10)',
                    border: '1px solid ' + (meta.accent ? meta.accent + '55' : 'var(--border)'),
                    color: meta.accent || 'var(--em)',
                  }}
                >
                  {meta.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block',
                    fontFamily: 'var(--sans)', fontSize: 13.5, fontWeight: 600,
                  }}>
                    {meta.label}
                  </span>
                  <span style={{
                    display: 'block',
                    fontFamily: 'var(--mono)', fontSize: 10,
                    letterSpacing: 0.4, color: 'var(--text-muted)',
                    marginTop: 2,
                  }}>
                    {alreadyAdded ? 'Already added'
                      : stub ? 'Coming soon'
                      : 'Available now'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => onClose('addMobileWidgetModal')}>Close</button>
        </div>
      </div>
    </div>
  );
}
