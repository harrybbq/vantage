/**
 * Apple Health export importer (owner-only for now).
 *
 * Live HealthKit access needs a native iOS build + the paid Apple
 * Developer entitlement, which the web/PWA can't have. As a stand-in
 * that works today, this parses the manual export the Health app
 * produces (profile → Export All Health Data → export.zip, which
 * contains export.xml) and maps the records into Vantage's existing
 * daily stores:
 *
 *   BodyMass            → vitalsLog[day].weight (kg)
 *   RestingHeartRate    → vitalsLog[day].rhr (bpm)
 *   SleepAnalysis       → vitalsLog[day].sleep (hours asleep)
 *   ActiveEnergyBurned  → burnLog[day] "Apple Health" entry (kcal)
 *
 * Parsing streams the file so a large export doesn't have to sit in
 * memory all at once. A .zip is inflated first (via fflate); a raw
 * export.xml is streamed directly.
 */

const LB_TO_KG = 0.45359237;

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}
function dayOf(dateStr) {
  // "2026-07-01 08:23:00 +0100" → "2026-07-01"
  return dateStr ? dateStr.slice(0, 10) : null;
}
function toDate(s) {
  // Apple format "YYYY-MM-DD HH:MM:SS ±HHMM" → valid ISO Date.
  const m = s && s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2})(\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : new Date(s);
}

function processRecord(tag, acc) {
  const type = attr(tag, 'type');
  if (!type) return;

  if (type === 'HKQuantityTypeIdentifierBodyMass') {
    const d = dayOf(attr(tag, 'startDate'));
    let v = parseFloat(attr(tag, 'value'));
    if (!d || !Number.isFinite(v)) return;
    if ((attr(tag, 'unit') || '').toLowerCase().includes('lb')) v *= LB_TO_KG;
    acc.weight[d] = Math.round(v * 10) / 10; // latest wins
  } else if (type === 'HKQuantityTypeIdentifierRestingHeartRate') {
    const d = dayOf(attr(tag, 'startDate'));
    const v = parseFloat(attr(tag, 'value'));
    if (d && Number.isFinite(v)) acc.rhr[d] = Math.round(v);
  } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
    const val = attr(tag, 'value') || '';
    // Count only actual asleep phases (ignore InBed / Awake).
    if (!/Asleep/i.test(val)) return;
    const start = attr(tag, 'startDate'), end = attr(tag, 'endDate');
    if (!start || !end) return;
    const ms = toDate(end) - toDate(start);
    if (!(ms > 0)) return;
    const d = dayOf(end); // credit the wake-up day
    acc.sleepMs[d] = (acc.sleepMs[d] || 0) + ms;
  } else if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
    const d = dayOf(attr(tag, 'startDate'));
    const v = parseFloat(attr(tag, 'value'));
    if (d && Number.isFinite(v)) acc.burn[d] = (acc.burn[d] || 0) + v;
  }
}

async function streamOf(file) {
  if (/\.zip$/i.test(file.name)) {
    const { unzipSync } = await import('fflate');
    const buf = new Uint8Array(await file.arrayBuffer());
    const out = unzipSync(buf, { filter: f => /(^|\/)export\.xml$/i.test(f.name) });
    const key = Object.keys(out).find(k => /export\.xml$/i.test(k));
    if (!key) throw new Error('No export.xml found inside the zip.');
    return new Blob([out[key]]).stream();
  }
  return file.stream();
}

/** Parse the export, returning aggregated per-day data + counts. */
export async function parseHealthExport(file, onProgress) {
  const acc = { weight: {}, rhr: {}, sleepMs: {}, burn: {} };
  const stream = await streamOf(file);
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  const recRe = /<Record\b[^>]*?>/g;
  let buf = '';
  let read = 0;
  const total = file.size || 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    buf += decoder.decode(value, { stream: true });
    recRe.lastIndex = 0;
    let m, lastEnd = 0;
    while ((m = recRe.exec(buf))) { processRecord(m[0], acc); lastEnd = recRe.lastIndex; }
    // keep a tail that may hold a partial record spanning chunks
    buf = buf.slice(Math.max(lastEnd, buf.length - 4096));
    if (onProgress && total) onProgress(Math.min(0.99, read / total));
  }
  onProgress?.(1);

  // Build store patches
  const vitals = {};
  const days = new Set([...Object.keys(acc.weight), ...Object.keys(acc.rhr), ...Object.keys(acc.sleepMs)]);
  for (const d of days) {
    const e = {};
    if (acc.weight[d] != null) e.weight = acc.weight[d];
    if (acc.rhr[d] != null) e.rhr = acc.rhr[d];
    if (acc.sleepMs[d] != null) e.sleep = Math.round((acc.sleepMs[d] / 3600000) * 10) / 10;
    if (Object.keys(e).length) vitals[d] = e;
  }
  const burn = {};
  for (const [d, kcal] of Object.entries(acc.burn)) if (kcal > 0) burn[d] = Math.round(kcal);

  return {
    vitals, burn,
    counts: {
      weight: Object.keys(acc.weight).length,
      rhr: Object.keys(acc.rhr).length,
      sleep: Object.keys(acc.sleepMs).length,
      burn: Object.keys(burn).length,
    },
  };
}

/** Merge a parse result into synced state via update(). */
export function applyHealthImport(update, { vitals, burn }) {
  update(prev => {
    const vitalsLog = { ...(prev.vitalsLog || {}) };
    for (const [d, v] of Object.entries(vitals)) vitalsLog[d] = { ...(vitalsLog[d] || {}), ...v };
    const burnLog = { ...(prev.burnLog || {}) };
    for (const [d, kcal] of Object.entries(burn)) {
      const others = (burnLog[d] || []).filter(a => a.label !== 'Apple Health');
      burnLog[d] = [...others, { id: 'ah' + d, label: 'Apple Health', kcal }];
    }
    return { ...prev, vitalsLog, burnLog };
  });
}
