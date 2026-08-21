module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts', 'jest-canvas-mock/lib/index.js'],

  // Enhanced ES module handling
  // .js is transformed too, not just .ts: @mapbox/vector-tile and pbf are
  // ESM-only, and transformIgnorePatterns opting them in achieves nothing if
  // no transform actually matches their files.
  transform: {
    '^.+\\.(ts|js)$': [
      'ts-jest',
      {
        isolatedModules: true,
        // node_modules ships plain JS; type-checking it is neither wanted nor
        // possible, so this is a syntax downlevel only.
        tsconfig: {
          allowJs: true,
          checkJs: false,
          module: 'CommonJS',
          target: 'ES2020',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },

  // Transform ES modules from node_modules
  transformIgnorePatterns: ['node_modules/(?!(@mapbox|@turf|pbf)/)'],

  // Module name mapping for ES modules
  moduleNameMapper: {
    '^@mapbox/vector-tile$': '<rootDir>/node_modules/@mapbox/vector-tile/index.js',
    '^@mapbox/point-geometry$': '<rootDir>/node_modules/@mapbox/point-geometry/index.js',
    '^pbf$': '<rootDir>/node_modules/pbf/index.js',
  },

  // index.ts is the public barrel and was excluded, so MVTUtils, MVTFactory,
  // DefaultStyles, ManifestUtils and createMVTSource were neither tested nor
  // measured. src/types.ts is types plus one helper, and is exercised through
  // the modules that use it.
  collectCoverageFrom: ['src/**/*.ts', 'index.ts', '!src/**/*.d.ts', '!src/types.ts'],

  // The Phase 6 target, now met rather than aspired to. These are the real
  // thresholds, not a ratchet: coverage must not fall below them.
  // Measured: statements 93.69, branches 85.87, functions 92.87, lines 93.99.
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 80,
      lines: 85,
      statements: 85,
    },
  },

  // Performance specs assert wall-clock timings and are flaky under coverage
  // instrumentation, so they are not part of the default suite.
  // Run them explicitly with `npm run test:performance`.
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.spec.ts'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/tests/performance/'],
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 10000,
  verbose: true,
};
