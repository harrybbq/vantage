// STUB — replaced by the backend agent's version at merge
// Same exports as the backend's categories.js: CATEGORIES, DEFAULT_CATEGORY, isCategory, categoryLabel, categorise.
export const CATEGORIES = {
  income: [
    { id: 'app-store', label: 'App Store', hint: 'Apple proceeds' },
    { id: 'google-play', label: 'Google Play', hint: 'Play proceeds' },
    { id: 'web', label: 'Web sales', hint: 'Payments on the website' },
    { id: 'other-income', label: 'Other income', hint: 'Interest, anything else' },
  ],
  expense: [
    { id: 'hosting', label: 'Hosting', hint: '' },
    { id: 'software', label: 'Software & AI', hint: '' },
    { id: 'store-fees', label: 'Store fees', hint: '' },
    { id: 'refunds', label: 'Refunds', hint: '' },
    { id: 'professional', label: 'Professional', hint: '' },
    { id: 'bank', label: 'Bank charges', hint: '' },
    { id: 'equipment', label: 'Equipment', hint: '' },
    { id: 'marketing', label: 'Marketing', hint: '' },
    { id: 'travel', label: 'Travel', hint: '' },
    { id: 'office', label: 'Office', hint: '' },
    { id: 'subscriptions', label: 'Subscriptions', hint: '' },
    { id: 'other', label: 'Other', hint: '' },
  ],
  transfer: [
    { id: 'store-payout', label: 'Store payout', hint: '' },
    { id: 'between-accounts', label: 'Between accounts', hint: '' },
    { id: 'other-transfer', label: 'Other transfer', hint: '' },
  ],
};

export const DEFAULT_CATEGORY = { income: 'other-income', expense: 'other', transfer: 'other-transfer' };

export const isCategory = (kind, id) => !!(CATEGORIES[kind] && CATEGORIES[kind].some(c => c.id === id));

export function categoryLabel(kind, id) {
  const hit = CATEGORIES[kind] && CATEGORIES[kind].find(c => c.id === id);
  if (hit) return hit.label;
  return id ? String(id).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Uncategorised';
}

const RULES = [
  [/\bAPPLE\b.*\bPAYOUT|\bGOOGLE\b.*\bPAYOUT/, 'in', 'transfer', 'store-payout'],
  [/APPLE\.COM\/BILL|APPLE DEVELOPER|GOOGLE\s*\*?\s*PLAY\s*CONSOLE/, 'out', 'expense', 'store-fees'],
  [/SUPABASE|NETLIFY/, 'out', 'expense', 'hosting'],
  [/ANTHROPIC|GITHUB/, 'out', 'expense', 'software'],
  [/\bICO\b/, 'out', 'expense', 'professional'],
  [/\b(TRANSFER|SAVINGS)\b/, null, 'transfer', 'between-accounts'],
];

export function categorise({ description, amountPence, direction } = {}) {
  const dir = direction === 'in' || direction === 'out' ? direction : (amountPence < 0 ? 'out' : 'in');
  const t = String(description || '').toUpperCase();
  for (const [re, d, kind, category] of RULES) if ((!d || d === dir) && re.test(t)) return { kind, category, confidence: 'high' };
  return dir === 'in' ? { kind: 'income', category: 'other-income', confidence: 'low' } : { kind: 'expense', category: 'other', confidence: 'low' };
}
