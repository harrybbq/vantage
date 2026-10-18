export default function ConnectToast({ onCancel }) {
  return (
    <div className="connect-toast" id="connectToast" style={{ display: 'none', alignItems: 'center', gap: '14px' }}>
      <span>✦ Click destinations to connect — ESC or Done to finish</span>
      <button
        onClick={onCancel}
        style={{ background: 'rgba(255,255,255,.25)', border: 'none', color: '#fff', borderRadius: '6px', padding: '4px 12px', fontSize: 'var(--fs-floor)', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--mono)' }}
      >Done ✓</button>
    </div>
  );
}
