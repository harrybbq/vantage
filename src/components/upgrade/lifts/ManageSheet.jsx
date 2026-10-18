/**
 * Manage lifts: add (name + how it's loaded), rename, reorder,
 * archive / bring back. A lift with sets can only be archived — its
 * history stays; one with no sets can be removed outright.
 *
 * Each lift says whether it is compared per gym (a machine: DXC's leg
 * press isn't Greenock's) or across gyms (a dumbbell is a dumbbell); the
 * default comes from the name and a tap overrides it.
 *
 * Gyms: add, rename, archive / bring back. A gym with sets can only be
 * archived (its sets keep pointing at it); an unused one can be removed.
 */
import { useState } from 'react';
import { Sheet } from '../security/parts';
import Icon from '../../Icon';
import { Field } from './parts';
import { LOAD_TYPES, LOAD_LABEL, bannedRule, perGymOf, perGymByName } from '../../../lib/lifts/lifts';

function PerGymToggle({ lift, onPerGym }) {
  const on = perGymOf(lift);
  return (
    <button type="button" className={`sec-btn lf-mbtn lf-pergym${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onPerGym(lift.id, !on)}
            aria-label={`${lift.name}: ${on ? 'compared per gym' : 'compared across gyms'} — tap to change`}>
      <Icon name={on ? 'locate-fixed' : 'link'} size={14} /> {on ? 'Per gym' : 'All gyms'}
    </button>
  );
}

function Row({ lift, count, first, last, onRename, onMove, onArchive, onDelete, onPerGym }) {
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
        {onPerGym && <PerGymToggle lift={lift} onPerGym={onPerGym} />}
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

function GymRow({ gym, used, onRename, onArchive, onDelete }) {
  const [name, setName] = useState(gym.name);
  const [err, setErr] = useState(null);
  const commit = () => {
    if (name === gym.name) return;
    const out = onRename(gym.id, name);
    if (out && out.ok === false) { setErr(out.error); setName(gym.name); } else setErr(null);
  };
  const act = (fn, ...a) => { const out = fn(...a); setErr(out && out.ok === false ? out.error : null); };
  const id = `lf-g-${gym.id}`;
  return (
    <li className={`lf-mrow${gym.archived ? ' is-archived' : ''}`} data-testid="lf-gym-row">
      <div className="lf-mrow-main">
        <label className="sr-only" htmlFor={id}>Name of the gym {gym.name}</label>
        <input id={id} className="lf-mname" value={name} maxLength={30}
               onChange={e => setName(e.target.value)} onBlur={commit}
               onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setName(gym.name); }} />
        <span className="lf-mmeta">{used} {used === 1 ? 'set' : 'sets'}{gym.archived ? ' · archived' : ''}</span>
        {err && <span className="lf-field-err" role="alert">{err}</span>}
      </div>
      <div className="lf-mrow-acts">
        <button type="button" className="sec-btn lf-mbtn" onClick={() => act(onArchive, gym.id, !gym.archived)}>
          <Icon name={gym.archived ? 'rotate-ccw' : 'archive'} size={14} /> {gym.archived ? 'Bring back' : 'Archive'}
        </button>
        {used === 0 && (
          <button type="button" className="sec-btn is-bad lf-mbtn" onClick={() => act(onDelete, gym.id)} aria-label={`Remove the gym ${gym.name}`}>
            <Icon name="trash-2" size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

export default function ManageSheet({
  lifts, counts, onClose, onAdd, onRename, onMove, onArchive, onDelete, onPerGym,
  gyms = [], gymCounts = new Map(), onAddGym, onRenameGym, onArchiveGym, onDeleteGym,
}) {
  const [name, setName] = useState('');
  const [load, setLoad] = useState('weight');
  const [machine, setMachine] = useState(null);     // null = follow the name
  const [err, setErr] = useState(null);
  const [gymName, setGymName] = useState('');
  const [gymErr, setGymErr] = useState(null);
  const active = lifts.filter(l => !l.archived);
  const archived = lifts.filter(l => l.archived);
  const perGymNow = machine == null ? perGymByName(name) : machine;
  const add = e => {
    e.preventDefault();
    const out = onAdd({ name, load, ...(machine == null ? {} : { perGym: machine }) });
    if (out && out.ok === false) { setErr(out.error); return; }
    setErr(null); setName(''); setLoad('weight'); setMachine(null);
  };
  const addGym = e => {
    e.preventDefault();
    const out = onAddGym(gymName);
    if (out && out.ok === false) { setGymErr(out.error); return; }
    setGymErr(null); setGymName('');
  };
  const rows = list => list.map((l, i) => (
    <Row key={l.id} lift={l} count={counts.get(l.id) || 0} first={i === 0} last={i === list.length - 1}
         onRename={onRename} onMove={onMove} onArchive={onArchive} onDelete={onDelete} onPerGym={onPerGym} />
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
        <label className="lf-check" htmlFor="lf-add-machine">
          <input id="lf-add-machine" type="checkbox" checked={perGymNow} onChange={e => setMachine(e.target.checked)} />
          <span>Machine — compare per gym{machine == null && name.trim() ? ' (from the name)' : ''}</span>
        </label>
        <button type="submit" className="sec-btn is-primary lf-btn-lg lf-add-btn"><Icon name="plus" size={14} /> Add lift</button>
      </form>
      <section>
        <span className="sec-eyebrow">// In use · {active.length}</span>
        <p className="lf-muted lf-mnote">“Per gym” compares a machine only with itself — DXC’s stack with DXC’s, Greenock’s with Greenock’s. “All gyms” keeps one record everywhere.</p>
        <ul className="lf-mlist">{rows(active)}</ul>
      </section>
      {archived.length > 0 && (
        <section>
          <span className="sec-eyebrow">// Archived · {archived.length}</span>
          <p className="lf-muted lf-mnote">Archived lifts keep every set and PB; they just leave the list and the picker.</p>
          <ul className="lf-mlist">{rows(archived)}</ul>
        </section>
      )}
      {onAddGym && (
        <section className="lf-gyms" aria-labelledby="lf-gyms-h">
          <span className="sec-eyebrow" id="lf-gyms-h">// Gyms · {gyms.filter(g => !g.archived).length}</span>
          <p className="lf-muted lf-mnote">A gym with sets can be archived, not removed — its sets keep their gym.</p>
          <ul className="lf-mlist">
            {gyms.map(g => (
              <GymRow key={g.id} gym={g} used={gymCounts.get(g.id) || 0} onRename={onRenameGym} onArchive={onArchiveGym} onDelete={onDeleteGym} />
            ))}
          </ul>
          <form className="lf-add lf-add-gym" onSubmit={addGym} noValidate>
            <Field label="Add a gym" id="lf-add-gym" error={gymErr} wide>
              <input id="lf-add-gym" value={gymName} maxLength={30} placeholder="e.g. Hotel gym" onChange={e => setGymName(e.target.value)} />
            </Field>
            <button type="submit" className="sec-btn lf-btn-lg lf-add-btn"><Icon name="plus" size={14} /> Add gym</button>
          </form>
        </section>
      )}
    </Sheet>
  );
}
