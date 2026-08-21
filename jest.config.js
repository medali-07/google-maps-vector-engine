module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts', 'jest-canvas-mock/lib/index.js'],

  // Enhanced ES module handling
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        isolatedModules: true,
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

  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/types.ts'],

  // Ratchet, not an aspiration. These are pinned just under the measured
  // baseline so coverage cannot regress, and are raised as tests land.
  // Phase 6 target is 85/85/80. Raised after the Phase 5 packaging work,
  // which brought the GeoJSON merge subsystem under test:
  // statements 65.41, branches 54.93, functions 63.90, lines 65.85.
  coverageThreshold: {
    global: {
      branches: 54,
      functions: 63,
      lines: 65,
      statements: 65,
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
