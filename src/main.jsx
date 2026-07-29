import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './hub-dark.css'
import './theme-dark-basic.css'
import './theme-cream-pro.css'
import './tutorial.css'
import './holiday.css'
// Last on purpose: shop.css is the final word on .shop-* rules, which is
// what the mobile shopping layout depends on. Don't reorder.
import './shop.css'
import App from './App.jsx'

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
      <App />
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

  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_UPDATED' && hadController) {
      // Give pending writes ~2s to land then reload. Using location.reload
      // (no force flag) is enough — the SW we just activated will serve
      // the new index.html on the navigation request.
      console.info('[SW] new version active, reloading in 2s:', event.data.version);
      setTimeout(() => window.location.reload(), 2000);
    }
    hadController = true;
  });
}
