import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './hub-dark.css'
import './theme-cream-pro.css'
import './tutorial.css'
import './holiday.css'
import './groups.css'
import './track-panels.css'
import './boot.css'
// Last on purpose: shop.css is the final word on .shop-* rules, which is
// what the mobile shopping layout depends on. Don't reorder.
import './shop.css'
import App from './App.jsx'
import RootErrorBoundary from './components/RootErrorBoundary.jsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
)

// Register service worker (production only) and listen for the
// SW_UPDATED message it broadcasts on activate. When a new version
// is live we reload the page so the user picks up the new bundle —
// otherwise old clients run pre-fix code indefinitely (this caused
// the 2026-05-03 wipe regression: the wipe-fix shipped to master
// but no client picked it up because the old SW pinned the old JS).
//
// Reload is gated:
//   - First boot doesn't reload (no previous controller).
//   - Subsequent updates reload after a tiny debounce so any
//     in-flight save (1.5s debounce in useVisionBoardState) lands.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(err => console.warn('SW registration failed:', err));
  });

  // One reload per version, ever. Nothing previously capped this: every
  // SW_UPDATED broadcast scheduled another reload, so any situation
  // where the worker re-activates on each load — an eviction, a
  // half-applied update, iOS dropping the controller between
  // navigations — becomes an unbreakable loop of "app appears for a
  // second, screen goes dark, repeat", with no way out from inside the
  // app. The reload exists to stop clients pinning old code; it does
  // not need to fire twice for the same version to achieve that.
  const RELOADED_KEY = 'vb_sw_reloaded_for';
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_UPDATED' && hadController) {
      const version = event.data.version || 'unknown';
      let already = null;
      try { already = sessionStorage.getItem(RELOADED_KEY); } catch { /* private mode */ }
      if (already === version) {
        console.info('[SW] already reloaded for', version, '— not looping');
      } else {
        try { sessionStorage.setItem(RELOADED_KEY, version); } catch { /* private mode */ }
        // Give pending writes ~2s to land then reload. Using location.reload
        // (no force flag) is enough — the SW we just activated will serve
        // the new index.html on the navigation request.
        //
        // Tell the boot sequence to sit this one out. This reload lands
        // two seconds in — right in the middle of it — so the app used to
        // play the boot, cut it off, and play it again from the top every
        // time a new version shipped. The app reloading itself is not the
        // user opening the app. A reload the user asks for still gets the
        // boot, because nothing sets this marker on that path.
        try { sessionStorage.setItem('vb_boot_suppress', '1'); } catch { /* private mode */ }
        console.info('[SW] new version active, reloading in 2s:', version);
        setTimeout(() => window.location.reload(), 2000);
      }
    }
    hadController = true;
  });
}
