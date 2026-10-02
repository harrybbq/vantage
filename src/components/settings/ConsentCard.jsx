import SettingsGroup from './SettingsGroup';
import { KINDS, isGranted, consentPatch } from '../../lib/consent/consent';
import { CONSENT_COPY } from '../consent/consentCopy';

/**
 * Settings → Privacy → Consent: where consent given on the sheet is
 * reviewed and withdrawn. The privacy policy points here, so this has to
 * exist for "withdraw at any time" to be true.
 *
 * Withdrawing writes null for that kind (consentPatch — nothing else in
 * `consent`, and nothing outside it, changes). It stops new collection;
 * it doesn't delete what's already recorded, and the copy says how to
 * stop a connected wearable too, since its server-side sync is a
 * separate authorisation.
 */
function when(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function ConsentCard({ S, update }) {
  const consent = S?.consent;

  function toggle(kind) {
    const on = isGranted(consent, kind);
    const iso = new Date().toISOString();
    update(prev => ({ ...prev, consent: consentPatch(prev.consent, { [kind]: !on }, iso) }));
  }

  return (
    <SettingsGroup
      title="Consent"
      desc="Health data and AI features are only used with your explicit say-so. Turning one off stops it from now on; it doesn't delete anything already recorded."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {KINDS.map(k => {
          const c = CONSENT_COPY[k];
          const on = isGranted(consent, k);
          return (
            <label
              key={k}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '12px 14px', borderRadius: 10,
                border: on ? '2px solid var(--em)' : '2px solid var(--border)',
                background: on ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
                cursor: 'pointer', transition: 'all .18s',
              }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(k)}
                style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--em)', cursor: 'pointer', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {c.title}
                </div>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>
                  {c.what}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: 0.4, marginTop: 6 }}>
                  {on
                    ? `Allowed ${when(consent[k])}.`
                    : c.ask}
                  {k === 'health' && on && ' To stop a connected WHOOP, Oura or Apple Health sync sending more, disconnect it in Settings → Tools too.'}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 1.4,
                textTransform: 'uppercase', color: on ? 'var(--em)' : 'var(--text-muted)',
                flexShrink: 0,
              }}>{on ? 'On' : 'Off'}</span>
            </label>
          );
        })}
      </div>
    </SettingsGroup>
  );
}
