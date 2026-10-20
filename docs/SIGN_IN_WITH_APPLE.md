# Sign in with Apple: token revocation on account deletion

STARTUP_REQUIREMENTS item 117 (store pack gap P8). Written 2026-10-20.

Apple expects an app that offers Sign in with Apple (SIWA) to revoke the
user's Apple tokens when they delete their account. It does this through
`POST https://appleid.apple.com/auth/revoke`. Vantage now does it from
`netlify/functions/delete-account.js`. This page covers how the code works
and what the owner has to set up.

## How sign-in works today

- **There is no native SIWA plugin.** The web and the app both use
  Supabase's OAuth flow. The web uses an implicit redirect. The app opens
  the system browser and uses PKCE (`src/lib/native/deepLinks.js`).
- Supabase exchanges Apple's code using the **Services ID** set in
  Supabase → Authentication → Providers → Apple. Right after sign-in it
  gives the client the Apple refresh token, once, as
  `session.provider_refresh_token`. Supabase does not keep it.

## What the code does

1. **Capture (client, auth lib layer).** `src/lib/supabase.js` (web) and
   `src/lib/native/deepLinks.js` (app) pass the fresh session to
   `src/lib/auth/appleTokenCapture.js`. That module posts the token to
   `apple-token`, but only when the newest identity on the account is
   Apple. Without that check, a later Google sign-in on a linked account
   would send Google's token. The call is fire-and-forget and never blocks
   sign-in.
2. **Store (server).** `netlify/functions/apple-token.js` checks the
   session with Supabase. It runs the same Apple rule on the auth server's
   user record, and the Apple sign-in must be less than 10 minutes old.
   It then upserts the token into `public.apple_tokens`. That table has RLS
   on, no policies and no client grant, so no app session can read a token
   back. When `APPLE_TOKEN_SECRET` is set, the token is stored encrypted
   (AES-256-GCM).
3. **Revoke (server).** `delete-account` reads the row **before** deleting
   the auth user, because the row cascades away with the account. It revokes
   **after** the delete succeeds. It signs a 5-minute ES256 client secret
   with the Apple key and posts `token_type_hint=refresh_token`.
   **This step never blocks a deletion.** A missing env var, a missing
   table, no stored token or an Apple error is logged
   (`delete-account: Apple revoke not done <reason>`), and the account is
   deleted anyway.

## Owner setup

### 1. Apple Developer: the key

You can reuse the key Supabase's Apple provider already uses, if you
still have its `.p8` file. Otherwise make a new one:

1. Go to developer.apple.com → Certificates, Identifiers & Profiles → **Keys** → **+**.
2. Name it, for example "Vantage SIWA". Tick **Sign in with Apple** → **Configure** →
   choose the primary App ID (`com.vantage.app`) → **Save** → **Continue** → **Register**.
3. **Download** the `.p8` file. Apple lets you download it only once, so
   store it in your password manager, never in the repo. Note the **Key ID**
   (10 characters).
4. Note your **Team ID**. It is under Membership details, and also in the
   top-right corner of the developer site.
5. Note the **Services ID** that Supabase uses. It is the identifier in
   Supabase → Authentication → Providers → Apple → Client IDs, the
   web/Services one (for example `com.vantage.web`), **not** the bundle ID.
   Apple refuses a revoke whose `client_id` is not the client that
   obtained the token.

### 2. Netlify environment (Functions scope), then redeploy

| Variable | Value |
|---|---|
| `APPLE_TEAM_ID` | Team ID |
| `APPLE_KEY_ID` | Key ID of the `.p8` |
| `APPLE_PRIVATE_KEY` | The whole `.p8` contents. Real newlines, `\n`-escaped newlines, or just the base64 body all work. |
| `APPLE_SERVICES_ID` | The Services ID Supabase uses |
| `APPLE_TOKEN_SECRET` | Recommended. A random string, for example `openssl rand -base64 32`. Tokens captured after it is set are stored encrypted. **Don't change or remove it later**: tokens sealed with the old value can no longer be revoked. |
| `APPLE_BUNDLE_ID` | Optional. Only needed if a native SIWA plugin is ever added. Defaults to `com.vantage.app`. |

Lambda caps a function's environment at about 4 KB in total. The `.p8`
is about 250 characters, so it fits.

### 3. SQL

Run `supabase/apple_revocation_2026_10.sql` in the SQL editor, then run
its VERIFY block. Until it has run, `apple-token` answers
`{ stored: false }` and deletion carries on as before.

### 4. Smoke test

These steps confirm what could not be checked from the build environment:
that Supabase really does return Apple's refresh token.

1. Deploy, then sign in with Apple on the web with a throwaway Apple ID.
2. In the SQL editor, run
   `select count(*), max(updated_at), min(enc) from public.apple_tokens;`
   and expect one more row, stamped just now. Don't select the `token` column.
   - **No row?** Check the function log for `apple-token`. A
     `stored:false, not_apple_sign_in` result means the Apple identity's
     `last_sign_in_at` was not the newest. No call at all means Supabase did
     not put `provider_refresh_token` on the session. In that case the
     fallback is a native SIWA plugin, which gives an authorization code
     that can be exchanged with the bundle ID; `client_kind = 'bundle'` is
     reserved for it.
3. Delete that throwaway account (Settings → Account → Delete).
4. Check the `delete-account` function log. It must **not** contain
   `Apple revoke not done`.
5. Go to appleid.apple.com → Sign-In and Security → Sign in with Apple.
   Vantage should no longer be listed for that Apple ID.

## Limits

- Tokens are captured only at sign-in. Someone who signed in with Apple
  before the client change shipped (or before the SQL ran) has nothing
  stored until their next Apple sign-in. Deleting that account logs
  nothing for Apple, because there is no row to revoke.
- Only the newest Apple sign-in's token is kept, one row per account.
  Revoking it revokes the user's authorisation for the app at Apple.
