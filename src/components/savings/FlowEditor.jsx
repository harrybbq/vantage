/**
 * Where the month goes — the editable surface everything else reads.
 *
 * Each row is one recurring amount. Change one and the projection, the
 * pot ETAs and the headline all re-derive from it, which is the point:
 * there is one place money is described and every other number is a
 * consequence of it.
 *
 * Everything the old three-module planner could do is still here, moved
 * into the row rather than dropped:
 *   · drag to reorder, and to move between folders
 *   · folders (groups) with rename, collapse and delete
 *   · a from/until window, for money that starts or stops
 *   · routing into a pot AND/OR a savings account
 *   · a pay day for routed income
 * The row shows the first line always; the rest sits on a second line so
 * a plain "Rent, £1,250, monthly" stays a plain one-line row.
 */
import { useRef, useState } from 'react';
import Icon from '../Icon';
import {
  toMonthly, money, potColor, flowSections, sectionColor, SECTION_PALETTE,
} from '../../lib/savings/derive';

const uid = p => p + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);

/**
 * Pick a colour for a section of the bar.
 *
 * Module scope, like FlowRow, so opening the palette does not rebuild
 * the row that owns it. Offers the pot palette plus "no colour", which
 * hands the section back to its position-derived default rather than
 * leaving it stuck on whatever was last chosen.
 */
function ColorPicker({ value, onPick, label }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="sb-swatch-wrap">
      <button
        type="button" className="sb-swatch" aria-label={label}
        title={label} onClick={() => setOpen(o => !o)}
        style={value ? { background: value } : undefined}
      >{value ? '' : '◌'}</button>
      {open && (
        <span className="sb-swatches" role="listbox">
          {SECTION_PALETTE.map(c => (
            <button
              key={c} type="button" role="option" aria-selected={value === c}
              className={`sb-swatch-opt${value === c ? ' is-on' : ''}`}
              style={{ background: c }} title={c}
              onClick={() => { onPick(c); setOpen(false); }}
            />
          ))}
          <button
            type="button" className="sb-swatch-opt is-none" title="No colour"
            onClick={() => { onPick(null); setOpen(false); }}
          >◌</button>
        </span>
      )}
    </span>
  );
}

/**
 * One row, declared at module scope on purpose.
 *
 * As a function defined inside FlowEditor it was a new component type on
 * every render, so React tore down and rebuilt every row on each
 * keystroke — which took the focus out of the label field after a single
 * character. Same markup, one level up.
 */
