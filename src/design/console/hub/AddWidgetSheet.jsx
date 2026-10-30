/**
 * Add a widget — the console picker.
 *
 * Built from the existing catalogue data, not a fork of it: classic
 * widget names and icons from MobileWidget's WIDGET_META, the cards from
 * PRIMES (and their own starting layouts), readiness from
 * lib/widgets/readiness.js, superseded types hidden as the classic
 * pickers hide them, Pro widget types as the classic pickers lock them.
 * Its ONLY write is a new S.hubGrid item (via onAdd) — never
 * S.hubWidgets or S.mobileWidgets.
 *
 * Nothing that would only render an empty state can be added: such a row
 * is shown dimmed with what unlocks it, and tapping it goes to the page
 * that fills it in (the classic rule).
 */
import { useState } from 'react';
import Icon from '../../../components/Icon';
import { Sheet } from '../ui';
import { widgetReadiness } from '../../../lib/widgets/readiness';
import { isSuperseded } from '../../../lib/hub/primeBlocks';
import { visiblePresets } from '../../../lib/savings/visibleAccounts';
import { useShowAccounts } from '../../../hooks/useShowAccounts';
import { CONSOLE_META, PRIMES, PRIME_IDS, primeType, metaOf, classicPickerTypes, isProWidget } from './catalogue';
import { sizesFor, SIZE_LABEL, SIZE_DIMS } from './grid';
import { hasUpcoming } from './useHubGrid';

const CONSOLE_ORDER = ['today', 'league', 'friends', 'upnext', 'coins'];

function consoleReady(type, S) {
  if (type === 'today') return (S.trackers || []).length ? { ready: true } : { ready: false, need: 'Add a tracker first', where: 'track' };
  if (type === 'upnext') return hasUpcoming(S) ? { ready: true } : { ready: false, need: 'Plan a trip or add an event first', where: 'track' };
  return { ready: true };
}

function Row({ icon, title, sub, size, state, onClick, pro }) {
  return (
    <li>
      <button type="button" className={`cx-hub-pick${state === 'dim' ? ' is-dim' : ''}`} onClick={onClick} disabled={state === 'added'}>
        <span className="cx-hub-pick-ic"><Icon name={icon || 'square'} size={18} strokeWidth={1.75} /></span>
        <span className="cx-hub-pick-txt">
          <span className="cx-hub-pick-t">{title}{pro && <span className="cx-hub-pro">Pro</span>}</span>
          <span className="cx-hub-pick-s">{sub}</span>
        </span>
        {size && <span className="cx-hub-pick-sz cx-muted">{SIZE_LABEL[size]} <span className="cx-num">{SIZE_DIMS[size]}</span></span>}
      </button>
    </li>
  );
}

function PrimeRow({ k, count, onAdd }) {
  const P = PRIMES[k];
  // Savings › Accounts is owner-only: its block leaves the presets too.
  const presets = visiblePresets(k, P.presets, useShowAccounts());
  const [preset, setPreset] = useState(0);
  return (
    <li className="cx-hub-prime">
      <div className="cx-hub-pick is-static">
        <span className="cx-hub-pick-ic"><Icon name={P.icon} size={18} strokeWidth={1.75} /></span>
        <span className="cx-hub-pick-txt">
          <span className="cx-hub-pick-t">{P.name} card{count > 0 && <span className="cx-muted cx-hub-pick-n"> · {count} on your hub</span>}</span>
          <span className="cx-hub-pick-s">{presets[preset][1].map(id => P.blocks[id]?.name).filter(Boolean).join(', ')}</span>
        </span>
        <button type="button" className="cx-btn" onClick={() => onAdd({ type: primeType(k), blocks: presets[preset][1] })}>Add</button>
      </div>
      <div className="cx-hub-prime-presets" role="radiogroup" aria-label={`${P.name} card starting layout`}>
        {presets.map(([name], i) => (
          <button key={name} type="button" role="radio" aria-checked={i === preset} className="cx-chip" onClick={() => setPreset(i)}>{name}</button>
        ))}
      </div>
    </li>
  );
}

export default function AddWidgetSheet({ S, items, hasPro, isOwner, presetIds, onAdd, onClose, navigate, onOpenPaywall }) {
  const have = new Set(items.map(i => i.type));
  const go = where => { onClose(); if (where) navigate?.(where); };
  const add = spec => { onAdd(spec); onClose(); };
  const classic = classicPickerTypes({ isOwner }).filter(t => !isSuperseded(t));
  return (
    <Sheet title="Add a widget" onClose={onClose} className="cx-hub-add" testId="cx-hub-add-sheet" width={520}>
      <p className="cx-hub-add-lede">Three sizes: <b>Small</b> 1×1, <b>Medium</b> 2×1 and <b>Large</b> 2×2. Change a widget’s size from its ⋯ menu.</p>

      <h3 className="cx-hub-add-h">Hub</h3>
      <ul className="cx-hub-picks">
        {CONSOLE_ORDER.map(type => {
          const m = CONSOLE_META[type];
          const added = have.has(type);
          const r = consoleReady(type, S);
          return (
            <Row key={type} icon={m.icon} title={m.title}
                 sub={added ? 'Already on your hub' : r.ready ? m.blurb : r.need}
                 size={sizesFor(type).def}
                 state={added ? 'added' : r.ready ? '' : 'dim'}
                 onClick={() => (r.ready ? add(type) : go(r.where))} />
          );
        })}
      </ul>

      <h3 className="cx-hub-add-h">Cards</h3>
      <p className="cx-hub-add-sub">One card per section. Pick a starting layout; change its blocks later from the ⋯ menu.</p>
      <ul className="cx-hub-picks">
        {PRIME_IDS.map(k => <PrimeRow key={k} k={k} count={items.filter(i => i.type === primeType(k)).length} onAdd={add} />)}
      </ul>

      <h3 className="cx-hub-add-h">Widgets</h3>
      <ul className="cx-hub-picks">
        {classic.map(type => {
          const t = sizesFor(type, { presetIds });
          if (!t) return null;
          const m = metaOf({ type });
          const added = have.has(type);
          const { ready, need, where } = widgetReadiness(type, S);
          const locked = isProWidget(type) && !hasPro;
          return (
            <Row key={type} icon={m.icon} title={m.title} pro={isProWidget(type)}
                 sub={added ? 'Already on your hub' : locked ? 'Pro: tap to upgrade' : ready ? 'Available now' : need}
                 size={t.def}
                 state={added ? 'added' : (!ready || locked) ? 'dim' : ''}
                 onClick={() => {
                   if (locked) { onClose(); onOpenPaywall?.(presetIds.has(type) ? 'ourApps' : 'widgets'); return; }
                   if (!ready) { go(where); return; }
                   add(type);
                 }} />
          );
        })}
      </ul>
    </Sheet>
  );
}
