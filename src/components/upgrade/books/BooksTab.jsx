/**
 * Upgrade → Books. Owner-only bookkeeping for Vantage: money in, money
 * out, what's left — and a clean CSV for whoever does the filing.
 *
 * Scope (owner, Oct 2026): plain income and costs only. No company has
 * been set up, so there is no corporation tax, dividends, year end or
 * statutory deadlines here; those arrive if and when there is a company.
 * Books produces figures and an export; it files nothing anywhere.
 *
 * ── The gate is on the server ────────────────────────────────────────
 * Upgrade is owner-gated by useIsOwner — a UI gate and nothing more.
 * Every figure comes from /.netlify/functions/books, which verifies the
 * JWT's email against the owner and answers anyone else exactly as it
 * answers a bad token. Books' tables are server-only (RLS on, no
 * policies). Nothing here goes in the user's state `S`.
 *
 * Sub-tabs, the Security console's pattern (remembered per browser):
 *   Overview  period figures, monthly chart, costs by category, RevenueCat
 *   Ledger    search · filter · add/edit · soft delete with Undo · Export CSV
 *   Import    CSV → detected format → preview (add / duplicates / invalid) → commit
 *   Bills     recurring costs, "Post due bills"
 *
 * Theme: the console's furniture (security.css — solid --upg-solid cards,
 * "//" eyebrows, fixed status colours) plus books.css, in cream-pro and
 * dark-os. Money is tabular mono throughout.
 */
import { useCallback, useState } from 'react';
import WidgetBoundary from '../../WidgetBoundary';
import OverviewPanel from './OverviewPanel';
import LedgerPanel from './LedgerPanel';
import ImportPanel from './ImportPanel';
import BillsPanel from './BillsPanel';
import '../security/security.css';
import './books.css';

export const SUBTABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'import', label: 'Import' },
  { id: 'bills', label: 'Bills' },
];
const KEY = 'vantage.upgrade.books.tab';
const valid = id => SUBTABS.some(t => t.id === id);

function readTab() {
  try {
    const v = window.localStorage.getItem(KEY);
    return valid(v) ? v : 'overview';
  } catch { return 'overview'; }
}

export default function BooksTab() {
  const [tab, setTabState] = useState(readTab);
  const go = useCallback(id => {
    if (!valid(id)) return;
    setTabState(id);
    try { window.localStorage.setItem(KEY, id); } catch { /* private mode */ }
  }, []);

  return (
    <div className="upg-pane sec books">
      <div className="settings-tabs career-tabs sec-tabs" role="tablist" aria-label="Books sections">
        {SUBTABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                  className={'settings-tab' + (tab === t.id ? ' settings-tab-active' : '')}
                  onClick={() => go(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <WidgetBoundary key={tab} name={`books:${tab}`} variant="section">
        {tab === 'overview' && <OverviewPanel go={go} />}
        {tab === 'ledger' && <LedgerPanel />}
        {tab === 'import' && <ImportPanel go={go} />}
        {tab === 'bills' && <BillsPanel />}
      </WidgetBoundary>
    </div>
  );
}
