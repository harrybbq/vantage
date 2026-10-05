/**
 * Books categories and the bank-line auto-categoriser.
 *
 *   CATEGORIES = { income:[{id,label,hint}], expense:[…], transfer:[…] }
 *   categorise({ description, amountPence, direction }) → { kind, category, confidence }
 *       direction: 'in' | 'out' (falls back to the sign of amountPence)
 *       confidence: 'high' (a named rule matched) | 'medium' (a broad
 *       rule) | 'low' (nothing matched — the default for the direction)
 *   categoryLabel(kind, id) → label ('Other' style fallback)
 *   isCategory(kind, id) → boolean
 *
 * Why store payouts are TRANSFERS: App Store / Play income is booked from
 * the store's own reports (apple-financial, google-earnings importers), per
 * sale, in the sale currency. The payout that later lands in the bank is the
 * SAME money arriving — booking it as income too would count it twice. So a
 * payout credit is a transfer (excluded from every report).
 *
 * The server keeps a copy of the category ids (netlify/lib/booksCore.js —
 * it validates entries and cannot import this ES module). books.test.mjs
 * asserts the two lists are identical.
 *
 * Pure. Tested by books.test.mjs (npm run check:books).
 */

export const CATEGORIES = {
  income: [
    { id: 'app-store', label: 'App Store', hint: 'Apple proceeds, from App Store Connect financial reports' },
    { id: 'google-play', label: 'Google Play', hint: 'Play proceeds, from the Play Console earnings report' },
    { id: 'web', label: 'Web sales', hint: 'Payments taken on the website' },
    { id: 'other-income', label: 'Other income', hint: 'Interest, refunds received, anything else coming in' },
  ],
  expense: [
    { id: 'hosting', label: 'Hosting', hint: 'Servers, database, domains, CDN' },
    { id: 'software', label: 'Software & AI', hint: 'Tools and APIs the product or the work depends on' },
    { id: 'store-fees', label: 'Store fees', hint: 'Developer memberships, store commission and fees' },
    { id: 'refunds', label: 'Refunds', hint: 'Money returned to customers (store refunds)' },
    { id: 'professional', label: 'Professional', hint: 'Accountant, legal, registrations (e.g. ICO fee)' },
    { id: 'bank', label: 'Bank charges', hint: 'Account fees, card fees, FX charges' },
    { id: 'equipment', label: 'Equipment', hint: 'Computers, phones and test devices' },
    { id: 'marketing', label: 'Marketing', hint: 'Ads, promotion, design assets' },
    { id: 'travel', label: 'Travel', hint: 'Trains, flights, mileage for the work' },
    { id: 'office', label: 'Office', hint: 'Stationery, postage, workspace' },
    { id: 'subscriptions', label: 'Subscriptions', hint: 'Memberships and services not covered above' },
    { id: 'other', label: 'Other', hint: 'Anything else going out' },
  ],
  transfer: [
    { id: 'store-payout', label: 'Store payout', hint: 'App Store / Play payout arriving in the bank (income already booked from the report)' },
    { id: 'between-accounts', label: 'Between accounts', hint: 'Moving money between your own accounts' },
    { id: 'other-transfer', label: 'Other transfer', hint: 'Not income or a cost' },
  ],
};

export const DEFAULT_CATEGORY = { income: 'other-income', expense: 'other', transfer: 'other-transfer' };

export function isCategory(kind, id) {
  return !!(CATEGORIES[kind] && CATEGORIES[kind].some(c => c.id === id));
}

export function categoryLabel(kind, id) {
  const hit = CATEGORIES[kind] && CATEGORIES[kind].find(c => c.id === id);
  if (hit) return hit.label;
  return id ? String(id).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Uncategorised';
}

