import { lazy, Suspense, useEffect } from 'react';
import LegalPage from './LegalPage';
import { PAGE_META, PUBLIC_PAGES, publicPagePath, resolvePublicPage } from '../lib/support';

// Support + delete-account are only ever needed by the few who open
// them, so they load on demand. Privacy/Terms stay in the main bundle
// as before (the terms sheet and consent host link to them in-app).
const SupportPages = lazy(() => import('./support/SupportPages'));

/**
 * The public pages — /privacy, /terms, /support, /delete-account — in
 * one overlay host, used pre-auth by App and in-app by Board.
 *
 *   page            which page ('privacy' | 'terms' | 'support' | 'delete-account')
 *   signedIn        true / false / undefined (still checking)
 *   onClose()       leave the page
 *   onNavigate(k)   switch to another public page
 *   onOpenSettings(focus)  signed in: open Settings → Account at 'support' | 'delete'
 *   onSignIn(focus)        signed out: go to the sign-in screen, then there
 */
export default function PublicPage({ page, signedIn, onClose, onNavigate, onOpenSettings, onSignIn }) {
  usePageMeta(page);

  function navigate(key) {
    if (!PUBLIC_PAGES.includes(key)) return;
    try { window.history.replaceState(null, '', publicPagePath(key)); } catch { /* no-op */ }
    onNavigate?.(key);
  }

  // Leaving the page — closed, or off into Settings / sign-in — puts the
  // URL back to the app's own, so a reload doesn't reopen it.
  function dropPath() {
    try {
      if (resolvePublicPage(window.location.pathname, window.location.hash)) window.history.replaceState(null, '', '/');
    } catch { /* no-op */ }
  }
  function close() { dropPath(); onClose?.(); }
  const openSettings = onOpenSettings && (focus => { dropPath(); onOpenSettings(focus); });
  const signIn = onSignIn && (focus => { dropPath(); onSignIn(focus); });

  if (page === 'support' || page === 'delete-account') {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: '#0b0d13' }} />}>
        <SupportPages
          page={page}
          signedIn={signedIn}
          onClose={close}
          onNavigate={navigate}
          onOpenSettings={openSettings}
          onSignIn={signIn}
        />
      </Suspense>
    );
  }
  return <LegalPage page={page} onClose={close} onNavigate={navigate} />;
}

/** Per-page <title> and meta description, restored when the page closes. */
function usePageMeta(page) {
  useEffect(() => {
    const meta = PAGE_META[page];
    if (!meta || typeof document === 'undefined') return undefined;
    const prevTitle = document.title;
    let tag = document.querySelector('meta[name="description"]');
    const created = !tag;
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'description');
      document.head.appendChild(tag);
    }
    const prevDesc = tag.getAttribute('content');
    document.title = meta.title;
    tag.setAttribute('content', meta.description);
    return () => {
      document.title = prevTitle;
      if (created) tag.remove();
      else if (prevDesc != null) tag.setAttribute('content', prevDesc);
    };
  }, [page]);
}
