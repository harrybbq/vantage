/**
 * Shape checks for the Career plan's owner content, run before every save
 * from the "Edit data" drawer. A save that fails here never reaches
 * Supabase, so a typo in hand-edited JSON cannot blank a panel.
 *
 * Errors are human-readable with a path: "items[3].stream: must be one
 * of HOUSE, MONEY, CAR, CERTS, JOB". Unknown extra keys are allowed —
 * the data is meant to grow without a code change.
 *
 * Pure. No React, no network.
 */
import { isMonth } from './money.js';
import { STATUSES } from './planTimeline.js';

export const KEYS = {
  plan: 'career.plan',
  money: 'career.money',
  certs: 'career.certs',
  companies: 'career.companies',
  status: 'career.status',
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isUrlish = v => v == null || v === '' || /^https?:\/\/\S+$/.test(v);

function list(errs, v, path, each) {
  if (!Array.isArray(v)) { errs.push(`${path}: must be a list`); return; }
  v.forEach((x, i) => each(x, `${path}[${i}]`));
}
function ids(errs, arr, path) {
  const seen = new Set();
  (arr || []).forEach((x, i) => {
    if (!isObj(x)) return;
    if (!isStr(x.id)) errs.push(`${path}[${i}].id: required`);
    else if (seen.has(x.id)) errs.push(`${path}[${i}].id: "${x.id}" is used twice`);
    else seen.add(x.id);
  });
}

function plan(d, errs) {
  if (!isObj(d)) return errs.push('plan: must be an object');
  if (!isObj(d.range) || !isMonth(d.range.from) || !isMonth(d.range.to)) errs.push('range: needs from/to as YYYY-MM');
  const streams = new Set();
  list(errs, d.streams, 'streams', (s, p) => {
    if (!isObj(s) || !isStr(s.id)) return errs.push(`${p}.id: required`);
    streams.add(s.id);
    if (s.color && !/^#[0-9a-f]{6}$/i.test(s.color)) errs.push(`${p}.color: use #rrggbb`);
  });
  list(errs, d.items, 'items', (it, p) => {
    if (!isObj(it)) return errs.push(`${p}: must be an object`);
    if (!streams.has(it.stream)) errs.push(`${p}.stream: must be one of ${[...streams].join(', ')}`);
    if (!(it.start === 'post-completion' || isMonth(it.start))) errs.push(`${p}.start: YYYY-MM or "post-completion"`);
    if (it.end != null && !isMonth(it.end)) errs.push(`${p}.end: YYYY-MM`);
    if (!isStr(it.title)) errs.push(`${p}.title: required`);
    if (it.status != null && !STATUSES.includes(it.status)) errs.push(`${p}.status: one of ${STATUSES.join(', ')}`);
  });
  ids(errs, d.items, 'items');
  if (d.guardrails != null) list(errs, d.guardrails, 'guardrails', (g, p) => { if (!isObj(g) || !isStr(g.label)) errs.push(`${p}.label: required`); });
  if (d.contingencies != null) {
    list(errs, d.contingencies, 'contingencies', (c, p) => {
      if (!isObj(c) || !isStr(c.if) || !isStr(c.then)) errs.push(`${p}: needs "if" and "then"`);
    });
  }
}

function money(d, errs) {
  if (!isObj(d)) return errs.push('money: must be an object');
  if (!isObj(d.start) || !isMonth(d.start.month) || !isNum(d.start.balance)) errs.push('start: needs month (YYYY-MM) and balance (number)');
  list(errs, d.transfers, 'transfers', (t, p) => {
    if (!isObj(t) || !isMonth(t.from) || !isNum(t.monthly)) errs.push(`${p}: needs from (YYYY-MM) and monthly (number)`);
    else if (t.to != null && !isMonth(t.to)) errs.push(`${p}.to: YYYY-MM or leave out`);
  });
  if (d.oneOffs != null) {
    list(errs, d.oneOffs, 'oneOffs', (o, p) => {
      if (!isObj(o) || !isMonth(o.month) || !isNum(o.amount)) errs.push(`${p}: needs month and amount`);
    });
  }
  list(errs, d.scenarios, 'scenarios', (s, p) => {
    if (!isObj(s) || !isNum(s.price) || s.price <= 0) return errs.push(`${p}.price: a positive number`);
    if (s.valuation != null && !isNum(s.valuation)) errs.push(`${p}.valuation: a number`);
    if (s.ltv != null && !(isNum(s.ltv) && s.ltv > 0 && s.ltv < 1)) errs.push(`${p}.ltv: a fraction, e.g. 0.9`);
  });
  ids(errs, d.scenarios, 'scenarios');
  for (const k of ['legal', 'buffer', 'keysLagMonths', 'ltvDefault']) {
    if (d[k] != null && !isNum(d[k])) errs.push(`${k}: a number`);
  }
  if (d.contractEnd != null && !isMonth(d.contractEnd)) errs.push('contractEnd: YYYY-MM');
}

function certs(d, errs) {
  list(errs, d, 'certs', (c, p) => {
    if (!isObj(c) || !isStr(c.name)) return errs.push(`${p}.name: required`);
    if (c.target != null && c.target !== '' && !isMonth(c.target)) errs.push(`${p}.target: YYYY-MM`);
    if (c.targetEnd != null && c.targetEnd !== '' && !isMonth(c.targetEnd)) errs.push(`${p}.targetEnd: YYYY-MM`);
    if (c.studyHours != null && !isNum(c.studyHours)) errs.push(`${p}.studyHours: a number`);
    if (!isUrlish(c.priceUrl)) errs.push(`${p}.priceUrl: a full https:// link`);
  });
  ids(errs, d, 'certs');
}

function companies(d, errs) {
  list(errs, d, 'companies', (c, p) => {
    if (!isObj(c) || !isStr(c.name)) return errs.push(`${p}.name: required`);
    if (!isUrlish(c.careersUrl)) errs.push(`${p}.careersUrl: a full https:// link`);
    if (c.verifiedOn != null && c.verifiedOn !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(c.verifiedOn)) errs.push(`${p}.verifiedOn: YYYY-MM-DD`);
    if (c.difficulty != null) {
      const d = c.difficulty;
      if (!isObj(d) || !Number.isInteger(d.score) || d.score < 1 || d.score > 5) errs.push(`${p}.difficulty.score: a whole number 1–5`);
    }
    if (c.salary != null) {
      const sal = c.salary;
      if (!isObj(sal) || !isNum(sal.low) || !isNum(sal.high)) errs.push(`${p}.salary: needs low and high (numbers, £/year)`);
      else if (sal.low > sal.high) errs.push(`${p}.salary: low is above high`);
      if (isObj(sal) && !isUrlish(sal.url)) errs.push(`${p}.salary.url: a full https:// link`);
    }
  });
  ids(errs, d, 'companies');
}

function status(d, errs) {
  if (!isObj(d)) return errs.push('status: must be an object');
  for (const [k, v] of Object.entries(d)) {
    if (!isObj(v) || !STATUSES.includes(v.status)) errs.push(`${k}.status: one of ${STATUSES.join(', ')}`);
  }
}

const CHECKS = {
  [KEYS.plan]: plan, [KEYS.money]: money, [KEYS.certs]: certs,
  [KEYS.companies]: companies, [KEYS.status]: status,
};

/** → [] when valid, otherwise readable errors (first 20). */
export function validate(key, data) {
  const check = CHECKS[key];
  if (!check) return [`Unknown content key "${key}"`];
  const errs = [];
  check(data, errs);
  return errs.slice(0, 20);
}
