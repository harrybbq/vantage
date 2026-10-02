/**
 * Prometheus text exposition → numbers the Security console can show.
 * Pure: no fetch, no env. Tested by prom.test.mjs (npm run check:secprom).
 *
 * Source of the metric names (supabase/supabase-grafana, the dashboard
 * Supabase publishes for its own Metrics API, and its metrics.md sample
 * scrape): node_cpu_seconds_total{cpu,mode}, node_load1,
 * node_memory_MemAvailable_bytes, node_memory_MemTotal_bytes,
 * node_filesystem_avail_bytes / node_filesystem_size_bytes{mountpoint,
 * fstype}, pg_stat_database_num_backends, node_time_seconds,
 * node_boot_time_seconds. The Metrics API is in beta and Supabase says
 * names may change, so every reading here is optional: a metric that is
 * missing gives null, never a guess.
 */

/** Parse `a="x",b="y\"z"` into an object. */
function parseLabels(src) {
  const out = {};
  let i = 0;
  while (i < src.length) {
    while (i < src.length && (src[i] === ',' || src[i] === ' ')) i++;
    const eq = src.indexOf('=', i);
    if (eq < 0) break;
    const key = src.slice(i, eq).trim();
    i = eq + 1;
    if (src[i] !== '"') break;
    i++;
    let val = '';
    while (i < src.length && src[i] !== '"') {
      if (src[i] === '\\' && i + 1 < src.length) {
        const n = src[i + 1];
        val += n === 'n' ? '\n' : n;
        i += 2;
      } else {
        val += src[i++];
      }
    }
    i++; // closing quote
    if (key) out[key] = val;
  }
  return out;
}

function parseValue(s) {
  if (s === 'NaN') return NaN;
  if (s === '+Inf' || s === 'Inf') return Infinity;
  if (s === '-Inf') return -Infinity;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * → [{ name, labels, value }]. Comments, blank lines and anything that
 * does not parse are skipped rather than thrown on: one odd line must
 * not cost the whole panel.
 */
function parsePrometheus(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    let name, labels = {}, rest;
    const brace = line.indexOf('{');
    const space = line.indexOf(' ');
    if (brace > 0 && (space < 0 || brace < space)) {
      name = line.slice(0, brace);
      // The closing brace is the last `}` before the value; label values
      // may themselves contain `}` only inside quotes, so walk quotes.
      let j = brace + 1, inQ = false;
      for (; j < line.length; j++) {
        const c = line[j];
        if (c === '\\' && inQ) { j++; continue; }
        if (c === '"') inQ = !inQ;
        else if (c === '}' && !inQ) break;
      }
      if (j >= line.length) continue;
      labels = parseLabels(line.slice(brace + 1, j));
      rest = line.slice(j + 1).trim();
    } else {
      if (space < 0) continue;
      name = line.slice(0, space);
      rest = line.slice(space + 1).trim();
    }
    const value = parseValue(rest.split(/\s+/)[0]);
    if (!name || Number.isNaN(value)) continue;
    out.push({ name, labels, value });
  }
  return out;
}

const pick = (samples, name, where = () => true) =>
  samples.filter(s => s.name === name && where(s.labels));

const sum = arr => arr.reduce((a, s) => a + s.value, 0);
const round1 = n => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const clampPct = n => (n == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(100, n)));

/** Totals of node_cpu_seconds_total across CPUs: { total, idle, cores }. */
function cpuTotals(samples) {
  const cpu = pick(samples, 'node_cpu_seconds_total');
  if (!cpu.length) return null;
  const total = sum(cpu);
  const idle = sum(cpu.filter(s => s.labels.mode === 'idle'));
  const cores = new Set(cpu.map(s => s.labels.cpu)).size || 1;
  return { total, idle, cores };
}

/**
 * The health figures from one scrape.
 *
 * CPU from a counter needs two readings (Supabase's dashboard uses
 * 100 − rate(idle)). `prev` is the previous cpuTotals() (the caller
 * keeps it in module scope); when it is usable the figure is the busy
 * share since then (`cpuBasis: 'delta'`). Without one, cpuPct is null —
 * not a guess — and `load1` (the one-minute load average) and `cores`
 * are returned beside it for the UI to show instead.
 */
function metricsHealth(samples, prev = null) {
  const out = {
    cpuPct: null, cpuBasis: null, load1: null, cores: null, memPct: null, diskUsedPct: null,
    diskUsedBytes: null, diskSizeBytes: null,
    connections: { active: null, idle: null, max: null }, uptimeSec: null,
  };
  const cpuNow = cpuTotals(samples);
  if (cpuNow) out.cores = cpuNow.cores;
  const load = pick(samples, 'node_load1')[0];
  if (load) out.load1 = Math.round(load.value * 100) / 100;
  if (cpuNow && prev && cpuNow.total > prev.total && cpuNow.idle >= prev.idle) {
    const dTotal = cpuNow.total - prev.total;
    const dIdle = cpuNow.idle - prev.idle;
    out.cpuPct = round1(clampPct(100 * (1 - dIdle / dTotal)));
    out.cpuBasis = 'delta';
  }

  const avail = pick(samples, 'node_memory_MemAvailable_bytes')[0];
  const total = pick(samples, 'node_memory_MemTotal_bytes')[0];
  if (avail && total && total.value > 0) out.memPct = round1(clampPct(100 * (1 - avail.value / total.value)));

  // The database lives on /data when there is a separate volume (the
  // sample scrape shows both / and /data); fall back to / otherwise.
  const fsOk = l => l.fstype !== 'rootfs';
  for (const mount of ['/data', '/']) {
    const a = pick(samples, 'node_filesystem_avail_bytes', l => l.mountpoint === mount && fsOk(l))[0];
    const s = pick(samples, 'node_filesystem_size_bytes', l => l.mountpoint === mount && fsOk(l))[0];
    if (a && s && s.value > 0) {
      out.diskUsedBytes = Math.max(0, s.value - a.value);
      out.diskSizeBytes = s.value;
      out.diskUsedPct = round1(clampPct(100 * (out.diskUsedBytes / s.value)));
      out.diskMount = mount;
      break;
    }
  }

  const backends = pick(samples, 'pg_stat_database_num_backends');
  if (backends.length) out.connections.active = Math.round(sum(backends));
  // UNVERIFIED names (seen only in a sample scrape / postgres_exporter
  // defaults); owner_db_stats() is the fallback for max connections.
  const maxConn = pick(samples, 'max_connections_connection_count')[0]
    || pick(samples, 'pg_settings_max_connections')[0];
  if (maxConn) out.connections.max = Math.round(maxConn.value);

  const nowT = pick(samples, 'node_time_seconds')[0];
  const boot = pick(samples, 'node_boot_time_seconds')[0];
  if (nowT && boot && nowT.value >= boot.value) out.uptimeSec = Math.round(nowT.value - boot.value);

  return { health: out, cpu: cpuNow };
}

module.exports = { parsePrometheus, parseLabels, metricsHealth, cpuTotals };
