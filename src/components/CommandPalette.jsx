import { useState, useEffect, useCallback } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import { backdropClose } from '../utils/backdropClose';

function KbdHint({ keys }) {
  return (
    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
      {keys.map(k => (
        <kbd key={k} style={{
          padding: '1px 5px', borderRadius: '4px', fontSize: '10px',
          fontFamily: 'var(--mono)', background: 'rgba(255,255,255,.1)',
          border: '1px solid rgba(255,255,255,.18)', color: 'rgba(255,255,255,.55)',
        }}>{k}</kbd>
      ))}
    </div>
  );
}

function Cmd({ label, hint, onSelect }) {
  return (
    <Command.Item
      onSelect={onSelect}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '9px 14px', cursor: 'pointer', borderRadius: '9px',
        fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text)',
        gap: '10px',
      }}
    >
      <span>{label}</span>
      {hint && <KbdHint keys={hint} />}
    </Command.Item>
  );
}

export default function CommandPalette({ open, onClose, navigate, openModal, S }) {
  const [search, setSearch] = useState('');

  // Reset search on open
  useEffect(() => { if (open) setSearch(''); }, [open]);

  const go = useCallback((fn) => { fn(); onClose(); }, [onClose]);

  const achievements = (S?.achievements || []).filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) && search.length > 1
  );
  const shopItems = (S?.shopItems || []).filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) && search.length > 1
  );
  const holidays = (S?.holidays || []).filter(h =>
    (h.dest || '').toLowerCase().includes(search.toLowerCase()) && search.length > 1
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 4000,
            background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: '12vh',
          }}
          {...backdropClose(() => onClose())}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -10 }}
            transition={{ duration: 0.14 }}
            style={{ width: '90%', maxWidth: '560px' }}
          >
            <Command
              label="Command palette"
              style={{
                background: 'rgba(18,24,20,.97)', border: '1px solid rgba(255,255,255,.15)',
                borderRadius: '16px', overflow: 'hidden',
                boxShadow: '0 24px 80px rgba(0,0,0,.5)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.08)', gap: '10px' }}>
                <span style={{ color: 'rgba(255,255,255,.4)', fontSize: '14px' }}>⌕</span>
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search commands, achievements, trips…"
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none',
                    fontFamily: 'var(--mono)', fontSize: '13px', color: '#fff',
                  }}
                  autoFocus
                />
                <KbdHint keys={['Esc']} />
              </div>

              <Command.List style={{ maxHeight: '380px', overflowY: 'auto', padding: '8px' }}>
                <Command.Empty style={{ padding: '20px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'rgba(255,255,255,.35)' }}>
                  No results
                </Command.Empty>

                <Command.Group heading="Navigate" style={{ '--cmdk-group-heading-color': 'rgba(255,255,255,.35)', '--cmdk-group-heading-font-size': '10px', '--cmdk-group-heading-letter-spacing': '1px', '--cmdk-group-heading-padding': '6px 14px 4px', fontFamily: 'var(--mono)' }}>
                  <Cmd label="Go to Hub" hint={['1']} onSelect={() => go(() => navigate('hub'))} />
                  <Cmd label="Go to Achievements" hint={['2']} onSelect={() => go(() => navigate('achievements'))} />
                  <Cmd label="Go to Track" hint={['3']} onSelect={() => go(() => navigate('track'))} />
                  <Cmd label="Go to Shopping" hint={['4']} onSelect={() => go(() => navigate('shop'))} />
                  <Cmd label="Go to Holiday" hint={['5']} onSelect={() => go(() => navigate('holiday'))} />
                </Command.Group>

                <Command.Group heading="Actions" style={{ '--cmdk-group-heading-color': 'rgba(255,255,255,.35)', '--cmdk-group-heading-font-size': '10px', '--cmdk-group-heading-letter-spacing': '1px', '--cmdk-group-heading-padding': '6px 14px 4px', fontFamily: 'var(--mono)' }}>
                  <Cmd label="Add Widget" hint={['N']} onSelect={() => go(() => { navigate('hub'); setTimeout(() => openModal('addLinkModal'), 100); })} />
                  <Cmd label="New Achievement" hint={['N']} onSelect={() => go(() => { navigate('achievements'); setTimeout(() => openModal('addAchievementModal'), 100); })} />
                  <Cmd label="New Tracker" hint={['N']} onSelect={() => go(() => { navigate('track'); setTimeout(() => openModal('addTrackerModal'), 100); })} />
                  <Cmd label="Add Shop Item" hint={['N']} onSelect={() => go(() => { navigate('shop'); setTimeout(() => openModal('addShopModal'), 100); })} />
                  <Cmd label="Plan a Trip" hint={['N']} onSelect={() => go(() => { navigate('holiday'); setTimeout(() => openModal('addHolidayModal'), 100); })} />
                  <Cmd label="Log Today" onSelect={() => go(() => { navigate('hub'); setTimeout(() => document.querySelector('.quick-log-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); })} />
                </Command.Group>

                {achievements.length > 0 && (
                  <Command.Group heading="Achievements" style={{ '--cmdk-group-heading-color': 'rgba(255,255,255,.35)', '--cmdk-group-heading-font-size': '10px', '--cmdk-group-heading-letter-spacing': '1px', '--cmdk-group-heading-padding': '6px 14px 4px', fontFamily: 'var(--mono)' }}>
                    {achievements.map(a => (
                      <Cmd key={a.id} label={`${a.icon} ${a.name}`} onSelect={() => go(() => navigate('achievements'))} />
                    ))}
                  </Command.Group>
                )}

                {shopItems.length > 0 && (
                  <Command.Group heading="Shopping" style={{ '--cmdk-group-heading-color': 'rgba(255,255,255,.35)', '--cmdk-group-heading-font-size': '10px', '--cmdk-group-heading-letter-spacing': '1px', '--cmdk-group-heading-padding': '6px 14px 4px', fontFamily: 'var(--mono)' }}>
                    {shopItems.map(i => (
                      <Cmd key={i.id} label={i.name} onSelect={() => go(() => navigate('shop'))} />
                    ))}
                  </Command.Group>
                )}

                {holidays.length > 0 && (
                  <Command.Group heading="Trips" style={{ '--cmdk-group-heading-color': 'rgba(255,255,255,.35)', '--cmdk-group-heading-font-size': '10px', '--cmdk-group-heading-letter-spacing': '1px', '--cmdk-group-heading-padding': '6px 14px 4px', fontFamily: 'var(--mono)' }}>
                    {holidays.map(h => (
                      <Cmd key={h.id} label={`✈ ${h.dest}`} onSelect={() => go(() => navigate('holiday'))} />
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
