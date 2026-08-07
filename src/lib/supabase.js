import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client.
 *
 * Reads the project URL + publishable (anon) key from Vite env vars
 * so the source tree never holds the literal values. Required env:
 *
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Set these in:
 *   - Local dev: .env.local (gitignored — see .env.example)
 *   - Netlify:   Site settings → Environment variables
 *
 * The publishable key is safe to bundle into the client — it's gated
 * by RLS on every table — but Netlify's secret scanner refuses to
 * deploy if it finds the literal in source. netlify.toml passes the
 * variable name through SECRETS_SCAN_OMIT_KEYS so the scanner knows
 * the bundled value is intentional.
 *
 * If the env vars are missing at build time we throw eagerly rather
 * than create a half-broken client — that produces a clear error in
 * the build log instead of mysterious auth failures at runtime.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  const msg =
    'Missing Supabase configuration in this build. VITE_SUPABASE_URL and ' +
    'VITE_SUPABASE_ANON_KEY have to be set in the Netlify environment at ' +
    'BUILD time, not just at runtime.';
  // Stamped before the throw so the boot fallback in index.html can name
  // the cause. A module-evaluation error reaches window.onerror with an
  // empty message in every browser worth caring about, so without this
  // the user gets "couldn't start" and no idea why — and neither do we.
  if (typeof window !== 'undefined') window.__vantageBootError = msg;
  throw new Error(msg);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