function FlowRow({
  it, goals, accounts, denom, dropHint, dragId,
  openMore, setOpenMore, setDropHint,
  updateItem, patchItem, removeItem, reorder,
}) {
    const m = toMonthly(it.amount, it.freq);
    const isIncome = it.kind === 'income';
    const routed = !!(it.goalId || it.accountId);
    const hasWindow = !!(it.from || it.until);
    const more = openMore.has(it.id) || routed || hasWindow;
    const hint = dropHint && dropHint.id === it.id ? (dropHint.before ? ' drop-before' : ' drop-after') : '';
    const potIdx = goals.findIndex(g => g.id === it.goalId);

    return (
      <div
        className={`sb-row is-${it.kind}${routed ? ' is-routed' : ''}${hint}`}
        style={{
          ...(potIdx >= 0 ? { '--pot': potColor(goals[potIdx], potIdx) } : null),
          ...(it.color ? { '--pot': it.color } : null),
        }}
        onDragOver={e => {
          if (!dragId.current || dragId.current === it.id) return;
          e.preventDefault(); e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setDropHint({ id: it.id, before: e.clientY < r.top + r.height / 2 });
        }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation();
          if (dragId.current && dragId.current !== it.id) {
            const r = e.currentTarget.getBoundingClientRect();
            reorder(dragId.current, it.id, e.clientY < r.top + r.height / 2, it.groupId ?? null);
          }
          setDropHint(null); dragId.current = null;
        }}
      >
        <div className="sb-row-main">
          <span
            className="sb-row-grip" draggable title="Drag to reorder or move into a folder"
            onDragStart={e => {
              dragId.current = it.id;
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', it.id); } catch { /* Safari */ }
              const row = e.currentTarget.closest('.sb-row');
              if (row) e.dataTransfer.setDragImage(row, 24, 18);
            }}
            onDragEnd={() => { dragId.current = null; setDropHint(null); }}
          ><Icon name="grip-vertical" size={14} /></span>

          <button
            type="button" className="sb-row-kind"
            onClick={() => updateItem(it.id, 'kind', isIncome ? 'expense' : 'income')}
            title="Income or expense"
            aria-label={isIncome ? 'Income — switch to expense' : 'Expense — switch to income'}
          ><Icon name={isIncome ? 'plus' : 'minus'} size={13} /></button>

          <input
            className="sb-row-label"
            placeholder={isIncome ? 'e.g. Salary' : routed ? 'e.g. Wedding order' : 'e.g. Rent'}
            value={it.label || ''}
            onChange={e => updateItem(it.id, 'label', e.target.value)}
          />

          <span className="sb-row-amt">
            <i>£</i>
            <input
              type="number" inputMode="decimal" placeholder="0"
              value={it.amount ?? ''}
              onChange={e => updateItem(it.id, 'amount', e.target.value)}
            />
          </span>

          <select className="sb-row-freq" value={it.freq || 'month'}
                  onChange={e => updateItem(it.id, 'freq', e.target.value)} aria-label="How often">
            <option value="week">/wk</option>
            <option value="month">/mo</option>
            <option value="year">/yr</option>
          </select>

          <span className={`sb-row-perm${isIncome ? ' is-in' : routed ? ' is-routed' : ''}`}>
            {isIncome ? '+' : '−'}{money(m)}
          </span>

          <button type="button" className="sb-row-del" onClick={() => removeItem(it.id)} aria-label="Remove row">
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="sb-row-sub">
          {more ? (
            <>
              {(goals.length > 0 || accounts.length > 0) && (
                <span className="sb-row-into">
                  <span className="sb-row-arrow">↳ into</span>
                  {goals.length > 0 && (
                    <select
                      value={it.goalId || ''} aria-label="Save into pot"
                      onChange={e => {
                        const goalId = e.target.value || null;
                        const g = goals.find(x => x.id === goalId);
                        patchItem(it.id, { goalId, label: (!it.label && g) ? g.name : it.label });
                      }}
                    >
                      <option value="">pot: none</option>
                      {goals.map(g => <option key={g.id} value={g.id}>{g.icon || '💰'} {g.name}</option>)}
                    </select>
                  )}
                  {accounts.length > 0 && (
                    <select
                      value={it.accountId || ''} aria-label="Save into account"
                      onChange={e => {
                        const accountId = e.target.value || null;
                        const a = accounts.find(x => x.id === accountId);
                        patchItem(it.id, { accountId, label: (!it.label && a) ? a.name : it.label });
                      }}
                    >
                      <option value="">account: none</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name || 'Account'}</option>)}
                    </select>
                  )}
                  {isIncome && routed && (
                    <label className="sb-row-payday">on day
                      <select value={it.payDay || 1}
                              onChange={e => updateItem(it.id, 'payDay', parseInt(e.target.value, 10))}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(dd => <option key={dd} value={dd}>{dd}</option>)}
                      </select>
                    </label>
                  )}
                </span>
              )}

              <span className="sb-row-when">
                <span className="sb-row-arrow">⏱</span>
                <label>from<input type="month" value={it.from || ''}
                                  onChange={e => updateItem(it.id, 'from', e.target.value || null)} /></label>
                <label>until<input type="month" value={it.until || ''}
                                   onChange={e => updateItem(it.id, 'until', e.target.value || null)} /></label>
              </span>

              <button
                type="button" className="sb-row-less"
                onClick={() => {
                  patchItem(it.id, { goalId: null, accountId: null, from: null, until: null });
                  setOpenMore(prev => { const n = new Set(prev); n.delete(it.id); return n; });
                }}
              >clear</button>
            </>
          ) : (
            <button type="button" className="sb-row-more"
                    onClick={() => setOpenMore(prev => new Set(prev).add(it.id))}>
              + save into / dates
            </button>
          )}

          <span className="sb-row-spacer" />
          {/* Only a loose expense is a band of its own — one inside a
              folder is drawn as part of that folder's band, and giving it
              a colour here would promise something the bar cannot keep. */}
          {it.kind === 'expense' && !it.groupId && (
            <ColorPicker
              value={it.color || null}
              label={`Colour for ${it.label || 'this row'}`}
              onPick={c => updateItem(it.id, 'color', c)}
            />
          )}
          <span className="sb-row-tag">
            {it.freq === 'year' ? 'yearly' : it.freq === 'week' ? 'weekly' : routed ? 'routed' : it.kind}
            {hasWindow ? ' · timed' : ''}
          </span>
          <span className="sb-row-share" aria-hidden="true">
            <i style={{ width: `${Math.min(100, m / denom * 100)}%` }} />
          </span>
        </div>
      </div>
    );
  }

