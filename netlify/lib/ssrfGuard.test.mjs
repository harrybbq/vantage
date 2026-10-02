/**
 * The SSRF address classifier, pinned down case by case.
 *
 * The old guard was a handful of hostname prefixes; every row below
 * marked "missed before" went straight through it. The DNS half is
 * exercised with a fake resolver so this stays offline and pure.
 *
 * Run: npm run check:ssrf   (also part of npm run build)
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CommonJS inside a "type": "module" package — copied to .cjs to load,
// the same way scripts/check-ratings-parity.mjs loads recompute.js.
const require = createRequire(import.meta.url);
const tmp = join(tmpdir(), `ssrfGuard.${process.pid}.cjs`);
writeFileSync(tmp, readFileSync(new URL('./ssrfGuard.js', import.meta.url)));
let guard;
try { guard = require(tmp); } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
const { isBlockedAddress, assertPublicUrl } = guard;

const failures = [];
let checked = 0;
const expect = (label, got, want) => {
  checked++;
  if (got !== want) failures.push(`${label}: got ${got}, want ${want}`);
};

const BLOCKED = [
  '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '169.254.169.254',                 // cloud metadata
  '0.0.0.0', '0.1.2.3',              // missed before
  '100.64.0.1', '100.127.255.255',   // CGNAT — missed before
  '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10',
  '::', '::1', '[::1]',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8',  // IPv4-mapped — missed before
  '::127.0.0.1',                     // IPv4-compatible
  'fc00::1', 'fd12:3456:789a::1',    // ULA — missed before
  'fe80::1', 'fe80::1%eth0',         // link-local
  'ff02::1', '2001:db8::1',
  '64:ff9b::a9fe:a9fe',              // NAT64 of 169.254.169.254
  '2002:7f00:1::',                   // 6to4 of 127.0.0.1
  'not-an-ip', '',
];
const ALLOWED = [
  '8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1',
  '192.169.0.1', '151.101.1.69',
  '2606:4700:4700::1111', '2a00:1450:4009:81f::200e', '64:ff9b::808:808', '2002:808:808::',
];
for (const ip of BLOCKED) expect(`blocked ${ip || '(empty)'}`, isBlockedAddress(ip), true);
for (const ip of ALLOWED) expect(`allowed ${ip}`, isBlockedAddress(ip), false);

// URL-level checks with a fake resolver.
const fakeDns = table => async host => {
  if (!(host in table)) throw new Error('ENOTFOUND');
  return table[host].map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
};
const dnsTable = {
  'shop.example.com': ['93.184.216.34'],
  'sneaky.example.com': ['127.0.0.1'],                      // name → private: missed before
  'mixed.example.com': ['93.184.216.34', '10.0.0.5'],       // one bad answer poisons it
  'v6only.example.com': ['2606:4700::6810:84e5'],
  'ula.example.com': ['fd00::5'],
};
const urlCases = [
  ['https://shop.example.com/p/1', true],
  ['http://shop.example.com:80/x', true],
  ['https://shop.example.com:443/x', true],
  ['https://v6only.example.com/', true],
  ['https://sneaky.example.com/', false],
  ['https://mixed.example.com/', false],
  ['https://ula.example.com/', false],
  ['https://nxdomain.example.com/', false],
  ['https://shop.example.com:8080/', false],               // non-default port
  ['ftp://shop.example.com/', false],
  ['file:///etc/passwd', false],
  ['http://user:pw@shop.example.com/', false],
  ['http://localhost/', false],
  ['http://printer.local/', false],
  ['http://metadata.google.internal/', false],
  ['http://169.254.169.254/latest/meta-data/', false],
  ['http://0.0.0.0/', false],
  ['http://2130706433/', false],                           // decimal 127.0.0.1
  ['http://0x7f.1/', false],                               // hex shorthand
  ['http://[::ffff:127.0.0.1]/', false],
  ['http://[fd00::1]/', false],
  ['http://[2606:4700:4700::1111]/', true],
];
for (const [url, ok] of urlCases) {
  let passed;
  try { await assertPublicUrl(url, fakeDns(dnsTable)); passed = true; } catch { passed = false; }
  expect(`url ${url}`, passed, ok);
}

if (failures.length) {
  console.error(`✗ ssrf guard: ${failures.length} of ${checked} checks failed`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ ssrf guard — ${checked} checks`);
