# Vantage

Personal goal-tracking, habit logging, and vision board app.
Built with **React 18 + Vite**, backed by **Supabase**, packaged for native mobile with **Capacitor 7**.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Framer Motion, cmdk |
| Backend / Auth | Supabase (PostgreSQL + Auth) |
| State | Supabase JSON column (`user_data.state`) |
| Styling | Plain CSS with custom properties |
| Native shell | Capacitor 7 |
| Web hosting | Netlify |

---

## Development

```bash
npm install          # install all dependencies
npm run dev          # start Vite dev server on :51414
```

---

## Web build & deploy

```bash
npm run build        # outputs to dist/
```

Netlify deploys automatically from the `master` branch.
The `public/_headers` file configures MIME types and security headers.

---

## Capacitor — native mobile

### Prerequisites

| Platform | Required |
|---|---|
| Android | [Android Studio](https://developer.android.com/studio) + JDK 17+ |
| iOS | macOS + [Xcode 15+](https://developer.apple.com/xcode/) + CocoaPods |

### App configuration

- **App ID:** `com.vantage.app`
- **App Name:** `Vantage`
- **Config file:** `capacitor.config.ts`

### Build and sync commands

```bash
# Build web assets and sync to all native platforms
npm run cap:sync

# Build + sync + open in Android Studio
npm run cap:android

# Build + sync + open in Xcode  (macOS only)
npm run cap:ios

# Regenerate icons and splash screens from source assets
npm run cap:icons
```

### First-time platform setup

```bash
# Add Android (Windows / macOS / Linux)
npx cap add android

# Add iOS  (macOS only)
npx cap add ios
```

> **iOS on Windows:** iOS builds require Xcode and must be run on macOS.
> The `ios/` directory is committed but can only be opened/built on a Mac.

### Day-to-day workflow

```
1. Edit React source
2. npm run cap:sync          ← rebuilds web assets + copies to native
3. Open Android Studio / Xcode
4. Run on emulator or device
```

For faster iteration with live reload, uncomment the `server.url` block in
`capacitor.config.ts` and set it to your LAN IP (`http://192.168.x.x:51414`).

---

## Native plugins

| Plugin | Purpose |
|---|---|
| `@capacitor/status-bar` | Dark style + overlay (web extends under status bar) |
| `@capacitor/splash-screen` | 1.8 s branded splash, auto-hide with fade |
| `@capacitor/push-notifications` | FCM (Android) / APNs (iOS) token registration + message handling |
| `@capacitor/haptics` | iOS Taptic Engine + Android vibration (LIGHT / MEDIUM / HEAVY) |
| `@capacitor/app` | Android hardware back button — double-tap to exit |

All plugins are initialised in `src/hooks/useCapacitor.js`.
They no-op gracefully when the app runs in a browser.

### Push notification setup

**Android (FCM)**
1. Create a Firebase project → add Android app with `com.vantage.app`
2. Download `google-services.json` → place in `android/app/`
3. Enable Firebase Cloud Messaging in the Firebase console

**iOS (APNs)**
1. Apple Developer account required
2. Enable Push Notifications capability in Xcode → Signing & Capabilities
3. Upload APNs key to Firebase (if using FCM for iOS) or configure directly

---

## Icons & splash screens

Source assets in `public/`:

| File | Used for |
|---|---|
| `icon-192.png` | PWA manifest 192 px |
| `icon-512.png` | PWA manifest 512 px |
| `apple-touch-icon.png` | iOS Add to Home Screen |
| `android/app/src/main/res/mipmap-*/ic_launcher.png` | Android launcher icons |

To regenerate Android/iOS icons and splash screens from a single source image:

```bash
# Place a 1024×1024 icon at public/icon.png
# Place a 2732×2732 splash at public/splash.png
npm run cap:icons
```

---

## PWA

The app is also installable as a PWA:

- `public/manifest.json` — web app manifest
- `public/sw.js` — service worker (cache-first assets, network-first Supabase)
- iOS: "Add to Home Screen" via Share sheet
- Android Chrome: native install prompt via `beforeinstallprompt`

---

## Nutrition tracker

The nutrition section on the Track screen uses:

- **Supabase tables** — `nutrition_macros`, `nutrition_log`, `nutrition_daily_summary` (see `supabase/nutrition_schema.sql`)
- **Supabase Edge Function** — `recalculate-nutrition-summary` (see `supabase/functions/recalculate-nutrition-summary/index.ts`)
- **Netlify serverless function** — `netlify/functions/nutrition-search.js` — proxies Nutritionix API calls
- **Open Food Facts** — barcode + fallback search, no API key required

### Nutritionix API setup (free tier)

1. Register at [developer.nutritionix.com](https://developer.nutritionix.com) — free tier gives 500 req/day
2. Create an app and copy your **App ID** and **API Key**
3. Add to Netlify environment variables:

```
NUTRITIONIX_APP_ID=your_app_id_here
NUTRITIONIX_API_KEY=your_api_key_here
```

In Netlify: Site settings → Environment variables → Add variable.

The function is deployed automatically with the site build. It lives at `/.netlify/functions/nutrition-search`.

### Supabase setup

Run `supabase/nutrition_schema.sql` in the Supabase SQL Editor.
Deploy the Edge Function:

```bash
supabase functions deploy recalculate-nutrition-summary
```

---

## Legal

- Privacy Policy and Terms of Service are accessible in-app (Settings) and from the login screen
- GDPR/UK GDPR compliant: data export and account deletion available in Settings
- Cookie consent banner on first visit
