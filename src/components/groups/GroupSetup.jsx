/**
 * Before you have a group: make one, or type someone's code.
 *
 * Two panels rather than a wizard, because there are exactly two ways in
 * and which one applies is decided before the page loads — you either
 * have a code in a message or you do not.
 */
import { useState } from 'react';

const CRESTS = ['#1a7a4a', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#be185d'];

export default function GroupSetup({ onCreate, onJoin, seats = 20 }) {
  const [name, setName] = useState('');
  const [crest, setCrest] = useState(CRESTS[0]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function run(which, fn) {
    setBusy(which); setError(null);
    try { await fn(); } catch (e) { setError(e.message || 'That did not work.'); }
    setBusy(null);
  }

  return (
    <div className="grp-wrap">
      <div className="grp-card grp-intro">
        <div className="grp-rule"><span>Groups</span><i /></div>
        <p>
          A group is up to {seats} people sharing one weekly score: the sum of how much
          everyone's OVR <strong>grew</strong> since Monday. Not the sum of their ratings — so
          a group cannot win by recruiting one person with a big number, and a member having a
          quiet month costs the group nothing.
        </p>
        <p>
          Each Monday the top three groups in a division go up and the bottom three go down,
          and the three biggest climbers in every group are paid in coins.
        </p>
      </div>

      <div className="grp-setup">
        <div className="grp-card">
          <div className="grp-rule"><span>Start one</span><i /></div>
          <label className="grp-field">
            <span>Group name</span>
            <input value={name} maxLength={32} placeholder="Compound Interest"
                   onChange={e => setName(e.target.value)} />
          </label>
          <div className="grp-field">
            <span>Crest</span>
            <div className="grp-crests">
              {CRESTS.map(c => (
                <button key={c} type="button"
                        className={`grp-crest-pick${crest === c ? ' is-on' : ''}`}
                        style={{ background: c }} aria-label={`Crest colour ${c}`}
                        onClick={() => setCrest(c)} />
              ))}
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm"
                  disabled={busy != null || name.trim().length < 2}
                  onClick={() => run('create', () => onCreate(name.trim(), crest))}>
            {busy === 'create' ? 'Creating…' : 'Create group'}
          </button>
          <p className="grp-foot-note">You start in Iron, the bottom division, like everyone else.</p>
        </div>

        <div className="grp-card">
          <div className="grp-rule"><span>Join one</span><i /></div>
          <label className="grp-field">
            <span>Invite code</span>
            <input value={code} maxLength={9} placeholder="ABCD-2345" spellCheck={false}
                   style={{ letterSpacing: '2px', textTransform: 'uppercase' }}
                   onChange={e => setCode(e.target.value.toUpperCase())} />
          </label>
          <button type="button" className="btn btn-primary btn-sm"
                  disabled={busy != null || code.trim().length < 4}
                  onClick={() => run('join', () => onJoin(code.trim()))}>
            {busy === 'join' ? 'Joining…' : 'Join group'}
          </button>
          <p className="grp-foot-note">Groups are invite-only. Someone inside has the code.</p>
        </div>
      </div>

      {error && <div className="grp-error">{error}</div>}
    </div>
  );
}
