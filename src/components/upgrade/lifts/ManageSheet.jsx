/**
 * Manage lifts: add (name + how it's loaded), rename, reorder,
 * archive / bring back. A lift with sets can only be archived — its
 * history stays; one with no sets can be removed outright.
 */
import { useState } from 'react';
import { Sheet } from '../security/parts';
import Icon from '../../Icon';
import { Field } from './parts';
import { LOAD_TYPES, LOAD_LABEL, bannedRule } from '../../../lib/lifts/lifts';

function Row({ lift, count, first, last, onRename, onMove, onArchive, onDelete }) {
  const [name, setName] = useState(lift.name);
  const [err, setErr] = useState(null);
  const commit = () => {
    if (name === lift.name) return;
    const out = onRename(lift.id, name);
    if (out && out.ok === false) { setErr(out.error); setName(lift.name); } else setErr(null);
  };
  const id = `lf-m-${lift.id}`;
  return (
    <li className={`lf-mrow${lift.archived ? ' is-archived' : ''}`}>
      <div className="lf-mrow-main">
        <label className="sr-only" htmlFor={id}>Name of {lift.name}</label>
        <input id={id} className="lf-mname" value={name} maxLength={60}
               onChange={e => setName(e.target.value)} onBlur={commit}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setName(lift.name); } }} />
        <span className="lf-mmeta">
          {LOAD_LABEL[lift.load]} · {count} {count === 1 ? 'set' : 'sets'}{bannedRule(lift) ? ' · not in programme' : ''}
        </span>
        {err && <span className="lf-field-err" role="alert">{err}</span>}
      </div>
      <div className="lf-mrow-acts">
        {!lift.archived && (
          <>
            <button type="button" className="lf-icon-btn" onClick={() => onMove(lift.id, -1)} disabled={first} aria-label={`Move ${lift.name} up`}><Icon name="chevron-up" size={16} /></button>
            <button type="button" className="lf-icon-btn" onClick={() => onMove(lift.id, 1)} disabled={last} aria-label={`Move ${lift.name} down`}><Icon name="chevron-down" size={16} /></button>
          </>
        )}
        <button type="button" className="sec-btn lf-mbtn" onClick={() => onArchive(lift.id, !lift.archived)}>
          <Icon name={lift.archived ? 'rotate-ccw' : 'archive'} size={14} /> {lift.archived ? 'Bring back' : 'Archive'}
        </button>
        {count === 0 && (
          <button type="button" className="sec-btn is-bad lf-mbtn" onClick={() => onDelete(lift.id)} aria-label={`Remove ${lift.name}`}>
            <Icon name="trash-2" size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

export default function ManageSheet({ lifts, counts, onClose, onAdd, onRename, onMove, onArchive, onDelete }) {
  const [name, setName] = useState('');
  const [load, setLoad] = useState('weight');
  const [err, setErr] = useState(null);
  const active = lifts.filter(l => !l.archived);
  const archived = lifts.filter(l => l.archived);
  const add = e => {
    e.preventDefault();
    const out = onAdd({ name, load });
    if (out && out.ok === false) { setErr(out.error); return; }
    setErr(null); setName(''); setLoad('weight');
  };
  const rows = list => list.map((l, i) => (
    <Row key={l.id} lift={l} count={counts.get(l.id) || 0} first={i === 0} last={i === list.length - 1}
         onRename={onRename} onMove={onMove} onArchive={onArchive} onDelete={onDelete} />
  ));
  return (
    <Sheet title="Manage lifts" eyebrow="// Lifts" onClose={onClose} className="lifts">
      <form className="lf-add" onSubmit={add} noValidate>
        <Field label="Add a lift" id="lf-add-name" error={err} wide>
          <input id="lf-add-name" value={name} maxLength={60} placeholder="e.g. Bench press" onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Loaded as" id="lf-add-load">
          <select id="lf-add-load" value={load} onChange={e => setLoad(e.target.value)}>
            {LOAD_TYPES.map(t => <option key={t} value={t}>{LOAD_LABEL[t]}</option>)}
          </select>
        </Field>
        <button type="submit" className="sec-btn is-primary lf-btn-lg lf-add-btn"><Icon name="plus" size={14} /> Add lift</button>
      </form>
      <section>
        <span className="sec-eyebrow">// In use · {active.length}</span>
        <ul className="lf-mlist">{rows(active)}</ul>
      </section>
      {archived.length > 0 && (
        <section>
          <span className="sec-eyebrow">// Archived · {archived.length}</span>
          <p className="lf-muted lf-mnote">Archived lifts keep every set and PB; they just leave the list and the picker.</p>
          <ul className="lf-mlist">{rows(archived)}</ul>
        </section>
      )}
    </Sheet>
  );
}
