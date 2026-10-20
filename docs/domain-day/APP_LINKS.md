# Domain day: universal links and Android App Links

How `https://[your-domain]/…` links could open the Vantage app
(`com.vantage.app`) instead of the browser. Which flows should move off
the custom scheme `com.vantage.app://`, and whether that is worth doing
now. Templates: [`templates/apple-app-site-association.json`](templates/apple-app-site-association.json),
[`templates/assetlinks.json`](templates/assetlinks.json).

**Short answer: not on domain day.** The domain is the prerequisite,
but the two files need values that don't exist yet: the Apple Team ID
(Apple organisation enrolment, item 5) and the Android signing
certificate's SHA-256 (Play App Signing, after the first upload, item 6).
There is also no `ios/` project yet (items 12–13). Publish the files when
those exist. Until then nothing here changes, and the custom scheme
keeps doing the auth job it does today.

---

## 1. Today's deep links (verified in repo)

| Flow | How it returns today | File |
|---|---|---|
| Google/Apple sign-in (native) | system browser → Supabase → `com.vantage.app://auth-callback?code=…` (PKCE, its own client) | `src/lib/native/deepLinks.js:6-33,122-139`; `src/lib/native/authCallback.js:14-15` |
| Email confirm / password reset | **website**, deliberately (implicit flow; the link may open on another device where a PKCE verifier doesn't exist) | `src/lib/native/deepLinks.js:28-32`; `src/components/AuthScreen.jsx:256-275` |
| Friend invite `/invite/<code>` | website only; the native shell's `appUrlOpen` handler only understands the auth callback (`handleUrl` → `parseAuthCallback`) | `src/lib/friends/dmModel.js:350-364`; `src/App.jsx:72,1120-1128`; `src/lib/native/deepLinks.js:81-82` |
| WHOOP/Oura connect | provider → `/.netlify/functions/{whoop,oura}-callback` → 302 to the site root. **Broken in the native app** (item 115: WebView navigation, HttpOnly cookie the system browser doesn't share) | `netlify/lib/redirectUri.js:41-54`; `netlify/functions/whoop-callback.js:25` |

Android registers only the custom scheme
(`android/app/src/main/AndroidManifest.xml:35-40`; `strings.xml:6`).
iOS doesn't exist yet. `authCallback.js:9-10` notes the scheme must be
added to `Info.plist` once it does.

## 2. Which flows should move to https links

| Flow | Move? | Why |
|---|---|---|
| **Invites** `/invite/<code>` | **Yes, once the apps ship** | The one link people share in messages, where an installed app should open. Falls back to the web page when the app isn't installed. Needs a small code change: `handleUrl` must also parse `https://[your-domain]/invite/<code>` and hand the code to the same flow `App.jsx` runs from `window.location.pathname`. Also fix `src/lib/friends/invites.js:26` (uses `window.location.origin`, which is `https://localhost`/`capacitor://localhost` in the shell) to use `webOrigin()` |
| **OAuth sign-in return** | **No, keep `com.vantage.app://auth-callback`** | Universal links / App Links are unreliable when the navigation is a **server redirect inside an in-app browser sheet** (SFSafariViewController / Custom Tabs, which is what `@capacitor/browser` opens). The OS often keeps the page in the sheet. The custom scheme always hands back to the app, and PKCE already makes a hijacked code useless (`deepLinks.js:25-28`). Revisit only if moving to `ASWebAuthenticationSession` with https callbacks |
| **Email confirm / reset** | **No (for now)** | They land on the website by design. Sending them into the app would need the implicit tokens to reach the app (PKCE has no verifier on another device). Verified App Links can't be claimed by other apps, unlike a scheme, so it is possible later. It is a design change, not a domain-day task |
| **WHOOP/Oura callbacks** (item 115) | **No: use the scheme** | The callback is a server function that 302s afterwards. For a native start, redirect to `com.vantage.app://wearable-callback?whoop=connected` (state bound without a cookie, per item 115). Same in-sheet redirect problem as OAuth |
| `/privacy`, `/terms`, `/support`, `/delete-account` | **No** | Must open in a browser (store reviewers, people without the app). Keep them **out** of the AASA `components` and Android `pathPrefix` |

So the files only claim `/invite/*`. `webcredentials` (iOS) and
`get_login_creds` (Android) are included so saved passwords for
`[your-domain]` are offered in the app's email/password form. That is
harmless and useful once both apps exist.

## 3. Serving the files

They must be served from the **exact host** the apps name, i.e. the
primary domain:
```
https://[your-domain]/.well-known/apple-app-site-association   (no extension)
https://[your-domain]/.well-known/assetlinks.json
```
Rules:
- **HTTPS, 200, no redirects.** Apple's CDN treats a redirect as a
  failure. So **don't** list `www.[your-domain]` in the entitlement if
  www 301s to the apex (CHECKLIST step 3.4). List only the primary host.
- **`Content-Type: application/json`.** `assetlinks.json` gets it from
  its extension. The AASA file has no extension, so Netlify needs a
  header rule (below).
- Under 128 KB. Not behind auth, bot protection or a WAF rule that could
  block Apple's CDN fetcher (keep this in mind for item 86's rate-limit
  rule).
- The SPA fallback `/* /index.html 200` (`netlify.toml` `[[redirects]]`,
  `public/_redirects`) is **not forced**, so a real file at that path
  wins. Verify with curl anyway, because a wrong result looks like
  `<!DOCTYPE html>`.
- If the old host is ever redirected (CHECKLIST step 9), exclude
  `/.well-known/*`, as that snippet does.

Placement when the time comes: copy the templates to
`public/.well-known/apple-app-site-association` (rename, no `.json`) and
`public/.well-known/assetlinks.json`, next to the existing
`public/.well-known/security.txt`. Vite copies `public/` into `dist/`
unchanged.

### `netlify.toml` snippet (add later, not on domain day)
```toml
# Universal links: Apple fetches this through its CDN and wants JSON,
# HTTPS, no redirect. The file has no extension, so name the type.
[[headers]]
  for = "/.well-known/apple-app-site-association"
  [headers.values]
    Content-Type = "application/json"
    Cache-Control = "public, max-age=3600"

[[headers]]
  for = "/.well-known/assetlinks.json"
  [headers.values]
    Content-Type = "application/json"
    Cache-Control = "public, max-age=3600"
```
`netlify.toml` wins over `public/_headers` when both set a header
(comment in `netlify.toml`), so put it in one place only.

Verify:
```bash
curl -sI https://[your-domain]/.well-known/apple-app-site-association | grep -iE '^(HTTP|content-type|location)'
#   HTTP/2 200 · content-type: application/json · no location
curl -s  https://[your-domain]/.well-known/assetlinks.json | python3 -m json.tool
curl -s  https://app-site-association.cdn-apple.com/a/v1/[your-domain]   # Apple's CDN copy (can lag up to a day)
```
Android: Google's Digital Asset Links API
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://[your-domain]&relation=delegate_permission/common.handle_all_urls`,
then on a device `adb shell pm get-app-links com.vantage.app` (expect
`verified`).

## 4. Filling the placeholders

| Placeholder | Where to get it |
|---|---|
| `[APPLE_TEAM_ID]` | developer.apple.com → Membership details → Team ID (10 characters). The app ID becomes `ABCDE12345.com.vantage.app` |
| `[PLAY_APP_SIGNING_KEY_SHA256]` | Play Console → app → Test and release → **App integrity** → App signing key certificate → SHA-256. This is the key that signs what users install |
| `[UPLOAD_KEY_SHA256]` | same page, Upload key certificate. Or `keytool -list -v -keystore <upload.jks>`. Lets locally built/sideloaded release builds verify too. Add a debug-keystore fingerprint only on a test domain, never in production |

These are public identifiers, not secrets.

## 5. App-side snippets (when `ios/` exists and for Android)

### iOS: Associated Domains entitlement
Developer portal → Identifiers → `com.vantage.app` → enable **Associated
Domains**. In Xcode → target → Signing & Capabilities → **+ Associated
Domains**, which writes `ios/App/App/App.entitlements`:
```xml
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:[your-domain]</string>
  <string>webcredentials:[your-domain]</string>
</array>
```
While developing, `applinks:[your-domain]?mode=developer` bypasses
Apple's CDN cache on development-signed builds.

The custom scheme still needs registering in `ios/App/App/Info.plist`
(`authCallback.js:9-10`):
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key><string>com.vantage.app</string>
    <key>CFBundleURLSchemes</key><array><string>com.vantage.app</string></array>
  </dict>
</array>
```

### Android: verified App Link intent filter
In `android/app/src/main/AndroidManifest.xml`, inside `.MainActivity`
**next to** (not replacing) the existing `auth-callback` scheme filter:
```xml
<!-- Friend invites: https://[your-domain]/invite/<code> opens the app
     when installed (verified against /.well-known/assetlinks.json). -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https"
          android:host="[your-domain]"
          android:pathPrefix="/invite/" />
</intent-filter>
```
`launchMode="singleTask"` is already set (manifest line 24), so a link
reaches the running activity. Capacitor's `App` plugin delivers
universal/App Links through the same `appUrlOpen` event that
`initDeepLinks()` already listens to (`deepLinks.js:143-148`). Only the
parser needs to learn the invite URL.

## 6. Order, when the time comes

1. Domain live (CHECKLIST) → 2. Apple Team ID + Play signing key exist →
3. code: `handleUrl` parses invite links; `invites.js` uses `webOrigin()`
→ 4. publish both files + the `netlify.toml` header → 5. curl checks
(§3) → 6. ship builds with the entitlement / intent filter → 7. test
on devices: tap an invite link in Messages/WhatsApp with the app
installed (opens the app) and uninstalled (opens the web page). Note
that a link tapped *inside Safari on the same domain* deliberately
stays in Safari. That is iOS behaviour, not a bug.

Rollback: delete the two files (or empty the `components` list). The
apps fall back to opening the browser, and nothing breaks.
