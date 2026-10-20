/**
 * Settings → Appearance → "Design": Classic / New (preview).
 *
 * Owner-only while the redesign is in progress. Two gates, as every owner
 * surface: SettingsSection imports this lazily behind
 * OWNER_SURFACES_IN_BUILD (so native builds don't contain it), and it
 * renders nothing unless useIsOwner says so. Both are UI gates — fine for
 * a preview of a look; nothing here touches data beyond the one key.
 *
 * Writes ONE additive key, S.design, through withDesign (same object back
 * when nothing changes, so no save is queued). Classic stays selectable:
 * it is the runtime backup for the redesign.
 *
 * Styled with classic tokens (inline, like the Theme cards above it) so
 * it reads the same in either design; the SWEEP agent may restyle the
 * Settings page around it but this file is owned by the foundation.
 */
import { useRef } from 'react';
import { useIsOwner } from '../hooks/useIsOwner';
import { withDesign, resolveDesign } from '../lib/design/design';
import SettingsGroup from '../components/settings/SettingsGroup';

const OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'console', label: 'New (preview)' },
];

export default function DesignSwitch({ S, update, userId }) {
  const { isOwner } = useIsOwner(userId);
  const refs = useRef([]);
  if (!isOwner) return null;
  const current = resolveDesign(S, { allowConsole: true });
  const pick = value => update(prev => withDesign(prev, value));
  const onKeyDown = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const j = (i + (e.key === 'ArrowRight' ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    pick(OPTIONS[j].value);
    refs.current[j]?.focus();
  };
  return (
    <SettingsGroup
      title="Design"
      desc="Owner preview. Classic is the app as it is today; New is the console redesign while it's being built. Only the look changes, and you can switch back at any time."
    >
      <div
        role="radiogroup"
        aria-label="Design"
        data-testid="design-switch"
        style={{
          display: 'inline-flex', gap: 2, padding: 3, maxWidth: '100%', boxSizing: 'border-box',
          borderRadius: 9, border: '1px solid var(--border)', background: 'var(--card, rgba(255,255,255,0.04))',
        }}
      >
        {OPTIONS.map((o, i) => {
          const on = current === o.value;
          return (
            <button
              key={o.value}
              ref={el => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-design-option={o.value}
              onClick={() => pick(o.value)}
              onKeyDown={e => onKeyDown(e, i)}
              style={{
                minHeight: 40, padding: '0 16px', borderRadius: 6, cursor: 'pointer',
                border: on ? '1px solid var(--em)' : '1px solid transparent',
                background: on ? 'rgba(var(--em-rgb),0.12)' : 'transparent',
                color: on ? 'var(--text)' : 'var(--text-muted)',
                fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </SettingsGroup>
  );
}
