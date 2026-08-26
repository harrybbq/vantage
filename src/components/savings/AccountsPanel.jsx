/**
 * The accounts behind the savings line.
 *
 * Each one is a balance and a rate; the inflow is not typed here but
 * read from the cash-flow rows routed into it, so an account and the
 * money going into it can never drift apart.
 *
 * Balances are entered by hand. Vantage has no bank connection and
 * gathers no transaction history — nothing on this panel is fetched
 * from anywhere.
 */
import Icon from '../Icon';
import { blendedApy, routedToAccount, money, POT_PALETTE, potColor } from '../../lib/savings/derive';

const uid = p => p + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);

export default function AccountsPanel({ S, update, sav, horizon, items }) {
  const accounts = S.savingsAccounts || [];
  const goals = S.savings || [];
  const total = accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
  const blended = blendedApy(accounts);
  const future = sav[sav.length - 1] || 0;

  const setAccounts = fn => update(prev => ({ ...prev, savingsAccounts: fn(prev.savingsAccounts || []) }));
  const addAccount = () => setAccounts(a => [...a, { id: uid('a'), name: '', balance: '', apy: '' }]);
  const patch = (id, key, val) => setAccounts(a => a.map(x => x.id === id ? { ...x, [key]: val } : x));
  const remove = id => setAccounts(a => a.filter(x => x.id !== id));

  return (
    <div className="sb-panel sb-accounts">
      <div className="sb-panel-head">
        <div>
          <h3 className="sb-panel-title">Accounts</h3>
          <p className="sb-panel-sub">Balances and rates behind the savings line. Entered by hand — nothing is fetched from a bank.</p>
        </div>
        <div className="sb-acc-blended">
          <div className="sb-eyebrow">Blended</div>
          <div className="sb-acc-blended-val">{blended.toFixed(2)}%</div>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="sb-acc-split" aria-hidden="true">
          {accounts.map((a, i) => (
            <div
              key={a.id}
              style={{
                width: `${total > 0 ? (parseFloat(a.balance) || 0) / total * 100 : 0}%`,
                background: POT_PALETTE[i % POT_PALETTE.length],
              }}
            />
          ))}
        </div>
      )}

      <div className="sb-acc-list">
        {accounts.map((a, i) => {
          const bal = parseFloat(a.balance) || 0;
          const apy = parseFloat(a.apy) || 0;
          const inflow = routedToAccount(items, a.id);
          const potIdx = goals.findIndex(g => g.id === a.goalId);
          const pot = potIdx >= 0 ? goals[potIdx] : null;
          /* An account that belongs to a pot wears the pot's colour, so
             the split bar above reads as "this much of my savings is the
             house" rather than as three arbitrary stripes. */
          const tint = pot ? potColor(pot, potIdx) : POT_PALETTE[i % POT_PALETTE.length];
          return (
            <div key={a.id} className={`sb-acc${pot ? ' is-forpot' : ''}`} style={{ '--pot': tint }}>
              <div className="sb-acc-top">
                <span className="sb-acc-dot" aria-hidden="true" />
                <input
                  className="sb-acc-name" placeholder="e.g. Instant saver"
                  value={a.name || ''} onChange={e => patch(a.id, 'name', e.target.value)}
                />
                <span className="sb-acc-field">
                  <i>£</i>
                  <input
                    type="number" inputMode="decimal" placeholder="0" aria-label="Balance"
                    value={a.balance ?? ''} onChange={e => patch(a.id, 'balance', e.target.value)}
                  />
                </span>
                <span className="sb-acc-field is-apy">
                  <input
                    type="number" inputMode="decimal" step="0.1" placeholder="0" aria-label="Interest rate"
                    value={a.apy ?? ''} onChange={e => patch(a.id, 'apy', e.target.value)}
                  />
                  <i>% APY</i>
                </span>
                <button type="button" className="sb-acc-del" onClick={() => remove(a.id)} aria-label="Remove account">
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="sb-acc-bar">
                <div style={{ width: `${total > 0 ? bal / total * 100 : 0}%` }} />
              </div>
              <div className="sb-acc-foot">
                <span className="sb-acc-apy">{apy.toFixed(1)}% APY</span>
                <span className="sb-acc-sep" />
                <span>{inflow > 0 ? `+${money(inflow)}/mo in` : 'no inflow routed'}</span>
                <span className="sb-row-spacer" />
                <span>+{money(bal * apy / 100)} interest/yr</span>
              </div>

              {/* Saying an account is FOR a pot is what lets money routed
                  here count toward that pot's rate and date, without the
                  row ever naming the pot. One pot, several accounts. */}
              {goals.length > 0 && (
                <label className="sb-acc-forpot">
                  <span className="sb-row-arrow">↳ for pot</span>
                  <select
                    value={a.goalId || ''}
                    onChange={e => patch(a.id, 'goalId', e.target.value || null)}
                    aria-label={`Which pot ${a.name || 'this account'} is for`}
                  >
                    <option value="">none — general savings</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.icon || '💰'} {g.name}</option>)}
                  </select>
                  {pot && inflow > 0 && (
                    <span className="sb-acc-feeds">feeds {pot.name} {money(inflow)}/mo</span>
                  )}
                </label>
              )}
            </div>
          );
        })}
        {!accounts.length && (
          <div className="sb-none">
            No accounts yet. Add one and the projection gets a savings line that compounds.
          </div>
        )}
      </div>

      <div className="sb-acc-summary">
        <div>
          <div className="sb-eyebrow">Total now</div>
          <div className="sb-acc-summary-val">{money(total)}</div>
        </div>
        <div>
          <div className="sb-eyebrow">In {horizon / 12}y</div>
          <div className="sb-acc-summary-val is-gold">{money(future)}</div>
        </div>
        <span className="sb-row-spacer" />
        <button type="button" className="sb-add is-gold" onClick={addAccount}>+ Account</button>
      </div>
    </div>
  );
}
