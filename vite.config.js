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
export default defineConfig({
    plugins: [plugin()],
    server: {
        port: 51414,
    },
})
