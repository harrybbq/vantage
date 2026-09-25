/**
 * Picker modal for adding a widget to the mobile hub stack.
 *
 * Opened via openId === 'addMobileWidgetModal'. Selecting a type
 * fires onAdd with the new widget descriptor and closes itself.
 *
 * Listed widgets are stubbed when their data source isn't wired
 * yet (Calories / Mail); they still get added to the
 * stack so the user can see the slot exist — the body renders a
 * "Coming soon" stub from MobileWidget.
 */
import { WIDGET_META } from './MobileWidget';
import Icon from '../Icon';
import { APP_PRESETS, visibleAppPresets } from '../../data/appPresets';
import { tradingWidgetAvailable } from '../../lib/trading/enabled';
import { useSubscriptionContext } from '../../context/SubscriptionContext';
import { backdropClose } from '../../utils/backdropClose';
import { widgetReadiness } from '../../lib/widgets/readiness';
import PrimePicker from '../widgets/prime/PrimePicker';

// App-preset widget types (FloorplanStudio / …) — a Pro bonus, so
// they're locked for free users in the picker below.
const APP_PRESET_TYPES = new Set(APP_PRESETS.map(p => p.id));
// Pro-gated widgets beyond the Our Apps presets. Body goal earns it:
// it's the projection engine, not a view of data the user can already
// read elsewhere. Goals stays free — it only pins progress that is
// already visible on the achievements board and the savings page.
const PRO_WIDGET_TYPES = new Set(['body-goal']);
const isProWidget = type => APP_PRESET_TYPES.has(type) || PRO_WIDGET_TYPES.has(type);

export default function AddMobileWidgetModal({ openId, onClose, existingTypes, onAdd, onUpgrade, S = {}, onNavigate }) {
  const { hasPro } = useSubscriptionContext();
  const isOpen = openId === 'addMobileWidgetModal';
  if (!isOpen) return null;
  const existing = new Set(existingTypes || []);

  // Built per-open (not module-level) so owner-only presets resolve
  // against the signed-in account rather than against whoever the app
  // happened to be loaded for.
  // Recent wins / Coin history / Habits / Holidays / Savings pots /
  // Projection / Subscriptions are no longer offered here: each is a
  // block on a prime card above (Achievements, Habits, Holidays,
  // Savings). Their META and render cases stay, so a stack that already
  // has one keeps a working card.
  const pickerOrder = [
    // Mobile parity for the desktop hub widgets.
    'github',
    'linkedin',
    // User app presets from shared config (owner-only ones filtered).
    ...visibleAppPresets().map(p => p.id),
    'vitals',
    'goals',
    'body-goal',
    // 'body' retired — it only showed the weight trend, which the Body
    // Goal and Goals widgets both cover. Deliberately removed from the
    // picker only: the META entry and render case stay so hubs that
    // already have one keep a working widget rather than having it
    // silently turn into something else.
    'macros',
    'calories',
    'market',
    'news',
    'mail',
    // Owner-only AND web-only: absent from native builds entirely, so
    // an app-store reviewer never meets a brokerage surface.
    ...(tradingWidgetAvailable() && (typeof window !== 'undefined' && window.__vantageOwner) ? ['trading'] : []),
    // 'rotation' stood here. Retired 2026-08-16 — see
    // lib/widgets/retired.js. The page it read from is untouched.
  ];

  function pick(type) {
    // Pro-gated widgets — route free users to the paywall rather than
    // adding a widget they can't use.
    if (isProWidget(type) && !hasPro) {
      onClose('addMobileWidgetModal');
      onUpgrade?.();
      return;
    }
    // Not set up yet: take them to the page that fills it in rather
    // than adding a card whose only possible state is an empty state.
    // Tapping the row is the request to use the feature — answering it
    // with the setup page is more useful than refusing.
    const { ready, where } = widgetReadiness(type, S);
    if (!ready) {
      onClose('addMobileWidgetModal');
      if (where) onNavigate?.(where);
      return;
    }
    onAdd({ id: 'w' + Date.now(), type });
    onClose('addMobileWidgetModal');
  }

  return (
    <div
      className="modal-overlay open"
      {...backdropClose(() => onClose('addMobileWidgetModal'))}
    >
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3>Add Widget</h3>

        <PrimePicker
          compact
          S={S}
          widgets={S.mobileWidgets || []}
          onAdd={w => { onAdd({ ...w, id: 'w' + Date.now() }); onClose('addMobileWidgetModal'); }}
        />

        <span className="aw-section-lbl">Widgets</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pickerOrder.map(type => {
            const meta = WIDGET_META[type];
            if (!meta) return null;
            const alreadyAdded = existing.has(type);
            const stub = !!meta.requires;
            // Shown, not hidden. A disabled row that names what unlocks
            // it teaches that the feature exists; a missing row cannot.
            // Same call as PickList's locked rows.
            const { ready, need } = widgetReadiness(type, S);
            // Locked for free users, but still tappable (routes to the
            // paywall via pick()).
            const proLocked = isProWidget(type) && !hasPro;
            return (
              <button
                key={type}
                type="button"
                onClick={() => !alreadyAdded && pick(type)}
                disabled={alreadyAdded}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 12px', borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)', textAlign: 'left',
                  cursor: alreadyAdded ? 'not-allowed' : 'pointer',
                  opacity: alreadyAdded ? 0.5 : (!ready || proLocked) ? 0.75 : 1,
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
                  {meta.svg ? <Icon name={meta.svg} size={16} /> : meta.icon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontFamily: 'var(--sans)', fontSize: 13.5, fontWeight: 600,
                  }}>
                    {meta.label}
                    {proLocked && (
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 8, fontWeight: 700,
                        letterSpacing: 1, padding: '1px 5px', borderRadius: 4,
                        background: 'rgba(200,151,10,.14)', color: 'var(--gold, #c8970a)',
                        border: '1px solid rgba(200,151,10,.30)',
                      }}>PRO</span>
                    )}
                  </span>
                  <span style={{
                    display: 'block',
                    fontFamily: 'var(--mono)', fontSize: 10,
                    letterSpacing: 0.4, color: 'var(--text-muted)',
                    marginTop: 2,
                  }}>
                    {alreadyAdded ? 'Already added'
                      : proLocked ? 'Pro bonus — tap to upgrade'
                      : stub ? 'Coming soon'
                      : !ready ? need
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
