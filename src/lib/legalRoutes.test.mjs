/**
 * The public pages that must open before sign-in: /privacy and /terms
 * (store privacy-policy URL), /support (both stores' support URL) and
 * /delete-account (Google Play's account-deletion web URL).
 *
 *   npm run check:legalroutes
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolvePublicPage, publicPagePath, PUBLIC_PAGES, PAGE_META,
  isPlaceholderEmail, mailtoHref, SUPPORT_EMAIL, SECURITY_EMAIL,
  settingsRequest, SETTINGS_FOCUS,
} from './support.js';

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── Paths and hashes ──
for (const key of ['privacy', 'terms', 'support', 'delete-account']) {
  eq(resolvePublicPage(`/${key}`, ''), key, `/${key} resolves`);
  eq(resolvePublicPage(`/${key}/`, ''), key, `/${key}/ (trailing slash) resolves`);
  eq(resolvePublicPage('/', `#${key}`), key, `#${key} resolves`);
  eq(publicPagePath(key), `/${key}`, `${key} round-trips to its path`);
  ok(PAGE_META[key]?.title && PAGE_META[key]?.description, `${key} has a title and meta description`);
}
eq(PUBLIC_PAGES.length, 4, 'four public pages');

// ── Things that are NOT public pages ──
for (const p of ['/', '', '/invite/abc123', '/supporting', '/support/extra', '/delete', '/privacy-policy', '/Support']) {
  eq(resolvePublicPage(p, ''), null, `${JSON.stringify(p)} boots the app`);
}
eq(resolvePublicPage(undefined, undefined), null, 'no location → app');
eq(resolvePublicPage('/', '#whoop=connected'), null, 'unrelated hash → app');
eq(publicPagePath('nope'), '/', 'unknown key → root');

// ── Placeholder addresses never become mailto links ──
ok(isPlaceholderEmail('support@[your-domain]'), 'bracketed domain is a placeholder');
ok(isPlaceholderEmail(''), 'empty is a placeholder');
ok(isPlaceholderEmail(null), 'null is a placeholder');
ok(!isPlaceholderEmail('support@vantage.example'), 'a real address is not a placeholder');
eq(mailtoHref('support@[your-domain]'), null, 'placeholder → no mailto');
eq(mailtoHref('help@vantage.example', 'Delete my account'), 'mailto:help@vantage.example?subject=Delete%20my%20account', 'real address → mailto with subject');
ok(typeof SUPPORT_EMAIL === 'string' && SUPPORT_EMAIL.startsWith('support@'), 'support address constant exists');
ok(typeof SECURITY_EMAIL === 'string' && SECURITY_EMAIL.startsWith('security@'), 'security address constant exists');

// ── Into Settings ──
{
  const r = settingsRequest('delete', 7);
  eq(r.tab, 'account', 'delete → Account tab');
  eq(r.focus, 'delete', 'delete focus kept');
  eq(r.n, 7, 'nonce passed through');
  eq(settingsRequest('bogus', 1).focus, null, 'unknown focus dropped');
  eq(SETTINGS_FOCUS.support, 'settings-support', 'support group id');
  eq(SETTINGS_FOCUS.delete, 'settings-delete-account', 'delete group id');
}

// ── App.jsx wiring: resolved from the URL, rendered before auth ──
{
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  ok(/resolvePublicPage\(\s*window\.location\.pathname/.test(app), 'App seeds the public page from the URL');
  const exported = app.indexOf('export default function App()');
  const pageBranch = app.indexOf('if (legalPage)', exported);
  const authBranch = app.indexOf('if (session === undefined)', exported);
  ok(exported > 0 && pageBranch > exported, 'App renders the public page');
  ok(authBranch > pageBranch, 'the public page renders before the session is even known (works signed out)');

  const settings = readFileSync(new URL('../components/SettingsSection.jsx', import.meta.url), 'utf8');
  ok(settings.includes('id={SETTINGS_FOCUS.delete}'), 'the delete-account group carries the id the page scrolls to');
  const card = readFileSync(new URL('../components/settings/SupportCard.jsx', import.meta.url), 'utf8');
  ok(card.includes('SETTINGS_FOCUS.support'), 'Report a problem carries the id the page scrolls to');
}

console.log(`legal routes: ${n} checks passed`);