// Order matters: the first match wins, so specific rules sit above broad
// ones (Apple Search Ads before APPLE.COM/BILL, Google Ads before Google).
// `dir`: which direction the rule applies to ('in' | 'out' | undefined = both).
const RULES = [
  // ── Store payouts (credits) → transfer ──
  { re: /\bAPPLE\b.*\b(PAYOUT|PAYMENT|PROCEEDS|DISTRIBUTION)|\bAPP STORE\b|\bITUNES\b/, dir: 'in', kind: 'transfer', category: 'store-payout' },
  { re: /\bGOOGLE\b.*\b(PAYOUT|PAYMENT|PLAY|PAYMENTS)\b/, dir: 'in', kind: 'transfer', category: 'store-payout' },
  // ── Marketing (before the generic Apple/Google rules) ──
  { re: /APPLE SEARCH ADS|SEARCHADS/, dir: 'out', kind: 'expense', category: 'marketing' },
  { re: /GOOGLE\s*\*?\s*ADS|GOOGLE ADWORDS|FACEBK|META ADS|META PLATFORMS|TIKTOK ADS|REDDIT ADS|LINKEDIN ADS/, dir: 'out', kind: 'expense', category: 'marketing' },
  // ── Store fees ──
  { re: /APPLE\.COM\/BILL|APPLE DEVELOPER|APPLE DEV PROGRAM/, dir: 'out', kind: 'expense', category: 'store-fees' },
  { re: /GOOGLE\s*\*?\s*PLAY\s*CONSOLE|GOOGLE PLAY DEV/, dir: 'out', kind: 'expense', category: 'store-fees' },
  { re: /REVENUECAT/, dir: 'out', kind: 'expense', category: 'store-fees' },
  // ── Hosting ──
  { re: /SUPABASE|NETLIFY|VERCEL|CLOUDFLARE|AMAZON WEB SERVICES|\bAWS\b|DIGITALOCEAN|HEROKU|FLY\.IO|RENDER\.COM|NAMECHEAP|GODADDY|PORKBUN|GANDI|123[- ]?REG/, dir: 'out', kind: 'expense', category: 'hosting' },
  // ── Software & AI ──
  { re: /ANTHROPIC|CLAUDE\.AI|OPENAI|CHATGPT|GITHUB|FIGMA|NOTION|ADOBE|JETBRAINS|1PASSWORD|SENTRY|EXPO\b|MICROSOFT|GOOGLE\s*\*?\s*(WORKSPACE|GSUITE|CLOUD)|SLACK|LINEAR|POSTHOG|RESEND|TWILIO/, dir: 'out', kind: 'expense', category: 'software' },
  // ── Professional ──
  { re: /\bICO\b|INFORMATION COMMISSIONER|ACCOUNTANT|ACCOUNTANCY|SOLICITOR|LEGAL/, dir: 'out', kind: 'expense', category: 'professional' },
  // ── Bank charges ──
  { re: /\b(ACCOUNT|MONTHLY|SERVICE|MAINTENANCE|NON-STERLING|FOREIGN|FX|OVERDRAFT)\s+(FEE|FEES|CHARGE|CHARGES)\b|\bBANK CHARGES?\b|\bCOMMISSION CHARGE\b/, dir: 'out', kind: 'expense', category: 'bank' },
  // ── Travel ──
  { re: /\bTFL\b|TRAINLINE|\bLNER\b|AVANTI|GWR\b|NATIONAL RAIL|\bUBER\b(?!\s*EATS)|RYANAIR|EASYJET|BRITISH AIRWAYS|JET2|\bBOLT\b/, dir: 'out', kind: 'expense', category: 'travel' },
  // ── Equipment ──
  { re: /APPLE STORE|APPLE ONLINE STORE|CURRYS|\bARGOS\b|SCAN COMPUTERS|DELL\b/, dir: 'out', kind: 'expense', category: 'equipment' },
  // ── Office ──
  { re: /ROYAL MAIL|POST OFFICE|STAPLES|RYMAN|WEWORK|REGUS/, dir: 'out', kind: 'expense', category: 'office' },
  // ── Web sales ──
  { re: /\bSTRIPE\b|\bPADDLE\b|LEMON ?SQUEEZY|\bPAYPAL\b/, dir: 'in', kind: 'income', category: 'web', confidence: 'medium' },
  // ── Interest ──
  { re: /\bINTEREST\b/, dir: 'in', kind: 'income', category: 'other-income', confidence: 'medium' },
  // ── Own-account moves ──
  { re: /\b(TRANSFER|TFR|SAVINGS|OWN ACCOUNT|TO ACC|FROM ACC)\b/, kind: 'transfer', category: 'between-accounts', confidence: 'medium' },
];

export function categorise({ description, amountPence, direction } = {}) {
  const dir = direction === 'in' || direction === 'out'
    ? direction
    : (typeof amountPence === 'number' && amountPence < 0 ? 'out' : 'in');
  const text = String(description || '').toUpperCase().replace(/\s+/g, ' ');
  for (const r of RULES) {
    if (r.dir && r.dir !== dir) continue;
    if (r.re.test(text)) return { kind: r.kind, category: r.category, confidence: r.confidence || 'high' };
  }
  return dir === 'in'
    ? { kind: 'income', category: DEFAULT_CATEGORY.income, confidence: 'low' }
    : { kind: 'expense', category: DEFAULT_CATEGORY.expense, confidence: 'low' };
}
