/**
 * Prometheus text parsing and the health figures drawn from it, on a
 * scrape shaped like Supabase's published sample (supabase-grafana
 * metrics.md).
 *
 * Run: npm run check:secprom   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CommonJS inside a "type": "module" package — copied to .cjs to load,
// the same way pgPage.test.mjs does.
const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `prom.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(new URL('./prom.js', import.meta.url)));
let lib;
try { lib = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
const { parsePrometheus, parseLabels, metricsHealth } = lib;

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) failures.push(`${label}: got ${g}, want ${w}`);
};

const L = 'supabase_project_ref="abcdefghijkl",service_type="db"';
const scrape = (cpu0idle, cpu1idle, busy) => `
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{${L},cpu="0",mode="idle"} ${cpu0idle}
node_cpu_seconds_total{${L},cpu="0",mode="user"} ${busy}
node_cpu_seconds_total{${L},cpu="0",mode="iowait"} 0
node_cpu_seconds_total{${L},cpu="1",mode="idle"} ${cpu1idle}
node_cpu_seconds_total{${L},cpu="1",mode="user"} ${busy}
# TYPE node_load1 gauge
node_load1{${L}} 0.5
node_memory_MemAvailable_bytes{${L}} 250000000
node_memory_MemTotal_bytes{${L}} 1000000000
node_filesystem_avail_bytes{${L},device="/dev/nvme0n1p2",device_error="",fstype="ext4",mountpoint="/"} 900
node_filesystem_size_bytes{${L},device="/dev/nvme0n1p2",device_error="",fstype="ext4",mountpoint="/"} 1000
node_filesystem_avail_bytes{${L},device="/dev/nvme1n1",device_error="",fstype="ext4",mountpoint="/data"} 1500000000
node_filesystem_size_bytes{${L},device="/dev/nvme1n1",device_error="",fstype="ext4",mountpoint="/data"} 8000000000
pg_stat_database_num_backends{supabase_project_ref="abcdefghijkl",service_type="postgresql",server="localhost:5432"} 14
node_time_seconds{${L}} 1759400000.5
node_boot_time_seconds{${L}} 1759300000
weird_metric_without_value
bad{a="1" 3
`;

// ── labels ──
expect('labels simple', parseLabels('a="1",b="two"'), { a: '1', b: 'two' });
expect('labels escapes', parseLabels('a="x\\"y",b="c,d}",n="l\\nm"'), { a: 'x"y', b: 'c,d}', n: 'l\nm' });

// ── parse ──
const s1 = parsePrometheus(scrape(1000, 1000, 100));
expect('skips comments and junk', s1.length, 15);
expect('first sample', s1[0], { name: 'node_cpu_seconds_total', labels: { supabase_project_ref: 'abcdefghijkl', service_type: 'db', cpu: '0', mode: 'idle' }, value: 1000 });
expect('no labels', parsePrometheus('up 1\nup2 2 1700000000000'), [{ name: 'up', labels: {}, value: 1 }, { name: 'up2', labels: {}, value: 2 }]);
expect('special values', parsePrometheus('a +Inf\nb NaN').map(x => x.value), [Infinity]);
expect('brace in label value', parsePrometheus('m{path="/a}b"} 7')[0].labels.path, '/a}b');

// ── health: first scrape → no CPU % (needs two), load1 + cores instead ──
const h1 = metricsHealth(s1, null);
expect('cpu null without a previous scrape', [h1.health.cpuPct, h1.health.cpuBasis], [null, null]);
expect('load1 + cores', [h1.health.load1, h1.health.cores], [0.5, 2]);
expect('mem', h1.health.memPct, 75);
expect('disk prefers /data', [h1.health.diskUsedPct, h1.health.diskMount], [81.3, '/data']);
expect('disk bytes = size − avail', [h1.health.diskUsedBytes, h1.health.diskSizeBytes], [6500000000, 8000000000]);
expect('backends', h1.health.connections.active, 14);
expect('uptime', h1.health.uptimeSec, 100001);
expect('cpu totals', h1.cpu, { total: 2200, idle: 2000, cores: 2 });

// ── second scrape → delta CPU: +20 idle, +60 busy per... → 60/80 busy ──
const s2 = parsePrometheus(scrape(1010, 1010, 130));
const h2 = metricsHealth(s2, h1.cpu);
// totals: idle 2020 (+20), busy 260 (+60) → busy share 60 / 80 = 75 %
expect('cpu delta', [h2.health.cpuBasis, h2.health.cpuPct], ['delta', 75]);

// counter reset (instance restarted) → no CPU % rather than a nonsense one
const h3 = metricsHealth(parsePrometheus(scrape(5, 5, 1)), h1.cpu);
expect('counter reset → null', [h3.health.cpuPct, h3.health.cpuBasis], [null, null]);
// same scrape twice (metrics refresh once a minute) → no delta → null
expect('no movement → null', metricsHealth(s1, h1.cpu).health.cpuPct, null);

// max connections from the (unverified) metric when present
expect('max connections metric', metricsHealth(parsePrometheus('max_connections_connection_count 90')).health.connections.max, 90);

// ── nothing there → all null, nothing invented ──
const empty = metricsHealth(parsePrometheus('# nothing\n'), null);
expect('empty', empty.health, {
  cpuPct: null, cpuBasis: null, load1: null, cores: null, memPct: null, diskUsedPct: null,
  diskUsedBytes: null, diskSizeBytes: null,
  connections: { active: null, idle: null, max: null }, uptimeSec: null,
});

// only "/" mounted → uses it; rootfs ignored
const rootOnly = parsePrometheus([
  'node_filesystem_avail_bytes{fstype="rootfs",mountpoint="/"} 1',
  'node_filesystem_size_bytes{fstype="rootfs",mountpoint="/"} 100',
  'node_filesystem_avail_bytes{fstype="ext4",mountpoint="/"} 40',
  'node_filesystem_size_bytes{fstype="ext4",mountpoint="/"} 100',
].join('\n'));
expect('root mount', metricsHealth(rootOnly).health.diskUsedPct, 60);

if (failures.length) {
  console.error(`check:secprom — ${failures.length} of ${checked} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check:secprom — ${checked} checks passed`);
