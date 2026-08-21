import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.log', '.nyc_output/**'],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------------------
  // TypeScript sources: type-aware linting.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // The rules most likely to catch a real bug in this async-heavy codebase.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // The `no-unsafe-*` family fires heavily on the existing `any`-typed
      // internal boundary (src/types.ts). Kept as warnings so CI can be green
      // today while the backlog stays visible; promoted to `error` in Phase 4
      // once `any` is removed from the public surface.
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // `MVTFeature.type` is `number` rather than `GeometryType`, so every
      // geometry switch compares across types. Fixed in Phase 4; promote then.
      '@typescript-eslint/no-unsafe-enum-comparison': 'warn',

      // The `@turf/turf` types resolve to `error` types (Turf 7 dropped
      // `Properties`), which makes Feature/Polygon/MultiPolygon behave as
      // `any`. Resolved in Phase 5 by moving to granular turf packages.
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/unbound-method': 'warn',

      'no-console': 'warn',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-await-in-loop': 'warn',
      'prefer-destructuring': ['warn', { array: false, object: true }],
    },
  },

  // Library code runs in the browser against the Google Maps JS API.
  {
    files: ['src/**/*.ts', 'index.ts'],
    languageOptions: {
      globals: { ...globals.browser, google: 'readonly' },
    },
  },

  // Tests.
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.jest, ...globals.browser, ...globals.node, google: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'no-console': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // Plain JS: config files, build/test scripts. No type-aware linting.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  {
    // .mjs is ES module by definition; the block above defaults .js/.mjs to
    // commonjs because most config files here are CJS.
    files: ['eslint.config.mjs', '**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
