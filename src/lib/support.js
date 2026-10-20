/**
 * Public, pre-auth pages — /privacy, /terms, /support, /delete-account —
 * and the contact addresses they show.
 *
 * Both stores require a support URL, and Google Play additionally needs
 * a web page where someone who no longer has the app can ask for their
 * account and data to be deleted (STARTUP_REQUIREMENTS items 72 and 74).
 * App.jsx resolves the path with resolvePublicPage() before auth, the
 * same way /privacy and /terms always worked; netlify.toml's `/*` →
 * index.html fallback is what serves the path in the first place.
 *
 * Pure (no React, no window): legalRoutes.test.mjs pins it
 * (npm run check:legalroutes).
 */

// ── Contact addresses ────────────────────────────────────────────────────
// PLACEHOLDER — fill in once the domain and inbox exist. This is the one
// place the support address lives: /support and /delete-account read it,
// and while it still contains "[your-domain]" the pages render it as a
// marked placeholder instead of a mailto link nobody can send to.
export const SUPPORT_EMAIL = 'support@[your-domain]';

// PLACEHOLDER — must match SECURITY.md and public/.well-known/security.txt
// (item 76). Change all three together.
export const SECURITY_EMAIL = 'security@[your-domain]';

/** True while an address is still the "[your-domain]" placeholder (or not an address at all). */
export function isPlaceholderEmail(email) {
  if (typeof email !== 'string') return true;
  if (/[[\]]/.test(email)) return true;
  return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** mailto: link for a real address, or null for a placeholder. */
export function mailtoHref(email, subject) {
  if (isPlaceholderEmail(email)) return null;
  const q = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return `mailto:${email}${q}`;
}

// ── Routes ───────────────────────────────────────────────────────────────
export const PUBLIC_PAGES = ['privacy', 'terms', 'support', 'delete-account'];

/**
 * Which public page a URL opens, or null for the app itself.
 * Accepts the path (/support, /support/) or the hash (#support), which
 * is how /privacy and /terms have always been addressed.
 */
export function resolvePublicPage(pathname, hash) {
  const path = String(pathname || '').replace(/\/+$/, '');
  const h = String(hash || '').replace(/^#/, '');
  for (const key of PUBLIC_PAGES) {
    if (path === `/${key}` || h === key) return key;
  }
  return null;
}

/** The shareable path for a public page. */
export function publicPagePath(key) {
  return PUBLIC_PAGES.includes(key) ? `/${key}` : '/';
}

/** <title> and meta description for each public page. */
export const PAGE_META = {
  privacy: {
    title: 'Privacy Policy · Vantage',
    description: 'How Vantage collects, uses and protects your personal data, and the rights you have over it.',
  },
  terms: {
    title: 'Terms of Service · Vantage',
    description: 'The terms for using Vantage and Vantage Pro.',
  },
  support: {
    title: 'Support · Vantage',
    description: 'Help with Vantage: answers to common questions, how to contact us, and how to report or block someone.',
  },
  'delete-account': {
    title: 'Delete your account · Vantage',
    description: 'How to delete your Vantage account and its data, what is deleted, what is kept and why, even if you no longer have the app.',
  },
};

// ── Into the app ─────────────────────────────────────────────────────────
// A signed-in visitor's "take me there" buttons open Settings → Account
// and scroll to the group named here. The deletion itself stays in
// SettingsSection (handleDeleteAccount); these pages never delete.
export const SETTINGS_FOCUS = {
  support: 'settings-support',
  delete: 'settings-delete-account',
};

/** The Settings request App/Board hand to SettingsSection's requestedTab. */
export function settingsRequest(focus, n = Date.now()) {
  return { tab: 'account', focus: SETTINGS_FOCUS[focus] ? focus : null, n };
}
