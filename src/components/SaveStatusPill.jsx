/**
 * "Not saved — retrying", when the cloud is behind.
 *
 * Saves used to fail silently: the edit stayed on screen, so nothing
 * looked wrong, and closing the app lost it. The hook now retries with a
 * backoff and reports `saveStatus` after the second failure in a row;
 * this is the one line of UI that tells the user not to close the app
 * yet. It disappears by itself the moment a save lands.
 *
 * `blocked` is the anti-wipe guard refusing a save — the cloud copy is
 * intact, and a reload brings it back — so it says that instead.
 *
 * Small, bottom-centre, above the mobile tab bar, and it never takes
 * pointer events except on its own button.
 */
const wrap = {
  position: 'fixed', left: '50%', transform: 'translateX(-50%)',
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)', zIndex: 9000,
  display: 'flex', alignItems: 'center', gap: 8, maxWidth: 'calc(100vw - 32px)',
  boxSizing: 'border-box', padding: '6px 12px', borderRadius: 999,
  fontFamily: 'var(--mono, ui-monospace, Menlo, monospace)', fontSize: 11, lineHeight: 1.4,
  background: 'var(--surface, #1c1c1a)', color: 'var(--text, #e8e8e2)',
  border: '1px solid #d99114', boxShadow: '0 4px 16px rgba(0,0,0,.25)',
  pointerEvents: 'none',
};
const dot = { width: 7, height: 7, borderRadius: 7, background: '#d99114', flexShrink: 0 };

export default function SaveStatusPill({ status }) {
  if (!status) return null;
  const blocked = status.state === 'blocked';
  return (
    <div role="status" aria-live="polite" className="save-status-pill" style={wrap}>
      <span style={dot} aria-hidden="true" />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {blocked ? 'Not saved — reload to restore your data' : 'Not saved — retrying'}
      </span>
      {blocked && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            pointerEvents: 'auto', font: 'inherit', fontSize: 11, padding: '2px 8px',
            borderRadius: 999, cursor: 'pointer', background: 'transparent',
            color: 'inherit', border: '1px solid currentColor',
          }}
        >
          Reload
        </button>
      )}
    </div>
  );
}