export default function FlowEditor({ S, update, flow }) {
  const proj = S.projection || {};
  const items = proj.items || [];
  const groups = proj.groups || [];
  const horizon = proj.horizon || 12;
  const goals = S.savings || [];
  const accounts = S.savingsAccounts || [];

  const dragId = useRef(null);
  const [dropHint, setDropHint] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openMore, setOpenMore] = useState(() => new Set());
  const [trash, setTrash] = useState(null);

  function setProj(patch) {
    update(prev => ({
      ...prev,
      projection: { items, groups, horizon, ...prev.projection, ...patch },
    }));
  }
  const addItem = (kind, groupId = null, routed = false) => {
    const free = goals.find(g => !items.some(it => it.goalId === g.id));
    const id = uid('p');
    setProj({
      items: [...items, {
        id, kind, label: '', amount: '', freq: 'month', groupId,
        goalId: routed ? (free ? free.id : (goals[0] && goals[0].id) || null) : null,
      }],
    });
    if (routed) setOpenMore(prev => new Set(prev).add(id));
  };
  const updateItem = (id, key, val) => setProj({ items: items.map(it => it.id === id ? { ...it, [key]: val } : it) });
  const patchItem = (id, patch) => setProj({ items: items.map(it => it.id === id ? { ...it, ...patch } : it) });

  function removeItem(id) {
    const at = items.findIndex(i => i.id === id);
    const row = items[at];
    if (!row) return;
    setTrash({ row, at });
    setProj({ items: items.filter(i => i.id !== id) });
  }
  function undoRemove() {
    if (!trash) return;
    const arr = items.slice();
    arr.splice(Math.min(trash.at, arr.length), 0, trash.row);
    setProj({ items: arr });
    setTrash(null);
  }

  // ── Drag: reorder, and inherit the target row's folder ──
  function reorder(dragVal, targetId, before, newGroupId) {
    if (!dragVal || dragVal === targetId) return;
    const arr = items.slice();
    const from = arr.findIndex(i => i.id === dragVal);
    if (from < 0) return;
    const [moved] = arr.splice(from, 1);
    moved.groupId = newGroupId ?? null;
    const to = arr.findIndex(i => i.id === targetId);
    if (to < 0) arr.push(moved);
    else arr.splice(before ? to : to + 1, 0, moved);
    setProj({ items: arr });
  }
  /* Dropped onto a folder rather than onto a row: append after that
     folder's last item, so the drop lands somewhere predictable. */
  function moveToGroup(dragVal, groupId) {
    if (!dragVal) return;
    const arr = items.slice();
    const from = arr.findIndex(i => i.id === dragVal);
    if (from < 0) return;
    const [moved] = arr.splice(from, 1);
    moved.groupId = groupId;
    let last = -1;
    arr.forEach((it, idx) => { if ((it.groupId || null) === (groupId || null)) last = idx; });
    if (last >= 0) arr.splice(last + 1, 0, moved); else arr.push(moved);
    setProj({ items: arr });
  }

  const addGroup = () => setProj({ groups: [...groups, { id: uid('g'), name: 'New folder' }] });
  const renameGroup = (id, name) => setProj({ groups: groups.map(g => g.id === id ? { ...g, name } : g) });
  const removeGroup = id => setProj({
    groups: groups.filter(g => g.id !== id),
    items: items.map(it => it.groupId === id ? { ...it, groupId: null } : it),
  });
  const toggleCollapse = id => setCollapsed(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const denom = Math.max(1, flow.income);

  const loose = items.filter(i => !i.groupId);
  /* One band per SECTION, not per row: a folder called Subscriptions is
     one band called Subscriptions, sized by everything in it. Eight
     slivers told you nothing the list below did not already say. */
  const sections = flowSections(items, groups);
  const leftOver = Math.max(0, flow.net) / denom * 100;

  return (
    <div className="sb-panel sb-flow">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-panel-title">Where the month goes</h3>
          <p className="sb-panel-sub">
            {money(flow.income)} in, {money(flow.spend)} out, {money(flow.net)} left over.
            Edit a row and everything above re-reads it.
          </p>
        </div>
        <div className="sb-flow-rate">
          <div className="sb-eyebrow">Saved rate</div>
          <div className="sb-flow-rate-val">{Math.round(flow.rate * 100)}%</div>
        </div>
      </div>

      <div className="sb-segments">
        {sections.map((sec, i) => (
          <div
            key={sec.id}
            className={`sb-segment${sec.kind === 'group' ? ' is-group' : ''}`}
            style={{ flexBasis: `${sec.share * 100}%`, background: sectionColor(sec, i) }}
            title={`${sec.label} — ${money(sec.amount)}/mo, ${Math.round(sec.share * 100)}% of income`}
          >
            <span className="sb-segment-tag">{sec.label}</span>
          </div>
        ))}
        <div className="sb-segment is-left" style={{ flexBasis: `${leftOver}%` }} title={`Left over — ${money(flow.net)}/mo`}>
          <span className="sb-segment-tag">left over</span>
        </div>
      </div>

      {/* The bands are named, so the bar needs a key — a colour with no
          word beside it is a decoration, not a reading. */}
      <div className="sb-legend-rows">
        {sections.map((sec, i) => (
          <span key={sec.id} className="sb-legend-row">
            <i style={{ background: sectionColor(sec, i) }} />
            {sec.label}
            {sec.kind === 'group' && <em>{sec.count}</em>}
            <b>{money(sec.amount)}</b>
          </span>
        ))}
      </div>

      <div
        className="sb-rows"
        onDragOver={e => { if (dragId.current) e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); if (dragId.current) moveToGroup(dragId.current, null); dragId.current = null; setDropHint(null); }}
      >
        {loose.map(it => (
          <FlowRow key={it.id} it={it} goals={goals} accounts={accounts} denom={denom}
            dropHint={dropHint} dragId={dragId} openMore={openMore}
            setOpenMore={setOpenMore} setDropHint={setDropHint}
            updateItem={updateItem} patchItem={patchItem}
            removeItem={removeItem} reorder={reorder} />
        ))}

        {groups.map(g => {
          const kids = items.filter(i => i.groupId === g.id);
          const total = kids.reduce((s, i) => s + (i.kind === 'income' ? 1 : -1) * toMonthly(i.amount, i.freq), 0);
          const isShut = collapsed.has(g.id);
          return (
            <div
              key={g.id} className="sb-group"
              onDragOver={e => { if (dragId.current) e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragId.current) moveToGroup(dragId.current, g.id); dragId.current = null; setDropHint(null); }}
            >
              <div className="sb-group-head">
                <button type="button" className="sb-group-toggle" onClick={() => toggleCollapse(g.id)}
                        aria-expanded={!isShut} aria-label={isShut ? 'Expand folder' : 'Collapse folder'}>
                  <Icon name={isShut ? 'chevron-right' : 'chevron-down'} size={14} />
                </button>
                <input className="sb-group-name" value={g.name}
                       onChange={e => renameGroup(g.id, e.target.value)} aria-label="Folder name" />
                <ColorPicker
                  value={g.color || null}
                  label={`Colour for ${g.name || 'this folder'}`}
                  onPick={c => setProj({ groups: groups.map(x => x.id === g.id ? { ...x, color: c } : x) })}
                />
                <span className="sb-group-count">{kids.length}</span>
                <span className={`sb-group-total${total >= 0 ? ' is-in' : ''}`}>
                  {total >= 0 ? '+' : '−'}{money(Math.abs(total))}
                </span>
                <button type="button" className="sb-group-add" onClick={() => addItem('expense', g.id)}
                        aria-label="Add a row to this folder"><Icon name="plus" size={13} /></button>
                <button type="button" className="sb-group-del" onClick={() => removeGroup(g.id)}
                        aria-label="Delete folder — its rows come out loose"><Icon name="x" size={13} /></button>
              </div>
              {!isShut && (
                <div className="sb-group-rows">
                  {kids.length
                    ? kids.map(it => (
                      <FlowRow key={it.id} it={it} goals={goals} accounts={accounts} denom={denom}
                    dropHint={dropHint} dragId={dragId} openMore={openMore}
                    setOpenMore={setOpenMore} setDropHint={setDropHint}
                    updateItem={updateItem} patchItem={patchItem}
                    removeItem={removeItem} reorder={reorder} />
                    ))
                    : <div className="sb-group-empty">Drag rows in, or add one.</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sb-flow-actions">
        <button type="button" className="sb-add is-in" onClick={() => addItem('income')}>+ Income</button>
        <button type="button" className="sb-add" onClick={() => addItem('expense')}>+ Expense</button>
        <button type="button" className="sb-add is-gold" onClick={() => addItem('expense', null, true)}>+ Into a pot</button>
        <button type="button" className="sb-add" onClick={addGroup}>+ Folder</button>
        <span className="sb-row-spacer" />
        {trash && <button type="button" className="sb-undo" onClick={undoRemove}>↺ Undo remove</button>}
      </div>

      <div className="sb-flow-foot">
        <span className="sb-eyebrow">Routed into pots</span>
        <span className="sb-flow-foot-line" />
        <span className="sb-flow-foot-val">{money(flow.routed)}/mo</span>
      </div>
    </div>
  );
}
