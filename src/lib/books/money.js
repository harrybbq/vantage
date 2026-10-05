// STUB — replaced by the backend agent's version at merge
// Same exports as the backend's money.js: toPence, fromPence, fmtGBP, fmtMoney, fmtGBPShort.
const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function toPence(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  let neg = false;
  const br = s.match(/^\((.*)\)$/);
  if (br) { neg = true; s = br[1]; }
  const dc = s.match(/^(.*?)\s*(DR|CR)\.?$/i);
  if (dc) { if (dc[2].toUpperCase() === 'DR') neg = !neg; s = dc[1]; }
  s = s.replace(/[£$€¥]|GBP|USD|EUR/gi, '').replace(/\s/g, '');
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.includes(',')) { if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null; s = s.replace(/,/g, ''); }
  if (!/^\d*(\.\d*)?$/.test(s) || !/\d/.test(s)) return null;
  const v = Math.round(Number(s) * 100);
  return neg ? (v === 0 ? 0 : -v) : v;
}

export function fromPence(pence) {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '';
  const p = Math.round(pence), a = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const PREFIX = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' };
export function fmtMoney(pence, currency = 'GBP') {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '—';
  const p = Math.round(pence), a = Math.abs(p);
  const body = `${group(String(Math.floor(a / 100)))}.${String(a % 100).padStart(2, '0')}`;
  const cur = String(currency || 'GBP').toUpperCase();
  const sign = p < 0 ? '−' : '';
  return PREFIX[cur] ? `${sign}${PREFIX[cur]}${body}` : `${sign}${body} ${cur}`;
}

export const fmtGBP = pence => fmtMoney(pence, 'GBP');

export function fmtGBPShort(pence) {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '—';
  const pounds = Math.round(pence / 100);
  return `${pounds < 0 ? '−' : ''}£${group(String(Math.abs(pounds)))}`;
}
