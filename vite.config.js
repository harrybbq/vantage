import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';

// https://vitejs.dev/config/
//
// No rollupOptions.external: every Capacitor / RevenueCat plugin is an
// installed dependency imported with a literal specifier, so Rollup
// bundles it into a lazy chunk. Externalising one (as @capacitor/browser
// used to be) leaves a bare `import('@capacitor/browser')` in the
// output, which a WebView cannot resolve — the native build then fails
// at the exact moment the plugin is needed.
//
// __BUILD__ stamps every build with its build time (ms). Builds order
// themselves by it: the update gate (src/lib/buildGate.js) compares it
// with the owner's minimum, and the build census records it.
export default defineConfig({
    plugins: [plugin()],
    define: {
        __BUILD__: JSON.stringify(Date.now()),
    },
    server: {
        port: 51414,
    },
})
