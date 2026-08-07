/**
 * ESLint — narrow on purpose.
 *
 * This exists because of one bug class, not for style. React 18
 * unmounts the ENTIRE root when a render error goes uncaught, so a
 * hooks-order violation doesn't break one widget — it blanks the whole
 * app. That is exactly what happened: a Pro gate returned early above
 * three hooks, `hasPro` flipped false→true a second after mount when
 * the subscription resolved, the hook count changed, and every Pro
 * user's screen went dark. `rules-of-hooks` catches that in the editor,
 * before it can ship.
 *
 * So the config turns ON the rules that catch real defects and leaves
 * formatting alone. A linter that shouts about quote style trains
 * people to ignore it, and then it stops catching the thing it was
 * installed for.
 */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'android/**', 'ios/**', 'public/**', 'coverage/**'],
  },

  // ── Browser source ──
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      ...js.configs.recommended.rules,
      // The reason this file exists. Non-negotiable.
      'react-hooks/rules-of-hooks': 'error',
      // A stale closure is a real bug, but the rule also fires on
      // deliberate omissions — of which this codebase has several,
      // annotated with eslint-disable lines and a note explaining why.
      // Warn so they stay visible without failing the build.
      'react-hooks/exhaustive-deps': 'warn',
      // Genuine mistakes rather than taste.
      // Without this, every component and every imported icon reads as
      // "defined but never used" — 300+ false warnings that would train
      // everyone to ignore the linter, and then it stops catching the
      // thing it was installed for.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // JSX-only references confuse the base rule; capitalised
        // identifiers are components.
        ignoreRestSiblings: true,
      }],
      'no-undef': 'error',
      // Flags defensive initialisation (`let x = null` where every
      // branch assigns before the read). That default is a guard
      // against a future branch forgetting to assign, not dead code —
      // and one of the sites is the RevenueCat webhook, which is not
      // getting restructured to satisfy a style rule.
      'no-useless-assignment': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Formatting is not this linter's business.
      'no-mixed-spaces-and-tabs': 'off',
    },
  },

  // ── Netlify functions + lib: CommonJS, Node globals ──
  {
    files: ['netlify/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Same reasoning as the browser block above.
      'no-useless-assignment': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // ── Service worker ──
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
  },
];
