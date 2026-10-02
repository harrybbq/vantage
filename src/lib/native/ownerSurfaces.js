/**
 * Whether the owner-only surfaces exist in this build at all.
 *
 * The Upgrade section, the Apple Health Shortcut panel and the admin
 * rating/coin editors are for one account. In a store binary they are
 * hidden features (App Store 2.3.1) whether or not anyone can reach
 * them — a reviewer sees the whole bundle. So native builds don't hide
 * them, they leave them out: `npm run cap:*` sets VITE_NATIVE_BUILD,
 * Vite folds this to `false`, and every `lazy(() => import(…))` behind
 * it is dropped with its module graph. Same pattern as
 * lib/trading/enabled.js.
 *
 * Must read the full `import.meta.env.VITE_…` expression literally for
 * Vite to substitute it — destructuring defeats the dead-code
 * elimination that follows.
 *
 * Deliberately no runtime Capacitor check here: this decides whether
 * code is in the bundle, which only the build can do. useIsOwner makes
 * the runtime answer.
 */
export const OWNER_SURFACES_IN_BUILD = import.meta.env.VITE_NATIVE_BUILD !== 'true';
