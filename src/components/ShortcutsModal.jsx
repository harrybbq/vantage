import { motion, AnimatePresence } from 'framer-motion';
import { backdropClose } from '../utils/backdropClose';

const SHORTCUTS = {
  Navigation: [
    { keys: ['1'], desc: 'Hub' },
    { keys: ['2'], desc: 'Achievements' },
    { keys: ['3'], desc: 'Track' },
    { keys: ['4'], desc: 'Shopping' },
    { keys: ['5'], desc: 'Holiday' },
  ],
  Actions: [
    { keys: ['N'], desc: 'New item on active screen' },
    { keys: ['Esc'], desc: 'Close modal' },
  ],
  General: [
    { keys: ['Ctrl', 'K'], desc: 'Command palette' },
    { keys: ['?'], desc: 'Show this reference' },
  ],
};

function Key({ children }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontFamily: 'var(--mono)',
      background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
      color: 'var(--text)', lineHeight: '1.5',
    }}>{children}</kbd>
  );
}

export default function ShortcutsModal({ open, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          {...backdropClose(() => onClose())}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: '18px', padding: '28px', maxWidth: '480px', width: '90%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Keyboard Shortcuts</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '20px' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              {Object.entries(SHORTCUTS).map(([group, items]) => (
                <div key={group}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>{group}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {items.map(({ keys, desc }) => (
                      <div key={desc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text)' }}>{desc}</span>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          {keys.map(k => <Key key={k}>{k}</Key>)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
