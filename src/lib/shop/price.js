// STUB — replaced by the data agent's version at merge
/**
 * Minimal stand-in for the data agent's tested price reader, with the
 * same exports and shapes, so the UI can build and be checked against
 * realistic numbers before the two branches meet.
 */

const CUR = { '£': 'GBP', '$': 'USD', '€': 'EUR' };

function num(s) {
  // "1.299,99" (EU) vs "1,299.99" (UK/US)
  if (/\d\.\d{3},\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function parsePrice(str) {
  const raw = str == null ? '' : String(str);
  const t = raw.trim();
  const out = { value: null, currency: null, kind: 'unknown', raw };
  if (!t) return out;
  if (/^free$/i.test(t)) return { ...out, value: 0, currency: 'GBP', kind: 'free' };
  const sym = (t.match(/[£$€]/) || [])[0];
  const currency = sym ? CUR[sym] : (/eur/i.test(t) ? 'EUR' : /usd/i.test(t) ? 'USD' : 'GBP');
  const nums = (t.match(/\d[\d.,]*/g) || []).map(num).filter(n => n != null);
  if (!nums.length) return out;
  let kind = 'exact';
  let value = nums[0];
  if (/\bnow\b/i.test(t)) value = nums[nums.length - 1];
  else if (/\bfor\b/i.test(t) && nums.length > 1) { kind = 'multi'; value = nums[nums.length - 1]; }
  else if (/^from\b/i.test(t) || /[–-]/.test(t) && nums.length > 1) { kind = 'from'; value = Math.min(...nums); }
  return { value, currency, kind, raw };
}

export function itemPrice(item) {
  const p = parsePrice(item?.price);
  const lp = item?.livePrice;
  const now = lp && Number.isFinite(Number(lp.p)) ? { value: Number(lp.p), at: lp.at || null } : null;
  return { ...p, now };
}

export function totalsFor(items) {
  let sum = 0, count = 0, priced = 0, unpriced = 0, otherCurrency = 0;
  for (const it of items || []) {
    count++;
    const p = parsePrice(it?.price);
    if (p.value == null) { unpriced++; continue; }
    if (p.currency && p.currency !== 'GBP') { otherCurrency++; continue; }
    sum += p.value;
    priced++;
  }
  return { sum, count, priced, unpriced, otherCurrency };
}

export function fmtGBP(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
